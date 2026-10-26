package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestValueTokenNormalizationDoesNotDoubleCountCache(t *testing.T) {
	for _, tc := range []struct {
		name, other string
		input       int
		want        [5]int64
		reason      string
	}{
		{"plain", `{}`, 100, [5]int64{100, 20, 0, 0, 0}, ""},
		{"normalized inclusive input", `{"input_tokens_total":100,"cache_tokens":20,"cache_write_tokens":10}`, 100, [5]int64{70, 20, 20, 10, 0}, ""},
		{"upstream cache without separate input total", `{"cache_tokens":20,"admin_info":{"usage_billing_path":"upstream"}}`, 100, [5]int64{80, 20, 20, 0, 0}, ""},
		{"claude excludes cache", `{"claude":true,"cache_tokens":20,"cache_creation_tokens":15,"cache_creation_tokens_5m":10,"cache_creation_tokens_1h":5}`, 100, [5]int64{100, 20, 20, 10, 5}, ""},
		{"ambiguous legacy cache", `{"cache_tokens":20}`, 100, [5]int64{}, "unknown_cache"},
		{"negative usage", `{}`, -1, [5]int64{}, "invalid_usage"},
		{"invalid metadata", `bad-json`, 100, [5]int64{}, "invalid_usage"},
		{"cache exceeds input", `{"input_tokens_total":10,"cache_tokens":20}`, 100, [5]int64{}, "invalid_usage"},
		{"conflicting cache writes", `{"input_tokens_total":100,"cache_write_tokens":5,"cache_creation_tokens_1h":10}`, 100, [5]int64{}, "invalid_usage"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			counts, _, reason := normalizeValueTokens(model.Log{PromptTokens: tc.input, CompletionTokens: 20, Other: tc.other})
			assert.Equal(t, tc.want, counts)
			assert.Equal(t, tc.reason, reason)
		})
	}
}

func TestParseOpenAIOfficialPrices(t *testing.T) {
	page := `... [ [ 0, &quot;gpt-test&quot; ] , [ 0, 2.5 ] , [ 0, 1.25 ] , [ 0, 10 ] ] ... [ [0,"gpt-escaped\u002Dtest"],[0,.5],[0,null],[0,1] ] ...`
	prices := parseOpenAIOfficialPrices(page)
	require.Len(t, prices, 2)
	assert.Equal(t, openAIOfficialPrice{Model: "gpt-test", InputUSD: "2.5", CacheUSD: "1.25", OutputUSD: "10"}, prices[0])
	assert.Equal(t, openAIOfficialPrice{Model: "gpt-escaped-test", InputUSD: ".5", CacheUSD: "", OutputUSD: "1"}, prices[1])
	converted := officialPriceToReference(prices[0], decimal.RequireFromString("7.2"), 100, 1)
	assert.Equal(t, "18.000000", converted.Input)
	assert.True(t, converted.Official)
}

func TestParseOpenAIOfficialPricesSupportsFlatAndObjectSnapshots(t *testing.T) {
	page := `
		<script type="application/json">
		  [["gpt-flat", 2.50, null, 10.0],
		   {"model":"gpt-object","input":"1.25","cached_input":0.625,"output":5}]
		</script>`
	prices := parseOpenAIOfficialPrices(page)
	require.Len(t, prices, 2)
	assert.Equal(t, openAIOfficialPrice{Model: "gpt-flat", InputUSD: "2.50", CacheUSD: "", OutputUSD: "10.0"}, prices[0])
	assert.Equal(t, openAIOfficialPrice{Model: "gpt-object", InputUSD: "1.25", CacheUSD: "0.625", OutputUSD: "5"}, prices[1])
}

func TestParseOpenAIOfficialPricesSupportsLongContextRows(t *testing.T) {
	prices := parseOpenAIOfficialPrices(`[[1,[[0,"gpt-long"],[0,4],[0,0.4],[0,5],[0,20]]]]`)
	require.Len(t, prices, 1)
	assert.Equal(t, openAIOfficialPrice{Model: "gpt-long", InputUSD: "4", CacheUSD: "0.4", OutputUSD: "20"}, prices[0])
	prices = parseOpenAIOfficialPrices(`[[1,[[0,"gpt-no-long"],[0,5],[0,0.5],[0,"-"],[0,30]]]]`)
	require.Len(t, prices, 1)
	assert.Equal(t, openAIOfficialPrice{Model: "gpt-no-long", InputUSD: "5", CacheUSD: "0.5", OutputUSD: "30"}, prices[0])
}

func TestParseOpenAIOfficialPricesRemovesContextDisplaySuffix(t *testing.T) {
	prices := parseOpenAIOfficialPrices(`[[1,[[0,"gpt-5.5 (&lt;272K context length)"],[0,5],[0,0.5],[0,"-"],[0,30]]]]`)
	require.Len(t, prices, 1)
	assert.Equal(t, "gpt-5.5", prices[0].Model)
	assert.Equal(t, "5", prices[0].InputUSD)
	assert.Equal(t, "30", prices[0].OutputUSD)
}

func TestDefaultOfficialPricingClientUsesConfiguredProxy(t *testing.T) {
	var proxied bool
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied = true
		assert.Equal(t, "http://pricing.example.test/docs", r.URL.String())
		w.WriteHeader(http.StatusOK)
	}))
	defer proxyServer.Close()
	t.Setenv("OPENAI_OFFICIAL_PRICE_PROXY", proxyServer.URL)

	client := defaultOfficialPricingHTTPClient()
	defer client.CloseIdleConnections()
	response, err := client.Get("http://pricing.example.test/docs")
	require.NoError(t, err)
	response.Body.Close()
	assert.True(t, proxied)
}

func TestOfficialPriceSameTreatsEquivalentNumericFormattingAsUnchanged(t *testing.T) {
	existing := model.UsageReferencePrice{
		OfficialInputUSD:     "2.50",
		OfficialOutputUSD:    "10.0",
		OfficialCacheReadUSD: "0.6250",
		OfficialExchangeRate: "7.2",
		Input:                "18.000000",
		Output:               "72.000000",
		CacheRead:            "4.500000",
		EffectiveAt:          100,
	}
	entry := openAIOfficialPrice{Model: "gpt-test", InputUSD: "2.5", CacheUSD: ".625", OutputUSD: "10"}
	assert.True(t, officialPriceSame(existing, entry, decimal.RequireFromString("7.20")))
}

func TestSyncOpenAIOfficialPricesClassifiesFailuresAndKeepsImmutableSnapshots(t *testing.T) {
	oldDB, oldURL, oldFactory := model.DB, officialPricingURL, officialPricingHTTPClientFactory
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() {
		model.DB, officialPricingURL, officialPricingHTTPClientFactory = oldDB, oldURL, oldFactory
		sqlDB, closeErr := db.DB()
		if closeErr == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&model.UsageReferencePrice{}))

	page := `[[0,"gpt-test"],[0,2.5],[0,1.25],[0,10]]`
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(page))
	}))
	defer server.Close()
	officialPricingURL = server.URL
	officialPricingHTTPClientFactory = func() *http.Client { return server.Client() }

	first, err := SyncOpenAIOfficialPrices(context.Background(), "7.2", 4)
	require.NoError(t, err)
	require.Equal(t, 1, first.Created)
	var stored model.UsageReferencePrice
	require.NoError(t, db.First(&stored).Error)
	firstEffective, firstSynced := stored.EffectiveAt, stored.SyncedAt
	second, err := SyncOpenAIOfficialPrices(context.Background(), "7.2", 4)
	require.NoError(t, err)
	assert.Equal(t, 0, second.Created)
	assert.Equal(t, firstEffective, second.Models[0].EffectiveAt)
	assert.Greater(t, second.Models[0].SyncedAt, firstSynced)
	var refreshed model.UsageReferencePrice
	require.NoError(t, db.First(&refreshed, stored.ID).Error)
	assert.Equal(t, second.Models[0].SyncedAt, refreshed.SyncedAt)
	var count int64
	require.NoError(t, db.Model(&model.UsageReferencePrice{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	third, err := SyncOpenAIOfficialPrices(context.Background(), "8", 4)
	require.NoError(t, err)
	assert.Equal(t, 1, third.Created)
	require.NoError(t, db.Model(&model.UsageReferencePrice{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)

	status = http.StatusServiceUnavailable
	_, err = SyncOpenAIOfficialPrices(context.Background(), "8", 4)
	assert.EqualError(t, err, officialPriceSyncHTTPError)
	status = http.StatusOK
	page = "<html>pricing changed</html>"
	_, err = SyncOpenAIOfficialPrices(context.Background(), "8", 4)
	assert.EqualError(t, err, officialPriceSyncParseError)

	officialPricingHTTPClientFactory = func() *http.Client {
		return &http.Client{Transport: errorRoundTripper(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("offline")
		})}
	}
	_, err = SyncOpenAIOfficialPrices(context.Background(), "8", 4)
	assert.EqualError(t, err, officialPriceSyncNetworkError)
	require.NoError(t, db.Model(&model.UsageReferencePrice{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

type errorRoundTripper func(*http.Request) (*http.Response, error)

func (f errorRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestValueUsesEffectivePriceAndIndependentCostNotQuota(t *testing.T) {
	prices := []model.UsageReferencePrice{
		{ID: 1, Model: "a", EffectiveAt: 100, Input: "2", Output: "8"},
		{ID: 2, Model: "a", EffectiveAt: 200, Input: "3", Output: "8"},
		{ID: 3, Model: "a", ChannelID: 2, EffectiveAt: 100, Input: "1", Output: "4"},
	}
	logs := []model.Log{
		{UserId: 1, ChannelId: 1, Type: model.LogTypeConsume, ModelName: "a", CreatedAt: 150, PromptTokens: 1_000_000, CompletionTokens: 100_000, Quota: 999999},
		{UserId: 1, ChannelId: 1, Type: model.LogTypeConsume, ModelName: "a", CreatedAt: 250, PromptTokens: 1_000_000, CompletionTokens: 100_000},
		{UserId: 2, ChannelId: 2, Type: model.LogTypeConsume, ModelName: "a", CreatedAt: 250, PromptTokens: 1_000_000, CompletionTokens: 100_000},
		{UserId: 1, Type: model.LogTypeRefund, CreatedAt: 250, PromptTokens: 1_000_000, Quota: 999999},
		{UserId: 1, Type: model.LogTypeError, CreatedAt: 250, PromptTokens: 1_000_000},
		{UserId: 1, Type: model.LogTypeConsume, ModelName: "a", CreatedAt: 300, PromptTokens: 1_000_000},
	}
	result := aggregateUsageValue(logs, prices, []model.UsageCost{{Amount: "100.123456", IncurredAt: 200}, {Amount: "99", IncurredAt: 300}}, 100, 300)
	assert.Equal(t, 3, result.Records)
	assert.Equal(t, 3, result.Priced)
	assert.Equal(t, "8", result.ReferenceValue)
	assert.Equal(t, "100.123456", result.RecordedCost)
	assert.Equal(t, int64(3_300_000), result.RawTokens)
	assert.Equal(t, []int{1, 2}, result.Rows[0].PriceIDs)
	assert.Equal(t, "6.6", result.Rows[0].ReferenceValue)
}

func TestValueSavingsAndMultiplierUseProcurementCost(t *testing.T) {
	logs := []model.Log{{
		UserId: 1, ModelName: "a", Type: model.LogTypeConsume, CreatedAt: 150,
		PromptTokens: 1_000_000,
	}}
	prices := []model.UsageReferencePrice{{Model: "a", EffectiveAt: 100, Input: "10", Output: "0"}}
	costs := []model.UsageCost{
		{Category: "subscription", Amount: "3", IncurredAt: 120},
		{Category: "server", Amount: "2", IncurredAt: 130},
	}
	result := aggregateUsageValue(logs, prices, costs, 100, 200)
	assert.Equal(t, "10", result.ReferenceValue)
	assert.Equal(t, "5", result.ActualTotalCost)
	assert.Equal(t, "7", result.SavingsValue)
	assert.Equal(t, "3.3333333333333333", result.ValueMultiplier)
	assert.True(t, result.SavingsComparable)
}

func TestValueSavingsNeverGoesNegativeWhenCostExceedsReference(t *testing.T) {
	logs := []model.Log{{
		UserId: 1, ModelName: "a", Type: model.LogTypeConsume, CreatedAt: 150,
		PromptTokens: 1_000_000,
	}}
	prices := []model.UsageReferencePrice{{Model: "a", EffectiveAt: 100, Input: "10", Output: "0"}}
	costs := []model.UsageCost{{Category: "subscription", Amount: "100", IncurredAt: 120}}

	result := aggregateUsageValue(logs, prices, costs, 100, 200)
	assert.True(t, result.SavingsComparable)
	assert.Equal(t, "0", result.SavingsValue)
	assert.Equal(t, "0.1", result.ValueMultiplier)
}

func TestValuePartialPricingStillShowsConservativeSavings(t *testing.T) {
	logs := []model.Log{
		{UserId: 1, ModelName: "a", Type: model.LogTypeConsume, CreatedAt: 150, PromptTokens: 1_000_000},
		{UserId: 1, ModelName: "a", Type: model.LogTypeConsume, CreatedAt: 151, Other: `{"model_price":-1}`},
	}
	prices := []model.UsageReferencePrice{{Model: "a", EffectiveAt: 100, Input: "10", Output: "0"}}
	costs := []model.UsageCost{{Category: "subscription", Amount: "3", IncurredAt: 120}}
	result := aggregateUsageValue(logs, prices, costs, 100, 200)
	assert.Equal(t, 2, result.Records)
	assert.Equal(t, 1, result.Priced)
	assert.Equal(t, 1, result.Rows[0].Pending["missing_usage"])
	assert.True(t, result.SavingsComparable)
	assert.Equal(t, "7", result.SavingsValue)
	// Missing usage remains unknown, including when no records can be priced.
	missing := aggregateUsageValue(logs[1:], prices, costs, 100, 200)
	assert.False(t, missing.SavingsComparable)
	noCost := aggregateUsageValue(logs, prices, nil, 100, 200)
	assert.False(t, noCost.SavingsComparable)
}

func TestValuePricesUpstreamCachedUsageWhenPromptAlreadyIncludesCache(t *testing.T) {
	logs := []model.Log{{
		UserId: 1, ModelName: "gpt-5.5", Type: model.LogTypeConsume, CreatedAt: 150,
		PromptTokens: 8580, CompletionTokens: 481,
		Other: `{"cache_tokens":7680,"cache_usage_available":true,"admin_info":{"usage_billing_path":"upstream"}}`,
	}}
	prices := []model.UsageReferencePrice{{
		ID: 1, Model: "gpt-5.5", EffectiveAt: 100,
		Input: "36", CacheRead: "3.6", Output: "216",
	}}

	result := aggregateUsageValue(logs, prices, nil, 100, 200)

	assert.Equal(t, 1, result.Records)
	assert.Equal(t, 1, result.Priced)
	assert.Equal(t, int64(8580), result.Input)
	assert.Equal(t, int64(7680), result.CacheRead)
	assert.NotEqual(t, "0", result.ReferenceValue)
	assert.Empty(t, result.Rows[0].Pending)
}

func TestOfficialSnapshotPricesHistoricalUsageWhenSyncedLater(t *testing.T) {
	logs := []model.Log{{
		UserId: 1, ModelName: "gpt-5.1", ChannelId: 4, Type: model.LogTypeConsume,
		CreatedAt: 100, PromptTokens: 1_000_000, CompletionTokens: 100_000,
	}}
	prices := []model.UsageReferencePrice{{
		ID: 9, Model: "gpt-5.1", ChannelID: 0, EffectiveAt: 200,
		Input: "10", Output: "20", Official: true,
	}}

	result := aggregateUsageValue(logs, prices, nil, 50, 150)

	assert.Equal(t, 1, result.Priced)
	assert.Equal(t, "12", result.ReferenceValue)
	assert.Empty(t, result.Rows[0].Pending)
}

func TestOfficialSnapshotPricesMatchModelNamesWithoutCaseSensitivity(t *testing.T) {
	logs := []model.Log{{
		UserId: 1, ModelName: "gpt-5.5", ChannelId: 4, Type: model.LogTypeConsume,
		CreatedAt: 100, PromptTokens: 1_000_000,
	}}
	prices := []model.UsageReferencePrice{{
		ID: 9, Model: "GPT-5.5", ChannelID: 0, EffectiveAt: 200,
		Input: "10", Output: "20", Official: true,
	}}

	result := aggregateUsageValue(logs, prices, nil, 50, 150)

	assert.Equal(t, 1, result.Priced)
	assert.Equal(t, "10", result.ReferenceValue)
	assert.Empty(t, result.Rows[0].Pending)
}

func TestValueMissingPricesEstimatedAndSpecialUsageRemainUnpriced(t *testing.T) {
	for _, tc := range []struct{ other, reason string }{
		{`{}`, "missing_price"},
		{`{"model_price":-1}`, "missing_price"},
		{`{"billing_mode":"tiered_expr"}`, "special_billing"},
		{`{"admin_info":{"local_count_tokens":true}}`, "estimated_usage"},
		{`{"tool_surcharges":[{"count":1}]}`, "special_billing"},
		{`{"model_price":0.01}`, "special_billing"},
		{`{"model_price":0}`, "special_billing"},
	} {
		r := aggregateUsageValue([]model.Log{{UserId: 1, Type: model.LogTypeConsume, CreatedAt: 150, PromptTokens: 100, Other: tc.other}}, nil, nil, 100, 200)
		assert.Equal(t, 0, r.Priced)
		assert.Equal(t, 1, r.Rows[0].Pending[tc.reason])
	}
	free := model.UsageReferencePrice{ID: 1, Model: "free", EffectiveAt: 100, Input: "0", Output: "0"}
	r := aggregateUsageValue([]model.Log{{UserId: 1, ModelName: "free", Type: model.LogTypeConsume, CreatedAt: 150, PromptTokens: 100}}, []model.UsageReferencePrice{free}, nil, 100, 200)
	assert.Equal(t, 1, r.Priced)
	assert.Equal(t, "0", r.ReferenceValue)
}

func TestValueArchiveFreezesPriceAndCostWithoutChangingMemberBalance(t *testing.T) {
	oldDB, oldLog := model.DB, model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		sqlDB, e := db.DB()
		if e == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.MemberUsageProfile{}, &model.MemberUsageReport{}, &model.UsageReferencePrice{}, &model.UsageCost{}))
	ctx := context.Background()
	now := time.Now().Unix()
	user := model.User{Username: "value-member", AffCode: "value-aff", Quota: 12345}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&model.Log{UserId: user.Id, ModelName: "a", Type: model.LogTypeConsume, CreatedAt: now - 20, PromptTokens: 1_000_000}).Error)
	price := model.UsageReferencePrice{Model: "a", EffectiveAt: now - 60, Input: "2", Output: "8", Source: "Reviewed provider price", CreatedBy: 99}
	require.NoError(t, SaveUsageReferencePrice(ctx, &price))
	duplicate := price
	assert.EqualError(t, SaveUsageReferencePrice(ctx, &duplicate), "member_usage_value_duplicate_price")
	cost := model.UsageCost{Amount: "10", Category: "server", IncurredAt: now - 30, Note: "Monthly invoice"}
	require.NoError(t, SaveUsageCost(ctx, &cost))
	report := model.MemberUsageReport{Title: "Value snapshot", StartTime: now - 60, EndTime: now, CreatedBy: 99}
	require.NoError(t, ArchiveMemberUsageReport(ctx, &report))
	price.ID = 0
	price.EffectiveAt = now - 25
	price.Input = "5"
	require.NoError(t, SaveUsageReferencePrice(ctx, &price))
	require.NoError(t, db.Delete(&cost).Error)
	live, err := BuildUsageValue(ctx, now-60, now)
	require.NoError(t, err)
	assert.Equal(t, "5", live.ReferenceValue)
	assert.Equal(t, "0", live.RecordedCost)
	stored, err := model.GetMemberUsageReport(ctx, report.ID)
	require.NoError(t, err)
	var snapshot UsageValueSummary
	require.NoError(t, common.UnmarshalJsonStr(stored.ValueSnapshot, &snapshot))
	assert.Equal(t, "2", snapshot.ReferenceValue)
	assert.Equal(t, "10", snapshot.RecordedCost)
	var member model.User
	require.NoError(t, db.First(&member, user.Id).Error)
	assert.Equal(t, 12345, member.Quota)
	for _, invalid := range []string{"-1", "NaN", "1e5", "1.1234567"} {
		price.Input = invalid
		assert.Error(t, SaveUsageReferencePrice(ctx, &price))
		cost.Amount = invalid
		assert.Error(t, SaveUsageCost(ctx, &cost))
	}
}
