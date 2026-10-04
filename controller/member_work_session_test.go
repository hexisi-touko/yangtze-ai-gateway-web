package controller

import (
	"net/http"
	"net/http/httptest"
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

func TestWorkSessionOwnershipAndLifecycle(t *testing.T) {
	oldDB, oldRedis, oldType := model.DB, common.RedisEnabled, common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, common.RedisEnabled = db, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, common.RedisEnabled = oldDB, oldRedis
		common.SetMainDatabaseType(oldType)
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.MemberUsageProfile{}, &model.MemberWorkSession{}))
	for i, key := range []string{"work-member-one", "work-member-two", "work-admin"} {
		role := common.RoleCommonUser
		if i == 2 {
			role = common.RoleAdminUser
		}
		token := key
		require.NoError(t, db.Create(&model.User{Id: 9101 + i, Username: key, Role: role, Status: common.UserStatusEnabled, AccessToken: &token, AffCode: key}).Error)
	}
	r := gin.New()
	r.POST("/api/work-sessions", middleware.DisableCache(), middleware.UserAuth(), StartMemberWorkSession)
	r.POST("/api/work-sessions/:session_id/heartbeat", middleware.UserAuth(), TouchMemberWorkSession)
	r.POST("/api/work-sessions/:session_id/stop", middleware.UserAuth(), StopMemberWorkSession)
	r.GET("/api/member-usage/work-sessions", middleware.DisableCache(), middleware.AdminAuth(), ListMemberWorkSessions)
	call := func(method, url, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, url, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	id := "550e8400-e29b-41d4-a716-446655440000"
	body := `{"session_id":"` + id + `","project":"oilfield","branch":"main","source":"git","purpose":"research","user_id":9102,"selectedPath":"C:/private","started_at":1}`
	assert.Equal(t, http.StatusUnauthorized, call("POST", "/api/work-sessions", "", body).Code)
	w := call("POST", "/api/work-sessions", "work-member-one", body)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
	assert.NotContains(t, w.Body.String(), "private")
	var row model.MemberWorkSession
	require.NoError(t, db.First(&row).Error)
	assert.Equal(t, 9101, row.UserID)
	assert.Greater(t, row.StartedAt, int64(1))
	assert.Equal(t, http.StatusNotFound, call("POST", "/api/work-sessions/"+id+"/stop", "work-member-two", "").Code)
	assert.Equal(t, http.StatusOK, call("POST", "/api/work-sessions/"+id+"/heartbeat", "work-member-one", "").Code)
	assert.Equal(t, http.StatusForbidden, call("GET", "/api/member-usage/work-sessions", "work-member-one", "").Code)
	admin := call("GET", "/api/member-usage/work-sessions", "work-admin", "")
	require.Equal(t, http.StatusOK, admin.Code, admin.Body.String())
	assert.Contains(t, admin.Body.String(), "oilfield")
	assert.NotContains(t, admin.Body.String(), "access_token")
	assert.Equal(t, http.StatusOK, call("POST", "/api/work-sessions/"+id+"/stop", "work-member-one", "").Code)
	assert.Equal(t, http.StatusOK, call("POST", "/api/work-sessions/"+id+"/stop", "work-member-one", "").Code)
	assert.Equal(t, http.StatusBadRequest, call("POST", "/api/work-sessions/"+id+"/heartbeat", "work-member-one", "").Code)
	assert.Equal(t, http.StatusOK, call("POST", "/api/work-sessions", "work-member-one", strings.Replace(body, "oilfield", "other", 1)).Code)
	require.NoError(t, db.First(&row).Error)
	assert.Equal(t, "oilfield", row.Project)
	assert.Greater(t, row.EndedAt, int64(0))
	var count int64
	require.NoError(t, db.Model(&model.MemberWorkSession{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
	assert.Equal(t, http.StatusBadRequest, call("POST", "/api/work-sessions", "work-member-one", strings.Repeat("x", 5000)).Code)
	assert.Equal(t, http.StatusBadRequest, call("POST", "/api/work-sessions", "work-member-one", strings.Replace(body, "oilfield", "C:/private", 1)).Code)
}
