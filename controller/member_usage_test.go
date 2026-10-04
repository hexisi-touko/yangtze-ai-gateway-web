package controller

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMemberUsageAdminBoundary(t *testing.T) {
	oldDB, oldRedis := model.DB, common.RedisEnabled
	oldType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, common.RedisEnabled = db, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, common.RedisEnabled = oldDB, oldRedis
		common.SetMainDatabaseType(oldType)
		sqlDB, closeErr := db.DB()
		if closeErr == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.MemberAnalysisConfig{}, &model.MemberUsageProfile{}))
	require.NoError(t, db.Create(&model.MemberAnalysisConfig{ID: 1, APIKey: "analysis-private-test-key", BaseURL: "https://analysis.example/v1", Model: "test-model"}).Error)
	memberKey, adminKey := "member-usage-member-test", "member-usage-admin-test"
	member := model.User{Username: "usage-member", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AccessToken: &memberKey, AffCode: "usage-member-aff"}
	require.NoError(t, db.Create(&member).Error)
	require.NoError(t, db.Create(&model.User{Username: "usage-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AccessToken: &adminKey, AffCode: "usage-admin-aff"}).Error)
	router := gin.New()
	router.GET("/api/member-usage/summary", middleware.AdminAuth(), GetMemberUsageSummary)
	router.PUT("/api/member-usage/profiles/:user_id", middleware.AdminAuth(), PutMemberUsageProfile)
	router.GET("/api/member-usage/ai/config", middleware.AdminAuth(), GetMemberAnalysisConfig)
	router.POST("/api/member-usage/ai/chat", middleware.AdminAuth(), ChatMemberAnalysis)
	router.GET("/api/member-usage/value", middleware.AdminAuth(), GetUsageValue)
	router.POST("/api/member-usage/value/prices", middleware.AdminAuth(), PostUsageReferencePrice)
	router.POST("/api/member-usage/value/costs", middleware.AdminAuth(), PostUsageCost)
	router.DELETE("/api/member-usage/value/costs/:id", middleware.AdminAuth(), DeleteUsageCost)
	for _, endpoint := range []struct{ method, path string }{
		{http.MethodGet, "/api/member-usage/value"},
		{http.MethodPost, "/api/member-usage/value/prices"},
		{http.MethodPost, "/api/member-usage/value/costs"},
		{http.MethodDelete, "/api/member-usage/value/costs/1"},
	} {
		for _, token := range []string{"", memberKey} {
			req := httptest.NewRequest(endpoint.method, endpoint.path, nil)
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, res.Code)
		}
	}
	for _, token := range []string{"", memberKey, adminKey} {
		req := httptest.NewRequest(http.MethodGet, "/api/member-usage/ai/config", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		assert.NotContains(t, res.Body.String(), "analysis-private-test-key")
		if token == adminKey {
			assert.Equal(t, http.StatusOK, res.Code)
			assert.Contains(t, res.Body.String(), `"has_key":true`)
		} else {
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, res.Code)
		}
	}
	for _, token := range []string{"", memberKey} {
		req := httptest.NewRequest(http.MethodPost, "/api/member-usage/ai/chat", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, res.Code)
	}
	for _, test := range []struct {
		name, token string
		status      int
	}{
		{"anonymous", "", http.StatusUnauthorized}, {"member", memberKey, http.StatusForbidden}, {"admin invalid range", adminKey, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/member-usage/summary?start=0&end=0", nil)
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, test.status, response.Code)
			if test.token == adminKey {
				assert.Contains(t, response.Body.String(), "member_usage_invalid_range")
			}
		})
	}
	require.NoError(t, db.Create(&model.MemberUsageProfile{UserID: member.Id, MemberType: "intern", Project: "legacy project", Purpose: "legacy purpose"}).Error)
	request := httptest.NewRequest(http.MethodPut, "/api/member-usage/profiles/"+strconv.Itoa(member.Id), strings.NewReader(`{"member_type":"other","project":"must be ignored","purpose":"must be ignored"}`))
	request.Header.Set("Authorization", "Bearer "+adminKey)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	var profile model.MemberUsageProfile
	require.NoError(t, db.First(&profile, member.Id).Error)
	assert.Equal(t, "other", profile.MemberType)
	assert.Equal(t, "legacy project", profile.Project)
	assert.Equal(t, "legacy purpose", profile.Purpose)
}
