package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMemberUsageCountsRecordsWithoutTreatingLoginsOrRefundsAsCalls(t *testing.T) {
	users := []model.UsageMemberIdentity{{ID: 1, Username: "member"}, {ID: 2, Username: "idle"}}
	profiles := []model.MemberUsageProfile{{UserID: 1, MemberType: "intern", Project: "Lab", Purpose: "Testing"}}
	logs := []model.Log{
		{UserId: 1, CreatedAt: 100, Type: model.LogTypeLogin},
		{UserId: 1, CreatedAt: 101, Type: model.LogTypeConsume, PromptTokens: 10, CompletionTokens: 20, Quota: 50, ModelName: "test-model"},
		{UserId: 1, CreatedAt: 102, Type: model.LogTypeConsume, Quota: 10},
		{UserId: 1, CreatedAt: 103, Type: model.LogTypeError},
		{UserId: 1, CreatedAt: 104, Type: model.LogTypeRefund, Quota: 15},
		{UserId: 1, CreatedAt: 200, Type: model.LogTypeConsume, PromptTokens: 999},
		{UserId: 9, Username: "deleted", CreatedAt: 110, Type: model.LogTypeError},
	}
	summary := aggregateMemberUsage(users, profiles, logs, 100, 200)
	assert.Equal(t, MemberUsageMetrics{ConsumeRecords: 2, ErrorRecords: 2, RefundRecords: 1, Tokens: 30, InputTokens: 10, OutputTokens: 20, CacheEligibleInput: 0, ChargedQuota: 60, RefundQuota: 15}, summary.Totals)
	assert.Equal(t, 2, summary.ActiveMembers)
	require.Len(t, summary.Members, 3)
	assert.Equal(t, "intern", summary.Members[0].Profile.MemberType)
	assert.EqualValues(t, 3, summary.Members[0].PeakMinuteRecords)
	assert.EqualValues(t, 1, summary.Members[0].ActiveMinutes)
	assert.InDelta(t, 3, summary.Members[0].ActiveAverageRPM, 0.001)
	assert.EqualValues(t, 103, summary.Members[0].LastActive)
	assert.Empty(t, summary.Members[0].Attention)
	assert.Equal(t, []string{"test-model"}, summary.Members[0].Models)
	assert.Zero(t, summary.Members[1].ConsumeRecords)
	assert.Empty(t, summary.Members[1].Attention)
	assert.True(t, summary.Members[2].Deleted)
	assert.EqualValues(t, 1, summary.ActiveMinutes)
	assert.InDelta(t, 4, summary.ActiveAverageRPM, 0.001)
	assert.InDelta(t, 2.4, summary.AverageRPM, 0.001)
	// Workspace attribution is now reported by the client. Missing legacy
	// profile fields are informational and must not create a review signal.
	assert.Empty(t, summary.Members[2].Attention)
}

func TestMemberUsageCacheEligibilityRequiresUpstreamTelemetry(t *testing.T) {
	logs := []model.Log{
		{UserId: 1, CreatedAt: 101, Type: model.LogTypeConsume, PromptTokens: 100, Other: `{"cache_usage_available":true}`},
		{UserId: 1, CreatedAt: 102, Type: model.LogTypeConsume, PromptTokens: 100},
	}
	summary := aggregateMemberUsage(nil, nil, logs, 100, 200)
	require.Len(t, summary.Members, 1)
	assert.EqualValues(t, 100, summary.Members[0].CacheEligibleInput)
	assert.EqualValues(t, 100, summary.Totals.CacheEligibleInput)
	assert.Equal(t, 0.0, summary.Members[0].CacheHitRate)
}

func TestMemberUsageReportsActiveRPMForSparseActivitySeparatelyFromRangeRPM(t *testing.T) {
	logs := []model.Log{
		{UserId: 1, CreatedAt: 101, Type: model.LogTypeConsume},
		{UserId: 1, CreatedAt: 300, Type: model.LogTypeError},
	}
	summary := aggregateMemberUsage(nil, nil, logs, 100, 400)
	require.Len(t, summary.Members, 1)
	assert.EqualValues(t, 2, summary.Members[0].ActiveMinutes)
	assert.InDelta(t, 1, summary.Members[0].ActiveAverageRPM, 0.001)
	assert.InDelta(t, 0.4, summary.Members[0].AverageRPM, 0.001)
	assert.InDelta(t, 1, summary.ActiveAverageRPM, 0.001)
	assert.InDelta(t, 0.4, summary.AverageRPM, 0.001)
}

func TestMemberUsageSignalsHaveExplicitThresholds(t *testing.T) {
	logs := make([]model.Log, 30)
	for i := range logs {
		logs[i] = model.Log{UserId: 1, CreatedAt: 120, Type: model.LogTypeConsume}
	}
	for i := 0; i < 6; i++ {
		logs[i].Type = model.LogTypeError
	}
	summary := aggregateMemberUsage(nil, nil, logs, 100, 200)
	require.Len(t, summary.Members, 1)
	// Cache efficiency is the only member-analysis attention signal. Error and
	// frequency metrics remain visible as context but are not verdicts.
	assert.Empty(t, summary.Members[0].Attention)
	assert.Equal(t, 0, summary.AttentionMembers)
	logs[0].Type = model.LogTypeConsume
	summary = aggregateMemberUsage(nil, nil, logs[:29], 100, 200)
	assert.Empty(t, summary.Members[0].Attention)
}

func TestMemberUsageRangeRejectsInvalidAndOverlongIntervals(t *testing.T) {
	now := time.Now().Unix()
	for _, interval := range [][2]int64{{0, now}, {now, now}, {now, now - 1}, {now - 32*86400, now}, {now, now + 2*86400}} {
		assert.Error(t, ValidateMemberUsageRange(interval[0], interval[1]))
	}
	assert.NoError(t, ValidateMemberUsageRange(now-31*86400, now))
}

func TestMemberUsageArchivePersistsSnapshotAndLeavesSourceDataUnchanged(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	logDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, logDB
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		for _, connection := range []*gorm.DB{db, logDB} {
			sqlDB, closeErr := connection.DB()
			if closeErr == nil {
				_ = sqlDB.Close()
			}
		}
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.MemberUsageProfile{}, &model.MemberUsageReport{}, &model.UsageReferencePrice{}, &model.UsageCost{}))
	require.NoError(t, logDB.AutoMigrate(&model.Log{}))
	user := model.User{Username: "archive-member", AffCode: "archive-aff", Role: 1, Status: 1, Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	now := time.Now().Unix()
	require.NoError(t, logDB.Create(&model.Log{UserId: user.Id, Type: model.LogTypeConsume, CreatedAt: now - 20, PromptTokens: 25}).Error)
	ctx := context.Background()
	profile := model.MemberUsageProfile{UserID: user.Id, MemberType: "full_time", Project: " Project A ", Purpose: "Research", UpdatedBy: 99}
	require.NoError(t, UpdateMemberUsageProfile(ctx, &profile))
	assert.Equal(t, "Project A", profile.Project)
	report := model.MemberUsageReport{Title: "Weekly report", Note: "Human review", StartTime: now - 60, EndTime: now, CreatedBy: 99}
	require.NoError(t, ArchiveMemberUsageReport(ctx, &report))
	profile.Project = "Project B"
	require.NoError(t, UpdateMemberUsageProfile(ctx, &profile))
	stored, err := model.GetMemberUsageReport(ctx, report.ID)
	require.NoError(t, err)
	var snapshot MemberUsageSummary
	require.NoError(t, common.Unmarshal([]byte(stored.Snapshot), &snapshot))
	require.Len(t, snapshot.Members, 1)
	assert.Equal(t, "Project A", snapshot.Members[0].Profile.Project)
	assert.EqualValues(t, 25, snapshot.Totals.Tokens)
	current, err := BuildMemberUsageSummary(ctx, now-60, now)
	require.NoError(t, err)
	assert.Equal(t, "Project B", current.Members[0].Profile.Project)
	list, err := model.ListMemberUsageReports(ctx)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Empty(t, list[0].Snapshot)
	var logCount, profileCount int64
	require.NoError(t, logDB.Model(&model.Log{}).Count(&logCount).Error)
	require.NoError(t, db.Model(&model.MemberUsageProfile{}).Count(&profileCount).Error)
	assert.EqualValues(t, 1, logCount)
	assert.EqualValues(t, 1, profileCount)
	var unchanged model.User
	require.NoError(t, db.First(&unchanged, user.Id).Error)
	assert.Equal(t, 1000, unchanged.Quota)
	assert.Equal(t, 1, unchanged.Role)
	profile.MemberType = "admin"
	assert.Error(t, UpdateMemberUsageProfile(ctx, &profile))
	profile.MemberType = "other"
	assert.NoError(t, UpdateMemberUsageProfile(ctx, &profile))
}
