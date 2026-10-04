package service

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var valueAmountPattern = regexp.MustCompile(`^\d{1,9}(\.\d{1,6})?$`)

const (
	// OpenAI moved the public pricing document from platform.openai.com to
	// the developers site. Keep the old URL as a compatibility fallback for
	// cached/older deployments, but prefer the canonical location.
	openAIOfficialPricingURL       = "https://developers.openai.com/api/docs/pricing"
	openAIOfficialPricingLegacyURL = "https://platform.openai.com/docs/pricing"
)

// The OpenAI pricing page is a documentation page, not a stable public
// pricing API. It has used several representations over time: a React/flight
// array with a leading zero, a plain JSON array, and small model objects. Keep
// the patterns deliberately narrow (model + input + cached input + output)
// and try each representation in order, so a page layout change does not
// silently turn every request into an unpriced record.
const officialPriceNumberPattern = `(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)`

var (
	// Newer OpenAI pricing rows include a second (long-context) input price:
	// model, input, cached input, long-context input, output. Match those rows
	// before the legacy three-price representation so output is never mistaken
	// for the long-context input amount.
	openAIPricingLongEntryPattern   = regexp.MustCompile(`\[\s*\[\s*0\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\s*,\s*\[\s*0\s*,\s*(` + officialPriceNumberPattern + `)\s*\]\s*,\s*\[\s*0\s*,\s*(null|` + officialPriceNumberPattern + `)\s*\]\s*,\s*\[\s*0\s*,\s*(?:null|"-"|-|` + officialPriceNumberPattern + `)\s*\]\s*,\s*\[\s*0\s*,\s*(` + officialPriceNumberPattern + `)\s*\]\s*\]`)
	openAIPricingEntryPattern       = regexp.MustCompile(`\[\s*\[\s*0\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\s*,\s*\[\s*0\s*,\s*(` + officialPriceNumberPattern + `)\s*\]\s*,\s*\[\s*0\s*,\s*(null|` + officialPriceNumberPattern + `)\s*\]\s*,\s*\[\s*0\s*,\s*(` + officialPriceNumberPattern + `)\s*\]\s*\]`)
	openAIPricingFlatEntryPattern   = regexp.MustCompile(`\[\s*"((?:\\.|[^"\\])*)"\s*,\s*(` + officialPriceNumberPattern + `)\s*,\s*(null|` + officialPriceNumberPattern + `)\s*,\s*(` + officialPriceNumberPattern + `)\s*\]`)
	openAIPricingObjectPattern      = regexp.MustCompile(`\{[^{}]{0,1000}\}`)
	openAIPricingModelFieldPattern  = regexp.MustCompile(`(?i)"(?:model|name)"\s*:\s*"((?:\\.|[^"\\])*)"`)
	openAIPricingInputFieldPattern  = regexp.MustCompile(`(?i)"(?:input|input_price|prompt|prompt_price)"\s*:\s*(?:"(` + officialPriceNumberPattern + `)"|(` + officialPriceNumberPattern + `))`)
	openAIPricingCacheFieldPattern  = regexp.MustCompile(`(?i)"(?:cached_input|cache_read|cache_read_price|cached_input_price|cache)"\s*:\s*(?:(?:"(` + officialPriceNumberPattern + `)"|(` + officialPriceNumberPattern + `))|null)`)
	openAIPricingOutputFieldPattern = regexp.MustCompile(`(?i)"(?:output|output_price|completion|completion_price)"\s*:\s*(?:"(` + officialPriceNumberPattern + `)"|(` + officialPriceNumberPattern + `))`)
	// The pricing document appends display-only context labels such as
	// "gpt-5.5 (<272K context length)". API logs contain the model ID without
	// that label, so normalize it before storing a reference price.
	officialModelContextSuffixPattern = regexp.MustCompile(`(?i)\s+\([^)]*context\s+length[^)]*\)\s*$`)
)

var (
	// A non-empty value is a test/operator override. In normal operation the
	// source is resolved at request time so .env values loaded by InitResources
	// are honored.
	officialPricingURL               string
	officialPricingHTTPClientFactory = defaultOfficialPricingHTTPClient
)

const (
	officialPriceSyncNetworkError  = "member_usage_value_official_sync_network_error"
	officialPriceSyncHTTPError     = "member_usage_value_official_sync_http_error"
	officialPriceSyncParseError    = "member_usage_value_official_sync_parse_error"
	officialPriceSyncDatabaseError = "member_usage_value_official_sync_database_error"
)

type OpenAIPricingSyncResult struct {
	SourceURL    string                      `json:"source_url"`
	SyncedAt     int64                       `json:"synced_at"`
	ExchangeRate string                      `json:"exchange_rate"`
	Created      int                         `json:"created"`
	Models       []model.UsageReferencePrice `json:"models"`
}

type officialPriceSyncError struct {
	code  string
	cause error
}

func (e *officialPriceSyncError) Error() string { return e.code }

func (e *officialPriceSyncError) Unwrap() error { return e.cause }

func newOfficialPriceSyncError(code string, cause error) error {
	return &officialPriceSyncError{code: code, cause: cause}
}

func officialPricingSourceURLs() []string {
	if configured := strings.TrimSpace(officialPricingURL); configured != "" {
		return []string{configured}
	}
	if configured := strings.TrimSpace(common.GetEnvOrDefaultString("OPENAI_OFFICIAL_PRICE_URL", "")); configured != "" {
		return []string{configured}
	}
	return []string{openAIOfficialPricingURL, openAIOfficialPricingLegacyURL}
}

func officialPricingProxyURL() (*url.URL, error) {
	raw := strings.TrimSpace(common.GetEnvOrDefaultString("OPENAI_OFFICIAL_PRICE_PROXY", ""))
	if raw == "" {
		// Go does not read the Windows WinINET proxy automatically, while the
		// browser and PowerShell do. Use it only as a local fallback for the
		// read-only official pricing page; deployment environments can continue
		// to use OPENAI_OFFICIAL_PRICE_PROXY or HTTP(S)_PROXY explicitly.
		return detectSystemHTTPProxy()
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		if err == nil {
			err = errors.New("proxy URL has no host")
		}
		return nil, err
	}
	switch parsed.Scheme {
	case "http", "https", "socks5", "socks5h":
		return parsed, nil
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", parsed.Scheme)
	}
}

func defaultOfficialPricingHTTPClient() *http.Client {
	transport := newRelayHTTPTransport()
	if proxyURL, err := officialPricingProxyURL(); err == nil && proxyURL != nil {
		// The value is validated by SyncOpenAIOfficialPrices before this factory
		// is called. Keep the fallback here defensive for callers/tests that use
		// the factory directly.
		if configureProxyTransport(transport, proxyURL) == nil {
			return &http.Client{Transport: transport, Timeout: 20 * time.Second}
		}
	}
	// Go's default transport only consults HTTP(S)_PROXY when its Proxy field
	// is set explicitly on a cloned transport. This also makes the behavior
	// consistent with the relay HTTP clients.
	transport.Proxy = http.ProxyFromEnvironment
	return &http.Client{Transport: transport, Timeout: 20 * time.Second}
}

func officialPricingRequest(ctx context.Context, sourceURL string) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	// OpenAI's edge protection rejects generic Go clients with 403 even though
	// the same public documentation is available in a normal browser. Keep the
	// request explicitly read-only and use a browser-compatible negotiation so
	// official syncing works from a GoLand/cloud-server process as well.
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	request.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	request.Header.Set("Cache-Control", "no-cache")
	return request, nil
}

func fetchOfficialPricingEntries(ctx context.Context) (string, []openAIOfficialPrice, error) {
	if _, err := officialPricingProxyURL(); err != nil {
		return "", nil, newOfficialPriceSyncError(officialPriceSyncNetworkError, err)
	}
	client := officialPricingHTTPClientFactory()
	if client == nil {
		return "", nil, newOfficialPriceSyncError(officialPriceSyncNetworkError, errors.New("nil http client"))
	}
	defer client.CloseIdleConnections()
	var lastErr error
	for _, sourceURL := range officialPricingSourceURLs() {
		request, err := officialPricingRequest(ctx, sourceURL)
		if err != nil {
			lastErr = newOfficialPriceSyncError(officialPriceSyncNetworkError, err)
			continue
		}
		response, err := client.Do(request)
		if err != nil {
			lastErr = newOfficialPriceSyncError(officialPriceSyncNetworkError, err)
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
		response.Body.Close()
		if readErr != nil {
			lastErr = newOfficialPriceSyncError(officialPriceSyncNetworkError, readErr)
			continue
		}
		if response.StatusCode != http.StatusOK {
			lastErr = newOfficialPriceSyncError(officialPriceSyncHTTPError, fmt.Errorf("status %d", response.StatusCode))
			continue
		}
		if len(body) > 2*1024*1024 {
			lastErr = newOfficialPriceSyncError(officialPriceSyncParseError, errors.New("pricing page exceeds size limit"))
			continue
		}
		// The documentation is HTML-escaped in the server-rendered payload
		// (`&quot;`, `&#x2D;`, etc.). Decode before applying the compact snapshot
		// patterns so sync remains stable when the page is served through a proxy.
		entries := parseOpenAIOfficialPrices(html.UnescapeString(string(body)))
		if len(entries) == 0 {
			lastErr = newOfficialPriceSyncError(officialPriceSyncParseError, errors.New("no pricing entries found"))
			continue
		}
		return sourceURL, entries, nil
	}
	if lastErr == nil {
		lastErr = newOfficialPriceSyncError(officialPriceSyncNetworkError, errors.New("no pricing source configured"))
	}
	return "", nil, lastErr
}

// SyncOpenAIOfficialPrices downloads the published OpenAI API pricing page
// and stores an immutable snapshot. It never changes relay billing, quotas,
// or subscription invoices. USD is converted to CNY using the supplied
// exchange rate solely for the internal comparison view.
func SyncOpenAIOfficialPrices(ctx context.Context, exchangeRate string, createdBy int) (*OpenAIPricingSyncResult, error) {
	rate, err := decimal.NewFromString(strings.TrimSpace(exchangeRate))
	if err != nil || !rate.IsPositive() || rate.GreaterThan(decimal.NewFromInt(100)) {
		return nil, errors.New("member_usage_value_invalid_exchange_rate")
	}
	sourceURL, entries, err := fetchOfficialPricingEntries(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	result := &OpenAIPricingSyncResult{SourceURL: sourceURL, SyncedAt: now, ExchangeRate: rate.String(), Models: make([]model.UsageReferencePrice, 0, len(entries))}
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, entry := range entries {
			var existing model.UsageReferencePrice
			queryErr := tx.Where("model = ? AND channel_id = ? AND official = ?", entry.Model, 0, true).
				Order("effective_at desc, id desc").First(&existing).Error
			if queryErr != nil && !errors.Is(queryErr, gorm.ErrRecordNotFound) {
				return newOfficialPriceSyncError(officialPriceSyncDatabaseError, queryErr)
			}
			converted := officialPriceToReferenceWithSource(entry, rate, existing.EffectiveAt, existing.CreatedBy, sourceURL)
			if queryErr == nil && officialPriceSame(existing, entry, rate) {
				// Keep one immutable price row per effective version, but refresh
				// the sync timestamp so the administrator can tell that the
				// official page was checked again. EffectiveAt remains unchanged
				// so historical usage keeps resolving to the same version.
				syncedAt := now
				if syncedAt <= existing.SyncedAt {
					syncedAt = existing.SyncedAt + 1
				}
				if updateErr := tx.Model(&existing).Updates(map[string]interface{}{
					"input":                   converted.Input,
					"output":                  converted.Output,
					"cache_read":              converted.CacheRead,
					"official_input_usd":      converted.OfficialInputUSD,
					"official_output_usd":     converted.OfficialOutputUSD,
					"official_cache_read_usd": converted.OfficialCacheReadUSD,
					"synced_at":               syncedAt,
					"source_url":              sourceURL,
					"official_exchange_rate":  rate.String(),
					"source":                  converted.Source,
				}).Error; updateErr != nil {
					return newOfficialPriceSyncError(officialPriceSyncDatabaseError, updateErr)
				}
				existing.SyncedAt = syncedAt
				existing.SourceURL = sourceURL
				existing.OfficialExchangeRate = rate.String()
				existing.Input = converted.Input
				existing.Output = converted.Output
				existing.CacheRead = converted.CacheRead
				existing.OfficialInputUSD = converted.OfficialInputUSD
				existing.OfficialOutputUSD = converted.OfficialOutputUSD
				existing.OfficialCacheReadUSD = converted.OfficialCacheReadUSD
				existing.Source = converted.Source
				result.Models = append(result.Models, existing)
				continue
			}
			effectiveAt := now
			if queryErr == nil && existing.EffectiveAt >= effectiveAt {
				effectiveAt = existing.EffectiveAt + 1
			}
			price := officialPriceToReferenceWithSource(entry, rate, effectiveAt, createdBy, sourceURL)
			if createErr := tx.Create(&price).Error; createErr != nil {
				return newOfficialPriceSyncError(officialPriceSyncDatabaseError, createErr)
			}
			result.Created++
			result.Models = append(result.Models, price)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

type openAIOfficialPrice struct {
	Model     string
	InputUSD  string
	CacheUSD  string
	OutputUSD string
}

func parseOpenAIOfficialPrices(page string) []openAIOfficialPrice {
	decoded := html.UnescapeString(html.UnescapeString(page))
	seen := make(map[string]bool)
	prices := make([]openAIOfficialPrice, 0)
	appendPrice := func(encodedName, input, cache, output string) {
		name, err := strconv.Unquote(`"` + encodedName + `"`)
		if err != nil {
			return
		}
		name = normalizeOfficialModelName(name)
		if name == "" || seen[name] || !validOfficialPriceNumber(input) || !validOfficialPriceNumber(output) {
			return
		}
		if cache == "-" || cache == "null" {
			cache = ""
		}
		if cache != "" && !validOfficialPriceNumber(cache) {
			return
		}
		seen[name] = true
		prices = append(prices, openAIOfficialPrice{Model: name, InputUSD: input, CacheUSD: cache, OutputUSD: output})
	}
	for _, match := range openAIPricingLongEntryPattern.FindAllStringSubmatch(decoded, -1) {
		cache := match[3]
		if cache == "null" || cache == "-" {
			cache = ""
		}
		// The fourth value is the long-context input price; the final value is
		// the output price used by the accounting view.
		appendPrice(match[1], match[2], cache, match[4])
	}
	for _, match := range openAIPricingEntryPattern.FindAllStringSubmatch(decoded, -1) {
		cache := ""
		if match[3] != "null" {
			cache = match[3]
		}
		appendPrice(match[1], match[2], cache, match[4])
	}
	for _, match := range openAIPricingFlatEntryPattern.FindAllStringSubmatch(decoded, -1) {
		cache := ""
		if match[3] != "null" {
			cache = match[3]
		}
		appendPrice(match[1], match[2], cache, match[4])
	}
	// A fallback for object-shaped data is intentionally limited to shallow
	// objects. This handles the common JSON/React representation while avoiding
	// an expensive or ambiguous parse of the page's entire script tree.
	for _, object := range openAIPricingObjectPattern.FindAllString(decoded, -1) {
		modelMatch := openAIPricingModelFieldPattern.FindStringSubmatch(object)
		input, inputOK := officialPriceObjectNumber(openAIPricingInputFieldPattern, object)
		cache, _ := officialPriceObjectNumber(openAIPricingCacheFieldPattern, object)
		output, outputOK := officialPriceObjectNumber(openAIPricingOutputFieldPattern, object)
		if len(modelMatch) == 2 && inputOK && outputOK {
			appendPrice(modelMatch[1], input, cache, output)
		}
	}
	return prices
}

func normalizeOfficialModelName(name string) string {
	name = strings.TrimSpace(html.UnescapeString(name))
	name = officialModelContextSuffixPattern.ReplaceAllString(name, "")
	return strings.TrimSpace(name)
}

func validOfficialPriceNumber(value string) bool {
	parsed, err := decimal.NewFromString(value)
	return err == nil && !parsed.IsNegative()
}

func officialPriceObjectNumber(pattern *regexp.Regexp, object string) (string, bool) {
	match := pattern.FindStringSubmatch(object)
	if len(match) == 0 {
		return "", false
	}
	for i := 1; i < len(match); i++ {
		if match[i] != "" {
			return match[i], true
		}
	}
	// `null` is a valid representation of an unavailable cached-input rate.
	return "", true
}

func officialPriceSame(existing model.UsageReferencePrice, entry openAIOfficialPrice, rate decimal.Decimal) bool {
	converted := officialPriceToReference(entry, rate, existing.EffectiveAt, existing.CreatedBy)
	return sameDecimalText(existing.OfficialInputUSD, entry.InputUSD) &&
		sameDecimalText(existing.OfficialOutputUSD, entry.OutputUSD) &&
		sameDecimalText(existing.OfficialCacheReadUSD, entry.CacheUSD) &&
		sameDecimalText(existing.OfficialExchangeRate, converted.OfficialExchangeRate) &&
		sameDecimalText(existing.Input, converted.Input) &&
		sameDecimalText(existing.Output, converted.Output) &&
		sameDecimalText(existing.CacheRead, converted.CacheRead)
}

func sameDecimalText(left, right string) bool {
	if left == "" || right == "" {
		return left == right
	}
	a, aErr := decimal.NewFromString(left)
	b, bErr := decimal.NewFromString(right)
	return aErr == nil && bErr == nil && a.Equal(b)
}

func officialPriceToReference(entry openAIOfficialPrice, rate decimal.Decimal, now int64, createdBy int) model.UsageReferencePrice {
	sourceURL := strings.TrimSpace(officialPricingURL)
	if sourceURL == "" {
		sourceURL = strings.TrimSpace(common.GetEnvOrDefaultString("OPENAI_OFFICIAL_PRICE_URL", ""))
	}
	if sourceURL == "" {
		sourceURL = openAIOfficialPricingURL
	}
	return officialPriceToReferenceWithSource(entry, rate, now, createdBy, sourceURL)
}

func officialPriceToReferenceWithSource(entry openAIOfficialPrice, rate decimal.Decimal, now int64, createdBy int, sourceURL string) model.UsageReferencePrice {
	convert := func(usd string) string {
		if usd == "" {
			return ""
		}
		value, _ := decimal.NewFromString(usd)
		return value.Mul(rate).StringFixedBank(6)
	}
	return model.UsageReferencePrice{
		Model: entry.Model, ChannelID: 0, EffectiveAt: now,
		Input: convert(entry.InputUSD), Output: convert(entry.OutputUSD), CacheRead: convert(entry.CacheUSD),
		OfficialInputUSD: entry.InputUSD, OfficialOutputUSD: entry.OutputUSD, OfficialCacheReadUSD: entry.CacheUSD,
		SourceURL: sourceURL, SyncedAt: now, OfficialExchangeRate: rate.String(), Official: true,
		Source: "OpenAI official API pricing page; USD/CNY=" + rate.String(), CreatedBy: createdBy, CreatedAt: now,
	}
}

func LatestOfficialPrices(ctx context.Context) ([]model.UsageReferencePrice, error) {
	prices := make([]model.UsageReferencePrice, 0)
	if err := model.DB.WithContext(ctx).Where("official = ?", true).Order("model asc, effective_at desc, id desc").Find(&prices).Error; err != nil {
		return nil, err
	}
	latest := make([]model.UsageReferencePrice, 0, len(prices))
	seen := make(map[string]bool)
	for _, price := range prices {
		if seen[price.Model] {
			continue
		}
		seen[price.Model] = true
		latest = append(latest, price)
	}
	return latest, nil
}

func SaveUsageReferencePrice(ctx context.Context, p *model.UsageReferencePrice) error {
	p.Model, p.Source = strings.TrimSpace(p.Model), strings.TrimSpace(p.Source)
	if p.Model == "" || utf8.RuneCountInString(p.Model) > 120 || p.ChannelID < 0 || p.EffectiveAt <= 0 || p.Source == "" || utf8.RuneCountInString(p.Source) > 1000 {
		return errors.New("member_usage_value_invalid_price")
	}
	for _, v := range []string{p.Input, p.Output} {
		if !valueAmountPattern.MatchString(v) {
			return errors.New("member_usage_value_invalid_price")
		}
	}
	for _, v := range []string{p.CacheRead, p.CacheWrite, p.CacheWrite1h} {
		if v != "" && !valueAmountPattern.MatchString(v) {
			return errors.New("member_usage_value_invalid_price")
		}
	}
	p.ID, p.CreatedAt = 0, time.Now().Unix()
	var count int64
	if err := model.DB.WithContext(ctx).Model(p).Where("model = ? AND channel_id = ? AND effective_at = ?", p.Model, p.ChannelID, p.EffectiveAt).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return errors.New("member_usage_value_duplicate_price")
	}
	return model.DB.WithContext(ctx).Create(p).Error
}

func SaveUsageCost(ctx context.Context, c *model.UsageCost) error {
	if !valueAmountPattern.MatchString(c.Amount) || c.IncurredAt <= 0 || c.IncurredAt > time.Now().Unix()+86400 || utf8.RuneCountInString(c.Note) > 500 || strings.TrimSpace(c.Note) == "" {
		return errors.New("member_usage_value_invalid_cost")
	}
	switch c.Category {
	case "subscription", "upstream", "server", "analysis", "other":
	default:
		return errors.New("member_usage_value_invalid_cost")
	}
	c.ID, c.CreatedAt = 0, time.Now().Unix()
	return model.DB.WithContext(ctx).Create(c).Error
}

type UsageValueRow struct {
	UserID         int            `json:"user_id"`
	Username       string         `json:"username"`
	Model          string         `json:"model"`
	ChannelID      int            `json:"channel_id"`
	Records        int            `json:"records"`
	Priced         int            `json:"priced"`
	Input          int64          `json:"input"`
	Output         int64          `json:"output"`
	CacheRead      int64          `json:"cache_read"`
	CacheWrite     int64          `json:"cache_write"`
	ReferenceValue string         `json:"reference_value"`
	Pending        map[string]int `json:"pending"`
	PriceIDs       []int          `json:"price_ids"`
}

type UsageValueSummary struct {
	Start                 int64                       `json:"start"`
	End                   int64                       `json:"end"`
	GeneratedAt           int64                       `json:"generated_at"`
	Currency              string                      `json:"currency"`
	Records               int                         `json:"records"`
	Priced                int                         `json:"priced"`
	RawTokens             int64                       `json:"raw_tokens"`
	Input                 int64                       `json:"input"`
	Output                int64                       `json:"output"`
	CacheRead             int64                       `json:"cache_read"`
	CacheWrite            int64                       `json:"cache_write"`
	CacheEligibleInput    int64                       `json:"cache_eligible_input"`
	CacheHitRate          float64                     `json:"cache_hit_rate"`
	UpstreamUsageRecords  int                         `json:"upstream_usage_records"`
	UpstreamTokens        int64                       `json:"upstream_tokens"`
	LocalEstimatedTokens  int64                       `json:"local_estimated_tokens"`
	InternalQuotaUsed     int64                       `json:"internal_quota_used"`
	QuotaEquivalentUSD    string                      `json:"quota_equivalent_usd"`
	QuotaEquivalentCNY    string                      `json:"quota_equivalent_cny"`
	CacheSavingsValue     string                      `json:"cache_savings_value"`
	NormalizedRecords     int                         `json:"normalized_records"`
	EstimatedRecords      int                         `json:"estimated_records"`
	UnknownSourceRecords  int                         `json:"unknown_source_records"`
	ReferenceValue        string                      `json:"reference_value"`
	RecordedCost          string                      `json:"recorded_cost"`
	ActualTotalCost       string                      `json:"actual_total_cost"`
	UpstreamCost          string                      `json:"upstream_cost"`
	ActualProcurementCost string                      `json:"actual_procurement_cost"`
	OperatingCost         string                      `json:"operating_cost"`
	SavingsValue          string                      `json:"savings_value"`
	ValueMultiplier       string                      `json:"value_multiplier"`
	SavingsComparable     bool                        `json:"savings_comparable"`
	Rows                  []UsageValueRow             `json:"rows"`
	Costs                 []model.UsageCost           `json:"costs"`
	Prices                []model.UsageReferencePrice `json:"prices"`
}

type valueLogDetails struct {
	InputTotal          *int64 `json:"input_tokens_total"`
	CacheRead           int64  `json:"cache_tokens"`
	CacheUsageAvailable bool   `json:"cache_usage_available"`
	CacheWrite          int64  `json:"cache_creation_tokens"`
	CacheWriteTotal     int64  `json:"cache_write_tokens"`
	CacheWrite5m        int64  `json:"cache_creation_tokens_5m"`
	CacheWrite1h        int64  `json:"cache_creation_tokens_1h"`
	Claude              bool   `json:"claude"`
	Admin               struct {
		Estimated        bool   `json:"local_count_tokens"`
		UsageBillingPath string `json:"usage_billing_path"`
	} `json:"admin_info"`
}

func isVerifiedUpstreamPath(path string) bool {
	return path == usageBillingPathUpstream || strings.HasPrefix(path, "billing-usage-")
}

// Returns disjoint token categories. Unknown legacy cache semantics are not guessed.
func normalizeValueTokens(log model.Log) ([5]int64, valueLogDetails, string) {
	var d valueLogDetails
	tokens := [5]int64{}
	if log.Other != "" && common.UnmarshalJsonStr(log.Other, &d) != nil {
		return tokens, d, "invalid_usage"
	}
	if log.PromptTokens < 0 || log.CompletionTokens < 0 {
		return tokens, d, "invalid_usage"
	}
	for _, v := range []int64{d.CacheRead, d.CacheWrite, d.CacheWriteTotal, d.CacheWrite5m, d.CacheWrite1h} {
		if v < 0 || v > 2_147_483_647 {
			return tokens, d, "invalid_usage"
		}
	}
	write := d.CacheWriteTotal
	if write == 0 {
		write = d.CacheWrite5m + d.CacheWrite1h
		if d.CacheWrite > write {
			write = d.CacheWrite
		}
	}
	if write < d.CacheWrite5m+d.CacheWrite1h || (d.CacheWriteTotal > 0 && d.CacheWrite > d.CacheWriteTotal) {
		return tokens, d, "invalid_usage"
	}
	input := int64(log.PromptTokens)
	if d.Claude {
		input += d.CacheRead + write
	} else if d.InputTotal != nil {
		input = *d.InputTotal
	} else if d.CacheRead+write > 0 {
		// OpenAI-compatible upstream usage reports prompt_tokens as the total
		// input count, with cached tokens as a subset. Older local estimates do
		// not guarantee that relationship, so only normalize this form when the
		// log explicitly identifies itself as upstream usage.
		if !isVerifiedUpstreamPath(d.Admin.UsageBillingPath) {
			return tokens, d, "unknown_cache"
		}
	}
	if input < d.CacheRead+write || input > 2_147_483_647 {
		return tokens, d, "invalid_usage"
	}
	// Older logs did not carry the explicit availability marker. Positive
	// cache counters are unambiguous evidence that the upstream reported
	// cache usage, so keep those historical records useful.
	if !d.CacheUsageAvailable && (d.CacheRead > 0 || write > 0) {
		d.CacheUsageAvailable = true
	}
	tokens = [5]int64{input - d.CacheRead - write, int64(log.CompletionTokens), d.CacheRead, write - d.CacheWrite1h, d.CacheWrite1h}
	return tokens, d, ""
}

// selectUsageReferencePrice first honors the historical pricing rule used by
// manually entered versions: the version must have been effective when the
// request was recorded, and a channel-specific version wins over the generic
// one. Official OpenAI snapshots are different: they are fetched after the
// usage often already exists, so a report for an earlier day would otherwise
// show 0/N pricing coverage forever. When no historical version is available,
// fall back to the newest official snapshot as the current comparison price.
func selectUsageReferencePrice(prices []model.UsageReferencePrice, log model.Log) *model.UsageReferencePrice {
	modelName := strings.ToLower(strings.TrimSpace(log.ModelName))
	var price *model.UsageReferencePrice
	for i := range prices {
		candidate := &prices[i]
		if strings.ToLower(strings.TrimSpace(candidate.Model)) != modelName || (candidate.ChannelID != 0 && candidate.ChannelID != log.ChannelId) || candidate.EffectiveAt > log.CreatedAt {
			continue
		}
		if price == nil || (candidate.ChannelID != 0 && price.ChannelID == 0) ||
			(candidate.ChannelID == price.ChannelID && (candidate.EffectiveAt > price.EffectiveAt ||
				(candidate.EffectiveAt == price.EffectiveAt && candidate.ID > price.ID))) {
			price = candidate
		}
	}
	if price != nil {
		return price
	}

	// Official prices are snapshots of the currently published list, not a
	// relay billing version. Apply the latest snapshot when a historical log
	// predates the first sync so the administrator can value existing usage.
	for i := range prices {
		candidate := &prices[i]
		if !candidate.Official || strings.ToLower(strings.TrimSpace(candidate.Model)) != modelName || (candidate.ChannelID != 0 && candidate.ChannelID != log.ChannelId) {
			continue
		}
		if price == nil || (candidate.ChannelID != 0 && price.ChannelID == 0) ||
			(candidate.ChannelID == price.ChannelID && (candidate.EffectiveAt > price.EffectiveAt ||
				(candidate.EffectiveAt == price.EffectiveAt && candidate.ID > price.ID))) {
			price = candidate
		}
	}
	return price
}

func BuildUsageValue(ctx context.Context, start, end int64) (*UsageValueSummary, error) {
	if err := ValidateMemberUsageRange(start, end); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, _, logs, err := model.LoadMemberUsageInputs(ctx, start, end)
	if err != nil {
		return nil, err
	}
	prices := make([]model.UsageReferencePrice, 0)
	if err = model.DB.WithContext(ctx).Order("effective_at desc, id desc").Limit(5001).Find(&prices).Error; err != nil {
		return nil, err
	}
	costs := make([]model.UsageCost, 0)
	if err = model.DB.WithContext(ctx).Where("incurred_at >= ? AND incurred_at < ?", start, end).Order("incurred_at desc, id desc").Limit(5001).Find(&costs).Error; err != nil {
		return nil, err
	}
	if len(prices) > 5000 || len(costs) > 5000 {
		return nil, errors.New("member_usage_range_too_large")
	}
	return aggregateUsageValue(logs, prices, costs, start, end), nil
}

func aggregateUsageValue(logs []model.Log, prices []model.UsageReferencePrice, costs []model.UsageCost, start, end int64) *UsageValueSummary {
	s := &UsageValueSummary{Start: start, End: end, GeneratedAt: time.Now().Unix(), Currency: "CNY", Rows: []UsageValueRow{}, Costs: costs, Prices: prices}
	rows := map[string]*UsageValueRow{}
	total, expense, procurementExpense, operatingExpense := decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero
	for _, cost := range costs {
		if cost.IncurredAt >= start && cost.IncurredAt < end {
			amount, err := decimal.NewFromString(cost.Amount)
			if err == nil {
				expense = expense.Add(amount)
				switch cost.Category {
				case "subscription", "upstream":
					// "upstream" remains supported for older records. New
					// subscription purchases should use "subscription".
					procurementExpense = procurementExpense.Add(amount)
				case "server", "analysis", "other":
					operatingExpense = operatingExpense.Add(amount)
				}
			}
		}
	}
	for _, log := range logs {
		if log.Type != model.LogTypeConsume || log.CreatedAt < start || log.CreatedAt >= end {
			continue
		}
		s.Records++
		s.RawTokens += int64(log.PromptTokens) + int64(log.CompletionTokens)
		key := fmt.Sprintf("%d:%d:%s", log.UserId, log.ChannelId, log.ModelName)
		row := rows[key]
		if row == nil {
			row = &UsageValueRow{UserID: log.UserId, Username: log.Username, Model: log.ModelName, ChannelID: log.ChannelId, ReferenceValue: "0", Pending: map[string]int{}, PriceIDs: []int{}}
			rows[key] = row
		}
		row.Records++
		tokens, details, pending := normalizeValueTokens(log)
		if details.Admin.Estimated {
			s.EstimatedRecords++
		} else if !isVerifiedUpstreamPath(details.Admin.UsageBillingPath) {
			s.UnknownSourceRecords++
		} else {
			s.UpstreamUsageRecords++
		}
		if pending == "" {
			s.NormalizedRecords++
			input := tokens[0] + tokens[2] + tokens[3] + tokens[4]
			row.Input += input
			row.Output += tokens[1]
			row.CacheRead += tokens[2]
			row.CacheWrite += tokens[3] + tokens[4]
			s.Input += input
			s.Output += tokens[1]
			s.CacheRead += tokens[2]
			s.CacheWrite += tokens[3] + tokens[4]
			if details.CacheUsageAvailable {
				s.CacheEligibleInput += tokens[0] + tokens[2]
			}
			usageTokens := input + tokens[1]
			if details.Admin.Estimated {
				s.LocalEstimatedTokens += usageTokens
			} else if isVerifiedUpstreamPath(details.Admin.UsageBillingPath) {
				s.UpstreamTokens += usageTokens
			}
		}
		if log.Quota > 0 {
			s.InternalQuotaUsed += int64(log.Quota)
		}
		var meta map[string]interface{}
		_ = common.UnmarshalJsonStr(log.Other, &meta)
		for _, field := range []string{"tool_surcharges", "image", "image_output", "audio_input", "audio_output", "audio_input_seperate_price"} {
			if value, ok := meta[field]; ok && value != nil && value != false && value != float64(0) {
				pending = "special_billing"
			}
		}
		// Text logs use -1 for absent per-call pricing; zero is an explicit price.
		if perCall, ok := meta["model_price"].(float64); ok && perCall >= 0 {
			pending = "special_billing"
		}
		if meta["billing_mode"] == "tiered_expr" {
			pending = "special_billing"
		}
		if details.Admin.Estimated {
			pending = "estimated_usage"
		}
		if tokens == [5]int64{} && pending == "" {
			pending = "missing_usage"
		}
		price := selectUsageReferencePrice(prices, log)
		if pending == "" && price == nil {
			pending = "missing_price"
		}
		value := decimal.Zero
		if pending == "" {
			rates := []string{price.Input, price.Output, price.CacheRead, price.CacheWrite, price.CacheWrite1h}
			for i, count := range tokens {
				if count == 0 {
					continue
				}
				rate, err := decimal.NewFromString(rates[i])
				if err != nil || rate.IsNegative() {
					pending = "missing_price"
					break
				}
				value = value.Add(rate.Mul(decimal.NewFromInt(count)).Div(decimal.NewFromInt(1_000_000)))
			}
			if cacheReadRate, err := decimal.NewFromString(price.CacheRead); err == nil {
				if inputRate, inputErr := decimal.NewFromString(price.Input); inputErr == nil && inputRate.GreaterThan(cacheReadRate) {
					savings := inputRate.Sub(cacheReadRate).Mul(decimal.NewFromInt(tokens[2])).Div(decimal.NewFromInt(1_000_000))
					s.CacheSavingsValue = decimalOrZero(s.CacheSavingsValue).Add(savings).String()
				}
			}
		}
		if pending != "" {
			row.Pending[pending]++
			continue
		}
		row.Priced++
		s.Priced++
		total = total.Add(value)
		previous, _ := decimal.NewFromString(row.ReferenceValue)
		row.ReferenceValue = previous.Add(value).String()
		seen := false
		for _, id := range row.PriceIDs {
			if id == price.ID {
				seen = true
			}
		}
		if !seen {
			row.PriceIDs = append(row.PriceIDs, price.ID)
		}
	}
	for _, row := range rows {
		sort.Ints(row.PriceIDs)
		s.Rows = append(s.Rows, *row)
	}
	sort.Slice(s.Rows, func(i, j int) bool {
		a, b := s.Rows[i], s.Rows[j]
		if a.UserID != b.UserID {
			return a.UserID < b.UserID
		}
		if a.Model != b.Model {
			return a.Model < b.Model
		}
		return a.ChannelID < b.ChannelID
	})
	s.ReferenceValue = total.String()
	s.RecordedCost = expense.String()
	s.ActualTotalCost = s.RecordedCost
	// UpstreamCost is preserved for older clients and report snapshots.
	s.UpstreamCost = procurementExpense.String()
	s.ActualProcurementCost = procurementExpense.String()
	s.OperatingCost = operatingExpense.String()
	if s.CacheEligibleInput > 0 {
		s.CacheHitRate = float64(s.CacheRead) / float64(s.CacheEligibleInput)
	}
	if common.QuotaPerUnit > 0 {
		quota := decimal.NewFromInt(s.InternalQuotaUsed)
		s.QuotaEquivalentUSD = quota.Div(decimal.NewFromFloat(common.QuotaPerUnit)).String()
		s.QuotaEquivalentCNY = quota.Div(decimal.NewFromFloat(common.QuotaPerUnit)).Mul(decimal.NewFromFloat(operation_setting.USDExchangeRate)).String()
	}
	// Savings is the comparison the team reports: the official reference
	// value of the members' usage minus the money actually paid for the
	// upstream subscription/API. Server and analysis costs remain visible in
	// ActualTotalCost, but are not mixed into the procurement comparison.
	if s.Records > 0 && s.Priced == s.Records && !procurementExpense.IsZero() {
		s.SavingsComparable = true
		// A cost higher than the reference value means no saving; never expose a
		// negative amount in the administrator view.
		savings := total.Sub(procurementExpense)
		if savings.IsNegative() {
			savings = decimal.Zero
		}
		s.SavingsValue = savings.String()
		s.ValueMultiplier = total.Div(procurementExpense).String()
	}
	return s
}

func decimalOrZero(value string) decimal.Decimal {
	if parsed, err := decimal.NewFromString(value); err == nil {
		return parsed
	}
	return decimal.Zero
}
