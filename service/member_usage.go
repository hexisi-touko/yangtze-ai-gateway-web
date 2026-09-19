package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// PreviousLocalDayRange returns a complete calendar day in the server's local
// timezone. Daily reports use this stable boundary instead of a rolling 24h
// window so the report title and cleanup scope are easy to audit.
func PreviousLocalDayRange(offset int) (int64, int64) {
	if offset < 1 {
		offset = 1
	}
	now := time.Now().In(time.Local)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -offset)
	return day.Unix(), day.AddDate(0, 0, 1).Unix()
}

// PreviousLocalMonthRange returns the complete previous calendar month. A
// calendar boundary makes the monthly request-content cleanup deterministic
// across restarts and easy to explain in an audit report.
func PreviousLocalMonthRange(offset int) (int64, int64) {
	if offset < 1 {
		offset = 1
	}
	now := time.Now().In(time.Local)
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local).AddDate(0, -offset, 0)
	return first.Unix(), first.AddDate(0, 1, 0).Unix()
}

func ArchiveDailyMemberUsageReport(ctx context.Context, start, end int64) (*model.MemberUsageReport, int64, error) {
	var existing model.MemberUsageReport
	if err := model.DB.WithContext(ctx).Where("start_time = ? AND end_time = ?", start, end).Order("id desc").First(&existing).Error; err == nil {
		return &existing, 0, nil
	}
	day := time.Unix(start, 0).In(time.Local).Format("2006-01-02")
	report := &model.MemberUsageReport{
		Title:     "成员使用日报 " + day,
		Note:      "系统自动生成；保留成员用量、请求频率、错误率、缓存与参考价值快照。请求正文单独按保留策略清理。",
		StartTime: start,
		EndTime:   end,
	}
	if err := ArchiveMemberUsageReport(ctx, report); err != nil {
		return nil, 0, err
	}
	return report, 0, nil
}

func ArchiveMonthlyMemberUsageReport(ctx context.Context, start, end int64) (*model.MemberUsageReport, error) {
	var existing model.MemberUsageReport
	if err := model.DB.WithContext(ctx).Where("start_time = ? AND end_time = ?", start, end).Order("id desc").First(&existing).Error; err == nil {
		return &existing, nil
	}
	month := time.Unix(start, 0).In(time.Local).Format("2006-01")
	report := &model.MemberUsageReport{
		Title:     "成员使用月报 " + month,
		Note:      "系统自动生成；汇总上月成员请求频率、Token、错误率、缓存与官方参考价值。归档完成后按月清理 Token 使用量最低的 5 名成员的请求正文。",
		StartTime: start,
		EndTime:   end,
	}
	if err := ArchiveMemberUsageReport(ctx, report); err != nil {
		return nil, err
	}
	return report, nil
}

// CleanupLowUsageRequestContent removes only stored request bodies for the
// five lowest-token active members in an old day. Usage logs and reports are
// retained, so cleanup reduces disk usage without destroying accounting.
func CleanupLowUsageRequestContent(ctx context.Context, start, end int64) (int64, error) {
	summary, err := BuildMemberUsageSummary(ctx, start, end)
	if err != nil {
		return 0, err
	}
	ids := make([]int, 0, 5)
	for i := len(summary.Members) - 1; i >= 0 && len(ids) < 5; i-- {
		member := summary.Members[i]
		if member.ConsumeRecords+member.ErrorRecords > 0 {
			ids = append(ids, member.ID)
		}
	}
	return model.DeleteMemberRequestContentForUsers(ctx, ids, start, end)
}

type MemberUsageMetrics struct {
	ConsumeRecords     int64   `json:"consume_records"`
	ErrorRecords       int64   `json:"error_records"`
	RefundRecords      int64   `json:"refund_records"`
	Tokens             int64   `json:"tokens"`
	InputTokens        int64   `json:"input_tokens"`
	OutputTokens       int64   `json:"output_tokens"`
	CacheReadTokens    int64   `json:"cache_read_tokens"`
	CacheEligibleInput int64   `json:"cache_eligible_input"`
	CacheHitRate       float64 `json:"cache_hit_rate"`
	ChargedQuota       int64   `json:"charged_quota"`
	RefundQuota        int64   `json:"refund_quota"`
}

type MemberUsageRow struct {
	model.UsageMemberIdentity
	Profile model.MemberUsageProfile `json:"profile"`
	MemberUsageMetrics
	AssignedQuota     int64   `json:"assigned_quota"`
	RemainingQuota    int64   `json:"remaining_quota"`
	QuotaUtilization  float64 `json:"quota_utilization"`
	WorkspaceProject  string  `json:"workspace_project"`
	WorkspaceBranch   string  `json:"workspace_branch"`
	WorkspaceSource   string  `json:"workspace_source"`
	WorkspaceLastSeen int64   `json:"workspace_last_seen"`
	PeakMinuteRecords int64   `json:"peak_minute_records"`
	// AverageRPM is the range-wide request rate. ActiveAverageRPM uses only
	// minutes in which this member produced a consume or error record.
	AverageRPM       float64  `json:"average_rpm"`
	ActiveAverageRPM float64  `json:"active_average_rpm"`
	ActiveMinutes    int64    `json:"active_minutes"`
	TokensPerHour    int64    `json:"tokens_per_hour"`
	ErrorRate        float64  `json:"error_rate"`
	LastActive       int64    `json:"last_active"`
	Models           []string `json:"models"`
	// RecentIPs contains up to three most recently observed request addresses.
	// An empty list means IP logging was not enabled for that user's requests.
	RecentIPs []string `json:"recent_ips"`
	Attention []string `json:"attention"`
	Deleted   bool     `json:"deleted"`
}

type MemberUsageSummary struct {
	Version          int                `json:"version"`
	StartTime        int64              `json:"start_time"`
	EndTime          int64              `json:"end_time"`
	GeneratedAt      int64              `json:"generated_at"`
	ActiveMembers    int                `json:"active_members"`
	AttentionMembers int                `json:"attention_members"`
	ActiveMinutes    int64              `json:"active_minutes"`
	AverageRPM       float64            `json:"average_rpm"`
	ActiveAverageRPM float64            `json:"active_average_rpm"`
	Totals           MemberUsageMetrics `json:"totals"`
	Members          []MemberUsageRow   `json:"members"`
}

type MemberUsageTrendPoint struct {
	CreatedAt           int64   `json:"created_at"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	CacheEligibleInput  int64   `json:"cache_eligible_input"`
	Requests            int64   `json:"requests"`
	Quota               int64   `json:"quota"`
	CacheHitRate        float64 `json:"cache_hit_rate"`
}

func ValidateMemberUsageRange(start, end int64) error {
	if start <= 0 || end <= start || end-start > 31*86400 || end > time.Now().Unix()+86400 {
		return errors.New("member_usage_invalid_range")
	}
	return nil
}

func BuildMemberUsageSummary(ctx context.Context, start, end int64) (*MemberUsageSummary, error) {
	if err := ValidateMemberUsageRange(start, end); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	users, profiles, logs, err := model.LoadMemberUsageInputs(ctx, start, end)
	if err != nil {
		return nil, err
	}
	result := aggregateMemberUsage(users, profiles, logs, start, end)
	workspaces, err := model.LatestMemberWorkspaces(ctx)
	if err != nil {
		return nil, err
	}
	for i := range result.Members {
		workspace, ok := workspaces[result.Members[i].ID]
		if !ok {
			continue
		}
		result.Members[i].WorkspaceProject = workspace.Project
		result.Members[i].WorkspaceBranch = workspace.Branch
		result.Members[i].WorkspaceSource = workspace.Source
		result.Members[i].WorkspaceLastSeen = workspace.LastSeenAt
	}
	return result, nil
}

// BuildMemberUsageTrend aggregates the raw usage ledger into the compact
// series used by the dashboard. Cache fields are taken from the same
// normalization path as the member summary, so the two views cannot disagree
// about cache reads or cache-eligible input.
func BuildMemberUsageTrend(ctx context.Context, start, end int64, granularity string) ([]MemberUsageTrendPoint, error) {
	if err := ValidateMemberUsageRange(start, end); err != nil {
		return nil, err
	}
	if granularity != "hour" && granularity != "day" && granularity != "week" {
		granularity = "day"
	}
	logs, err := model.LoadMemberUsageLogs(ctx, start, end)
	if err != nil {
		return nil, err
	}
	points := make(map[int64]*MemberUsageTrendPoint)
	bucketFor := func(at int64) int64 {
		location := time.Unix(at, 0).In(time.Local)
		switch granularity {
		case "hour":
			return time.Date(location.Year(), location.Month(), location.Day(), location.Hour(), 0, 0, 0, time.Local).Unix()
		case "week":
			day := time.Date(location.Year(), location.Month(), location.Day(), 0, 0, 0, 0, time.Local)
			weekday := int(day.Weekday())
			if weekday == 0 {
				weekday = 7
			}
			return day.AddDate(0, 0, -(weekday - 1)).Unix()
		default:
			return time.Date(location.Year(), location.Month(), location.Day(), 0, 0, 0, 0, time.Local).Unix()
		}
	}
	for _, log := range logs {
		if log.Type == model.LogTypeRefund {
			continue
		}
		bucket := bucketFor(log.CreatedAt)
		point := points[bucket]
		if point == nil {
			point = &MemberUsageTrendPoint{CreatedAt: bucket}
			points[bucket] = point
		}
		if log.Type == model.LogTypeConsume {
			point.Requests++
			point.Quota += int64(log.Quota)
			point.OutputTokens += int64(log.CompletionTokens)
			point.InputTokens += int64(log.PromptTokens)
			if tokens, details, reason := normalizeValueTokens(log); reason == "" {
				point.InputTokens += tokens[2] + tokens[3] + tokens[4]
				point.CacheReadTokens += tokens[2]
				point.CacheCreationTokens += tokens[3] + tokens[4]
				if details.CacheUsageAvailable {
					point.CacheEligibleInput += tokens[0] + tokens[2]
				}
			}
		} else if log.Type == model.LogTypeError {
			point.Requests++
		}
	}
	result := make([]MemberUsageTrendPoint, 0, len(points))
	for _, point := range points {
		if point.CacheEligibleInput > 0 {
			point.CacheHitRate = float64(point.CacheReadTokens) / float64(point.CacheEligibleInput)
		}
		result = append(result, *point)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt < result[j].CreatedAt })
	return result, nil
}

func aggregateMemberUsage(users []model.UsageMemberIdentity, profiles []model.MemberUsageProfile, logs []model.Log, start, end int64) *MemberUsageSummary {
	result := &MemberUsageSummary{Version: 1, StartTime: start, EndTime: end, GeneratedAt: time.Now().Unix(), Members: make([]MemberUsageRow, 0)}
	byUser := make(map[int]*MemberUsageRow)
	byProfile := make(map[int]model.MemberUsageProfile)
	minutes := make(map[int]map[int64]int64)
	activeMinutes := make(map[int64]struct{})
	models := make(map[int]map[string]bool)
	memberIPs := make(map[int]map[string]int64)
	for _, profile := range profiles {
		byProfile[profile.UserID] = profile
	}
	for _, user := range users {
		byUser[user.ID] = &MemberUsageRow{UsageMemberIdentity: user}
	}
	for _, log := range logs {
		if log.CreatedAt < start || log.CreatedAt >= end {
			continue
		}
		if log.Type != model.LogTypeConsume && log.Type != model.LogTypeError && log.Type != model.LogTypeRefund {
			continue
		}
		row := byUser[log.UserId]
		if row == nil {
			row = &MemberUsageRow{UsageMemberIdentity: model.UsageMemberIdentity{ID: log.UserId, Username: log.Username}, Deleted: true}
			byUser[log.UserId] = row
		}
		switch log.Type {
		case model.LogTypeConsume:
			row.ConsumeRecords++
			row.InputTokens += int64(log.PromptTokens)
			row.OutputTokens += int64(log.CompletionTokens)
			row.Tokens += int64(log.PromptTokens) + int64(log.CompletionTokens)
			if cacheTokens, details, reason := normalizeValueTokens(log); reason == "" {
				row.CacheReadTokens += cacheTokens[2]
				result.Totals.CacheReadTokens += cacheTokens[2]
				if details.CacheUsageAvailable {
					row.CacheEligibleInput += cacheTokens[0] + cacheTokens[2]
					result.Totals.CacheEligibleInput += cacheTokens[0] + cacheTokens[2]
				}
			}
			row.ChargedQuota += int64(log.Quota)
			result.Totals.ConsumeRecords++
			result.Totals.Tokens += int64(log.PromptTokens) + int64(log.CompletionTokens)
			result.Totals.InputTokens += int64(log.PromptTokens)
			result.Totals.OutputTokens += int64(log.CompletionTokens)
			result.Totals.ChargedQuota += int64(log.Quota)
		case model.LogTypeError:
			row.ErrorRecords++
			result.Totals.ErrorRecords++
		case model.LogTypeRefund:
			row.RefundRecords++
			row.RefundQuota += int64(log.Quota)
			result.Totals.RefundRecords++
			result.Totals.RefundQuota += int64(log.Quota)
		}
		if log.Type == model.LogTypeRefund {
			continue
		}
		if log.CreatedAt > row.LastActive {
			row.LastActive = log.CreatedAt
		}
		if minutes[log.UserId] == nil {
			minutes[log.UserId] = make(map[int64]int64)
		}
		minute := log.CreatedAt / 60
		minutes[log.UserId][minute]++
		activeMinutes[minute] = struct{}{}
		if peak := minutes[log.UserId][minute]; peak > row.PeakMinuteRecords {
			row.PeakMinuteRecords = peak
		}
		if models[log.UserId] == nil {
			models[log.UserId] = make(map[string]bool)
		}
		if log.ModelName != "" {
			models[log.UserId][log.ModelName] = true
		}
		if ip := strings.TrimSpace(log.Ip); ip != "" {
			if memberIPs[log.UserId] == nil {
				memberIPs[log.UserId] = make(map[string]int64)
			}
			if log.CreatedAt > memberIPs[log.UserId][ip] {
				memberIPs[log.UserId][ip] = log.CreatedAt
			}
		}
	}
	for id, row := range byUser {
		row.Profile = byProfile[id]
		row.Profile.UserID = id
		row.AssignedQuota = int64(row.Quota) + int64(row.UsedQuota)
		row.RemainingQuota = int64(row.Quota)
		if row.AssignedQuota > 0 {
			row.QuotaUtilization = float64(row.UsedQuota) / float64(row.AssignedQuota)
		}
		if row.Profile.MemberType == "" {
			row.Profile.MemberType = "unspecified"
		} else if row.Profile.MemberType != "intern" && row.Profile.MemberType != "full_time" && row.Profile.MemberType != "other" && row.Profile.MemberType != "unspecified" {
			// Keep legacy/invalid values visible under the catch-all category
			// without ever interpreting them as a system role.
			row.Profile.MemberType = "other"
		}
		row.Models = make([]string, 0)
		row.RecentIPs = make([]string, 0)
		row.Attention = make([]string, 0)
		for name := range models[id] {
			row.Models = append(row.Models, name)
		}
		sort.Strings(row.Models)
		type ipSeen struct {
			ip string
			at int64
		}
		seen := make([]ipSeen, 0, len(memberIPs[id]))
		for ip, at := range memberIPs[id] {
			seen = append(seen, ipSeen{ip: ip, at: at})
		}
		sort.Slice(seen, func(i, j int) bool {
			if seen[i].at != seen[j].at {
				return seen[i].at > seen[j].at
			}
			return seen[i].ip < seen[j].ip
		})
		for i := 0; i < len(seen) && i < 3; i++ {
			row.RecentIPs = append(row.RecentIPs, seen[i].ip)
		}
		activity := row.ConsumeRecords + row.ErrorRecords
		// RPM is a request-frequency signal, not a concurrency or misuse verdict.
		windowMinutes := float64(end-start) / 60
		if windowMinutes > 0 {
			row.AverageRPM = float64(activity) / windowMinutes
		}
		row.ActiveMinutes = int64(len(minutes[id]))
		if row.ActiveMinutes > 0 {
			row.ActiveAverageRPM = float64(activity) / float64(row.ActiveMinutes)
		}
		windowHours := float64(end-start) / 3600
		if windowHours > 0 {
			row.TokensPerHour = int64(float64(row.Tokens) / windowHours)
		}
		if activity > 0 {
			row.ErrorRate = float64(row.ErrorRecords) / float64(activity)
		}
		if activity > 0 {
			result.ActiveMembers++
			// Project and purpose are no longer entered manually in the admin
			// page. A missing workspace is informational only; it is not a
			// usage violation and should not create a false review signal.
		}
		if row.CacheEligibleInput > 0 {
			row.CacheHitRate = float64(row.CacheReadTokens) / float64(row.CacheEligibleInput)
			// Cache is an efficiency observation, not a misuse verdict. Only
			// surface a review hint when enough cache-eligible input exists.
			if row.CacheEligibleInput >= 1000 && row.CacheHitRate < 0.1 {
				row.Attention = append(row.Attention, "cache_low")
			}
		}
		if len(row.Attention) > 0 {
			result.AttentionMembers++
		}
		result.Members = append(result.Members, *row)
	}
	windowMinutes := float64(end-start) / 60
	if windowMinutes > 0 {
		result.AverageRPM = float64(result.Totals.ConsumeRecords+result.Totals.ErrorRecords) / windowMinutes
	}
	result.ActiveMinutes = int64(len(activeMinutes))
	if result.ActiveMinutes > 0 {
		result.ActiveAverageRPM = float64(result.Totals.ConsumeRecords+result.Totals.ErrorRecords) / float64(result.ActiveMinutes)
	}
	if result.Totals.CacheEligibleInput > 0 {
		result.Totals.CacheHitRate = float64(result.Totals.CacheReadTokens) / float64(result.Totals.CacheEligibleInput)
	}
	sort.Slice(result.Members, func(i, j int) bool {
		if result.Members[i].Tokens != result.Members[j].Tokens {
			return result.Members[i].Tokens > result.Members[j].Tokens
		}
		return result.Members[i].ID < result.Members[j].ID
	})
	return result
}

func UpdateMemberUsageProfile(ctx context.Context, profile *model.MemberUsageProfile) error {
	profile.Project, profile.Purpose = strings.TrimSpace(profile.Project), strings.TrimSpace(profile.Purpose)
	if profile.UserID <= 0 || utf8.RuneCountInString(profile.Project) > 120 || utf8.RuneCountInString(profile.Purpose) > 500 {
		return errors.New("member_usage_invalid_profile")
	}
	switch profile.MemberType {
	case "unspecified", "intern", "full_time", "other":
	default:
		return errors.New("member_usage_invalid_profile")
	}
	return model.SaveMemberUsageProfile(ctx, profile)
}

func ArchiveMemberUsageReport(ctx context.Context, report *model.MemberUsageReport) error {
	report.Title, report.Note = strings.TrimSpace(report.Title), strings.TrimSpace(report.Note)
	if report.Title == "" || utf8.RuneCountInString(report.Title) > 120 || utf8.RuneCountInString(report.Note) > 2000 {
		return errors.New("member_usage_invalid_report")
	}
	summary, err := BuildMemberUsageSummary(ctx, report.StartTime, report.EndTime)
	if err != nil {
		return err
	}
	data, err := common.Marshal(summary)
	if err != nil {
		return err
	}
	value, err := BuildUsageValue(ctx, report.StartTime, report.EndTime)
	if err != nil {
		return err
	}
	valueData, err := common.Marshal(value)
	if err != nil {
		return err
	}
	report.ValueSnapshot = string(valueData)
	report.ID, report.CreatedAt, report.Snapshot = 0, time.Now().Unix(), string(data)
	return model.SaveMemberUsageReport(ctx, report)
}
