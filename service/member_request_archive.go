package service

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/google/uuid"
)

var memberReportTimezone = time.FixedZone("Asia/Shanghai", 8*60*60)
var memberArchiveRebuildMu sync.Mutex

type MemberRequestArchiveEntry struct {
	UserID        int    `json:"user_id"`
	DisplayName   string `json:"display_name"`
	Username      string `json:"username"`
	File          string `json:"file"`
	SHA256        string `json:"sha256"`
	Records       int64  `json:"records"`
	SourceRecords int64  `json:"source_records"`
	MaxID         int64  `json:"max_id"`
}

type MemberRequestArchive struct {
	Version   int                         `json:"version"`
	CreatedAt int64                       `json:"created_at"`
	Start     int64                       `json:"start"`
	End       int64                       `json:"end"`
	Timezone  string                      `json:"timezone"`
	Rebuilt   bool                        `json:"rebuilt"`
	Members   []MemberRequestArchiveEntry `json:"members"`
}

func memberArchiveDirectory() string {
	// The production image runs in /data, which is already a persistent mount.
	if configured := os.Getenv("MEMBER_REQUEST_ARCHIVE_DIR"); configured != "" {
		return configured
	}
	return "./member-request-archives"
}

func memberArchivePath(name string) (string, error) {
	if name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) || !strings.HasSuffix(name, ".jsonl.gz") {
		return "", errors.New("member_usage_archive_invalid_file")
	}
	return filepath.Join(memberArchiveDirectory(), name), nil
}

func DecodeMemberRequestArchive(report *model.MemberUsageReport) (*MemberRequestArchive, error) {
	if report.RequestArchive == "" {
		return nil, errors.New("member_usage_archive_legacy")
	}
	var archive MemberRequestArchive
	if common.UnmarshalJsonStr(report.RequestArchive, &archive) != nil || archive.Version != 1 || archive.Start != report.StartTime || archive.End != report.EndTime {
		return nil, errors.New("member_usage_archive_invalid_file")
	}
	return &archive, nil
}

// Files are immutable. Database metadata is only published after all files finish.
func buildMemberRequestArchive(ctx context.Context, report *model.MemberUsageReport, rebuilt bool) error {
	var created []string
	complete := false
	defer func() {
		if !complete {
			for _, name := range created {
				_ = os.Remove(name)
			}
		}
	}()
	var users []struct {
		UserID   int
		Username string
	}
	if err := model.DB.WithContext(ctx).Model(&model.MemberRequestContent{}).
		Select("user_id, MAX(username) AS username").Where("created_at >= ? AND created_at < ?", report.StartTime, report.EndTime).
		Group("user_id").Scan(&users).Error; err != nil {
		return err
	}
	sort.Slice(users, func(i, j int) bool { return users[i].UserID < users[j].UserID })
	displayNames := make(map[int]string, len(users))
	if len(users) > 0 && model.DB.Migrator().HasTable(&model.User{}) {
		ids := make([]int, 0, len(users))
		for _, user := range users {
			ids = append(ids, user.UserID)
		}
		var identities []struct {
			ID          int
			DisplayName string
			Username    string
		}
		if err := model.DB.WithContext(ctx).Model(&model.User{}).
			Select("id, display_name, username").Where("id IN ?", ids).Find(&identities).Error; err != nil {
			return err
		}
		for _, identity := range identities {
			name := strings.TrimSpace(identity.DisplayName)
			if name == "" {
				name = strings.TrimSpace(identity.Username)
			}
			displayNames[identity.ID] = name
		}
	}
	if err := os.MkdirAll(memberArchiveDirectory(), 0700); err != nil {
		return err
	}
	archive := MemberRequestArchive{Version: 1, CreatedAt: time.Now().Unix(), Start: report.StartTime, End: report.EndTime, Timezone: "Asia/Shanghai", Rebuilt: rebuilt, Members: []MemberRequestArchiveEntry{}}
	for _, user := range users {
		count, maxID, err := model.MemberRequestArchiveBounds(ctx, user.UserID, report.StartTime, report.EndTime)
		if err != nil {
			return err
		}
		entry := MemberRequestArchiveEntry{UserID: user.UserID, DisplayName: displayNames[user.UserID], Username: user.Username, File: uuid.NewString() + ".jsonl.gz", SourceRecords: count, MaxID: maxID}
		name, err := memberArchivePath(entry.File)
		if err != nil {
			return err
		}
		file, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		created = append(created, name)
		compressed := gzip.NewWriter(file)
		var afterTime, afterID, scanned int64
		for {
			rows, readErr := model.ReadMemberRequestArchiveBatch(ctx, user.UserID, report.StartTime, report.EndTime, maxID, afterTime, afterID)
			if readErr != nil {
				err = readErr
				break
			}
			if len(rows) == 0 {
				break
			}
			for _, row := range rows {
				afterTime, afterID = row.CreatedAt, row.ID
				scanned++
				row.Content = normalizeStoredMemberRequestContent(row.Content)
				if row.Content == "" {
					continue
				}
				row.ContentText = memberRequestPlainText(row.Content)
				var data []byte
				data, err = common.Marshal(row)
				if err != nil {
					break
				}
				_, err = compressed.Write(append(data, '\n'))
				if err != nil {
					break
				}
				entry.Records++
			}
			if err != nil {
				break
			}
		}
		closeErr := compressed.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = file.Sync()
		}
		closeErr = file.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil && scanned != count {
			err = errors.New("member_usage_archive_source_changed")
		}
		if err != nil {
			_ = os.Remove(name)
			return err
		}
		entry.SHA256, err = memberArchiveChecksum(name)
		if err != nil {
			return err
		}
		archive.Members = append(archive.Members, entry)
	}
	data, err := common.Marshal(archive)
	if err != nil {
		return err
	}
	report.RequestArchive = string(data)
	complete = true
	return nil
}

func discardMemberRequestArchive(report *model.MemberUsageReport) {
	archive, err := DecodeMemberRequestArchive(report)
	if err != nil {
		return
	}
	for _, entry := range archive.Members {
		if name, err := memberArchivePath(entry.File); err == nil {
			_ = os.Remove(name)
		}
	}
	report.RequestArchive = ""
}

func memberArchiveChecksum(name string) (string, error) {
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func EnsureMemberRequestArchive(ctx context.Context, report *model.MemberUsageReport) (*MemberRequestArchive, error) {
	memberArchiveRebuildMu.Lock()
	defer memberArchiveRebuildMu.Unlock()
	latest, err := model.GetMemberUsageReport(ctx, report.ID)
	if err != nil {
		return nil, err
	}
	report.RequestArchive = latest.RequestArchive
	if report.RequestArchive != "" {
		return DecodeMemberRequestArchive(report)
	}
	if err := buildMemberRequestArchive(ctx, report, true); err != nil {
		return nil, err
	}
	result := model.DB.WithContext(ctx).Model(report).Where("request_archive = ? OR request_archive IS NULL", "").Update("request_archive", report.RequestArchive)
	if result.Error != nil {
		discardMemberRequestArchive(report)
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		discardMemberRequestArchive(report)
		latest, err = model.GetMemberUsageReport(ctx, report.ID)
		if err != nil {
			return nil, err
		}
		report.RequestArchive = latest.RequestArchive
	}
	return DecodeMemberRequestArchive(report)
}

// Stream a large export to the configured data disk before sending HTTP headers.
func CreateMemberRequestDocumentFile(ctx context.Context, report *model.MemberUsageReport, userID int) (string, error) {
	if err := os.MkdirAll(memberArchiveDirectory(), 0700); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(memberArchiveDirectory(), ".member-export-*.html")
	if err != nil {
		return "", err
	}
	name := file.Name()
	err = ExportMemberRequestDocument(ctx, report, userID, file)
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(name)
		return "", err
	}
	return name, nil
}

func verifyMemberArchiveEntry(entry MemberRequestArchiveEntry) (string, error) {
	name, err := memberArchivePath(entry.File)
	if err != nil {
		return "", err
	}
	checksum, err := memberArchiveChecksum(name)
	if err != nil || checksum != entry.SHA256 {
		return "", errors.New("member_usage_archive_file_unavailable")
	}
	return name, nil
}

// Check the saved files and high-water marks before reclaiming online bodies.
func VerifiedArchivedMemberIDs(ctx context.Context, report *model.MemberUsageReport, wanted []int) ([]int, error) {
	archive, err := DecodeMemberRequestArchive(report)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(wanted))
	for _, id := range wanted {
		for _, entry := range archive.Members {
			if entry.UserID != id {
				continue
			}
			if _, err = verifyMemberArchiveEntry(entry); err != nil {
				return nil, err
			}
			count, maxID, err := model.MemberRequestArchiveBounds(ctx, id, report.StartTime, report.EndTime)
			if err != nil {
				return nil, err
			}
			if count > 0 && (count != entry.SourceRecords || maxID != entry.MaxID) {
				return nil, errors.New("member_usage_archive_source_changed")
			}
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func CleanupArchivedMemberRequestContent(ctx context.Context, report *model.MemberUsageReport, wanted []int) (int64, error) {
	ids, err := VerifiedArchivedMemberIDs(ctx, report, wanted)
	if err != nil {
		return 0, err
	}
	archive, err := DecodeMemberRequestArchive(report)
	if err != nil {
		return 0, err
	}
	var deleted int64
	for _, entry := range archive.Members {
		for _, id := range ids {
			if entry.UserID != id {
				continue
			}
			result := model.DB.WithContext(ctx).Where("user_id = ? AND created_at >= ? AND created_at < ? AND id <= ?", id, report.StartTime, report.EndTime, entry.MaxID).Delete(&model.MemberRequestContent{})
			if result.Error != nil {
				return deleted, result.Error
			}
			deleted += result.RowsAffected
		}
	}
	return deleted, nil
}

func CleanupArchivedRequestContentBefore(ctx context.Context, cutoff int64) (int64, error) {
	var reports []model.MemberUsageReport
	if err := model.DB.WithContext(ctx).Where("end_time <= ? AND request_archive <> ?", cutoff, "").Find(&reports).Error; err != nil {
		return 0, err
	}
	var deleted int64
	for i := range reports {
		archive, err := DecodeMemberRequestArchive(&reports[i])
		if err != nil {
			return deleted, err
		}
		ids := make([]int, 0, len(archive.Members))
		for _, entry := range archive.Members {
			ids = append(ids, entry.UserID)
		}
		count, err := CleanupArchivedMemberRequestContent(ctx, &reports[i], ids)
		if err != nil {
			return deleted, err
		}
		deleted += count
	}
	return deleted, nil
}

func ExportMemberRequestDocument(ctx context.Context, report *model.MemberUsageReport, userID int, output io.Writer) error {
	archive, err := DecodeMemberRequestArchive(report)
	if err != nil {
		return err
	}
	var entry *MemberRequestArchiveEntry
	for i := range archive.Members {
		if archive.Members[i].UserID == userID {
			entry = &archive.Members[i]
			break
		}
	}
	if entry == nil {
		return errors.New("member_usage_not_found")
	}
	name, err := verifyMemberArchiveEntry(*entry)
	if err != nil {
		return err
	}
	file, err := os.Open(name)
	if err != nil {
		return err
	}
	defer file.Close()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer compressed.Close()
	write := func(format string, args ...any) error { _, err := fmt.Fprintf(output, format, args...); return err }
	memberName := strings.TrimSpace(entry.DisplayName)
	if memberName == "" {
		memberName = strings.TrimSpace(entry.Username)
	}
	if err = write(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>%s - 成员请求文档</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 20px;color:#20252b}h1{font-size:24px}h2{font-size:20px;border-bottom:1px solid #ddd;padding-bottom:8px}article{margin:24px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;line-height:1.7}small{color:#59636e}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:16px 0;padding:12px;background:#f5f7f9;border:1px solid #e1e5e8;border-radius:6px}@media print{article{break-inside:auto}}</style><h1>成员请求文档</h1><div class="meta"><div><strong>成员 ID：</strong>%d</div><div><strong>成员名称：</strong>%s</div><div><strong>登录名：</strong>%s</div><div><strong>统计周期：</strong>%s 至 %s（北京时间）</div><div><strong>请求条数：</strong>%d</div></div><p>以下按日期记录系统采集的成员请求正文，不包含 AI 回复。</p>`, html.EscapeString(memberName), entry.UserID, html.EscapeString(memberName), html.EscapeString(entry.Username), time.Unix(report.StartTime, 0).In(memberReportTimezone).Format("2006-01-02"), time.Unix(report.EndTime-1, 0).In(memberReportTimezone).Format("2006-01-02"), entry.Records); err != nil {
		return err
	}
	if archive.Rebuilt {
		if err = write("<p>此文档由旧记录补建，仅包含补建时仍然存在的正文；未采集或已清理的内容无法恢复。</p>"); err != nil {
			return err
		}
	}
	reader := bufio.NewReader(compressed)
	var lastDay string
	var seen int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			var row model.MemberRequestContent
			if err = common.Unmarshal(line, &row); err != nil {
				return err
			}
			stamp := time.Unix(row.CreatedAt, 0).In(memberReportTimezone)
			day := stamp.Format("2006年01月02日")
			if day != lastDay {
				if err = write("<h2>%s</h2>", day); err != nil {
					return err
				}
				lastDay = day
			}
			var text struct {
				Content string `json:"content"`
			}
			body := row.ContentText
			if body == "" {
				body = row.Content
				if common.UnmarshalJsonStr(body, &text) == nil {
					body = text.Content
				}
			}
			if err = write("<article><h3>%s</h3><small>模型：%s · 请求编号：%s</small><pre>%s</pre>", stamp.Format("15:04:05"), html.EscapeString(row.Model), html.EscapeString(row.RequestID), html.EscapeString(body)); err != nil {
				return err
			}
			if row.Truncated {
				if err = write("<p>此历史正文在采集时已截断，文档无法补回未保存的部分。</p>"); err != nil {
					return err
				}
			}
			if err = write("</article>"); err != nil {
				return err
			}
			seen++
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if seen != entry.Records {
		return errors.New("member_usage_archive_invalid_file")
	}
	return write("</html>")
}
