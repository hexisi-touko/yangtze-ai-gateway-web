package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAdminUpdatesAndArchiveRoutesRequireAdminAndExportOneMember(t *testing.T) {
	t.Setenv("MEMBER_REQUEST_ARCHIVE_DIR", t.TempDir())
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	oldDB, oldRedis := model.DB, common.RedisEnabled
	oldType := common.MainDatabaseType()
	model.DB, common.RedisEnabled = db, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, common.RedisEnabled = oldDB, oldRedis
		common.SetMainDatabaseType(oldType)
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.MemberUsageReport{}, &model.MemberRequestContent{}))
	memberKey, adminKey := "archive-member-test", "archive-admin-test"
	for _, u := range []model.User{
		{Username: "archive-member", AffCode: "archive-member", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AccessToken: &memberKey},
		{Username: "archive-admin", AffCode: "archive-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AccessToken: &adminKey},
	} {
		require.NoError(t, db.Create(&u).Error)
	}
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*3600)).Unix()
	report := &model.MemberUsageReport{Title: "九月", StartTime: start, EndTime: start + 30*86400}
	require.NoError(t, db.Create(report).Error)
	require.NoError(t, db.Create(&model.MemberRequestContent{UserID: 1, Username: "成员甲", CreatedAt: start + 1, Content: "成员请求正文"}).Error)
	_, err = service.EnsureMemberRequestArchive(context.Background(), report)
	require.NoError(t, err)
	router := gin.New()
	admin := router.Group("/api", middleware.AdminAuth())
	admin.GET("/admin-updates", GetAdminUpdates)
	admin.GET("/member-usage/reports/:id/requests", GetMemberReportRequestArchive)
	admin.POST("/member-usage/reports/:id/requests", RebuildMemberReportRequestArchive)
	admin.GET("/member-usage/reports/:id/members/:user_id/document", ExportMemberReportDocument)
	for _, path := range []string{"/api/admin-updates", "/api/member-usage/reports/1/requests", "/api/member-usage/reports/1/members/1/document"} {
		for _, token := range []string{"", memberKey, adminKey} {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if token != adminKey {
				assert.Contains(t, []int{401, 403}, res.Code)
				continue
			}
			assert.Equal(t, 200, res.Code)
			if strings.HasSuffix(path, "document") {
				assert.Contains(t, res.Header().Get("Content-Disposition"), "attachment")
				assert.Contains(t, res.Header().Get("Content-Type"), "text/html")
				assert.Contains(t, res.Body.String(), "成员请求正文")
			} else if strings.HasSuffix(path, "admin-updates") {
				assert.Contains(t, res.Body.String(), `"current_version":"1.0.1"`)
			}
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		req := httptest.NewRequest(method, "/api/member-usage/reports/invalid/requests", nil)
		req.Header.Set("Authorization", "Bearer "+adminKey)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		assert.Equal(t, 400, res.Code)
		assert.NotContains(t, res.Body.String(), "成员请求正文")
	}
}
