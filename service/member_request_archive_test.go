package service

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func memberArchiveFixture(t *testing.T) (*gorm.DB, *model.MemberUsageReport) {
	t.Helper()
	t.Setenv("MEMBER_REQUEST_ARCHIVE_DIR", t.TempDir())
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.MemberRequestContent{}, &model.MemberUsageReport{}))
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous; _ = sqlDB.Close() })
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, memberReportTimezone).Unix()
	report := &model.MemberUsageReport{Title: "九月归档", StartTime: start, EndTime: start + 30*86400}
	require.NoError(t, db.Create(report).Error)
	return db, report
}

func TestMemberArchiveExportsFullChronologicalDocumentAfterOnlineCleanup(t *testing.T) {
	db, report := memberArchiveFixture(t)
	ctx := context.Background()
	long := strings.Repeat("完整中文内容", 20000) + "正文最后一行<script>alert(1)</script>"
	rows := []model.MemberRequestContent{
		{UserID: 1, Username: "成员甲", CreatedAt: report.StartTime + 86401, Content: long},
		{UserID: 1, Username: "成员甲", CreatedAt: report.StartTime + 1, Content: `{"input":[{"role":"system","content":"系统提示"},{"role":"user","content":"第一天请求"}]}`},
		{UserID: 2, Username: "成员乙", CreatedAt: report.StartTime + 2, Content: "其他成员的内容"},
		{UserID: 1, Username: "成员甲", CreatedAt: report.EndTime, Content: "下个月内容"},
	}
	for _, row := range rows {
		require.NoError(t, db.Create(&row).Error)
	}
	// The monthly export must not inherit the old 1000-row listing ceiling.
	for i := 0; i < 1002; i++ {
		require.NoError(t, db.Create(&model.MemberRequestContent{UserID: 1, Username: "成员甲", CreatedAt: report.StartTime + int64(i+2), Content: "普通请求"}).Error)
	}
	archive, err := EnsureMemberRequestArchive(ctx, report)
	require.NoError(t, err)
	require.Len(t, archive.Members, 2)
	assert.EqualValues(t, 1004, archive.Members[0].Records)
	assert.True(t, archive.Rebuilt)
	deleted, err := CleanupArchivedMemberRequestContent(ctx, report, []int{1})
	require.NoError(t, err)
	assert.EqualValues(t, 1004, deleted)
	var output bytes.Buffer
	require.NoError(t, ExportMemberRequestDocument(ctx, report, 1, &output))
	text := output.String()
	assert.Contains(t, text, "2026年09月01日")
	assert.Contains(t, text, "2026年09月02日")
	assert.Less(t, strings.Index(text, "第一天请求"), strings.Index(text, "正文最后一行"))
	assert.Contains(t, text, "正文最后一行&lt;script&gt;")
	assert.NotContains(t, text, "<script>")
	assert.NotContains(t, text, "其他成员的内容")
	assert.NotContains(t, text, "下个月内容")
	assert.NotContains(t, text, "系统提示")
	assert.Equal(t, 1004, strings.Count(text, "<article>"))
	var remaining int64
	require.NoError(t, db.Model(&model.MemberRequestContent{}).Count(&remaining).Error)
	assert.EqualValues(t, 2, remaining)
}

func TestMemberArchiveMissingOrCorruptFileBlocksCleanup(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "corrupt"}[corrupt], func(t *testing.T) {
			db, report := memberArchiveFixture(t)
			require.NoError(t, db.Create(&model.MemberRequestContent{UserID: 1, CreatedAt: report.StartTime + 1, Content: "必须保留"}).Error)
			archive, err := EnsureMemberRequestArchive(context.Background(), report)
			require.NoError(t, err)
			path, err := memberArchivePath(archive.Members[0].File)
			require.NoError(t, err)
			if corrupt {
				require.NoError(t, os.WriteFile(path, []byte("broken"), 0600))
			} else {
				require.NoError(t, os.Remove(path))
			}
			deleted, err := CleanupArchivedMemberRequestContent(context.Background(), report, []int{1})
			require.Error(t, err)
			assert.Zero(t, deleted)
			var count int64
			require.NoError(t, db.Model(&model.MemberRequestContent{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
		})
	}
}

func TestMemberArchiveLateRequestBlocksCleanupAndRepeatedRebuildKeepsFiles(t *testing.T) {
	db, report := memberArchiveFixture(t)
	ctx := context.Background()
	require.NoError(t, db.Create(&model.MemberRequestContent{UserID: 1, CreatedAt: report.StartTime + 1, Content: "旧记录"}).Error)
	first, err := EnsureMemberRequestArchive(ctx, report)
	require.NoError(t, err)
	stale := *report
	stale.RequestArchive = ""
	second, err := EnsureMemberRequestArchive(ctx, &stale)
	require.NoError(t, err)
	assert.Equal(t, first.Members, second.Members)
	require.NoError(t, db.Create(&model.MemberRequestContent{UserID: 1, CreatedAt: report.StartTime + 2, Content: "晚到记录"}).Error)
	deleted, err := CleanupArchivedMemberRequestContent(ctx, report, []int{1})
	require.ErrorContains(t, err, "source_changed")
	assert.Zero(t, deleted)
}

func TestMemberRequestPagingAdvancesPastHiddenRecords(t *testing.T) {
	db, report := memberArchiveFixture(t)
	for _, content := range []string{"正常记录", repeatedToolCallReminder, repeatedToolCallReminder} {
		require.NoError(t, db.Create(&model.MemberRequestContent{UserID: 1, CreatedAt: report.StartTime + 1, Content: content}).Error)
	}
	page, err := ListMemberRequestContentPage(context.Background(), 1, report.StartTime, report.EndTime, 0, 2)
	require.NoError(t, err)
	assert.Empty(t, page.Items)
	assert.True(t, page.HasMore)
	assert.EqualValues(t, 2, page.NextCursor)
	page, err = ListMemberRequestContentPage(context.Background(), 1, report.StartTime, report.EndTime, page.NextCursor, 2)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.Equal(t, "正常记录", page.Items[0].Content)
	assert.False(t, page.HasMore)
}
