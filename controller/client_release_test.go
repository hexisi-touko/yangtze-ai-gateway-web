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

func TestClientReleaseAdminAndLatestVersionFlow(t *testing.T) {
	oldDB, oldRedis, oldType := model.DB, common.RedisEnabled, common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open("file:client-release-test?mode=memory&cache=shared"), &gorm.Config{})
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
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.ClientRelease{}))
	adminToken, memberToken := "client-release-admin", "client-release-member"
	admin := model.User{Username: "release-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AccessToken: &adminToken, AffCode: "release-admin"}
	member := model.User{Username: "release-member", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AccessToken: &memberToken, AffCode: "release-member"}
	require.NoError(t, db.Create(&admin).Error)
	require.NoError(t, db.Create(&member).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/client-releases/latest", GetLatestClientRelease)
	adminRoute := router.Group("/api/client-releases", middleware.DisableCache(), middleware.AdminAuth())
	adminRoute.GET("/", ListClientReleases)
	adminRoute.POST("/", CreateClientRelease)
	adminRoute.PUT("/:id", UpdateClientRelease)
	adminRoute.POST("/:id/:action", SetClientReleasePublished)
	adminRoute.DELETE("/:id", DeleteClientRelease)
	call := func(method, target, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}

	assert.Equal(t, http.StatusUnauthorized, call(http.MethodGet, "/api/client-releases/", "", "").Code)
	assert.Equal(t, http.StatusForbidden, call(http.MethodGet, "/api/client-releases/", memberToken, "").Code)
	assert.Equal(t, http.StatusBadRequest, call(http.MethodPost, "/api/client-releases/", adminToken, `{"version":"1.0.0","download_url":"http://updates.example/client.exe"}`).Code)

	create := func(version string) *httptest.ResponseRecorder {
		body := `{"version":"v` + version + `","platform":"windows-x64","channel":"stable","release_notes":"Fixes","download_url":"http://127.0.0.1:8080/client.exe","file_size":1234,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`
		return call(http.MethodPost, "/api/client-releases/", adminToken, body)
	}
	first := create("1.9.0")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	require.Contains(t, first.Body.String(), `"version":"1.9.0"`)
	assert.Contains(t, call(http.MethodGet, "/api/client-releases/latest?current_version=1.8.0", "", "").Body.String(), `"update_available":false`)

	var row model.ClientRelease
	require.NoError(t, db.Where("version = ?", "1.9.0").First(&row).Error)
	releaseID := strconv.Itoa(row.ID)
	assert.Equal(t, http.StatusForbidden, call(http.MethodPost, "/api/client-releases/"+releaseID+"/publish", memberToken, "").Code)
	require.Equal(t, http.StatusOK, call(http.MethodPost, "/api/client-releases/"+releaseID+"/publish", adminToken, "").Code)
	latest := call(http.MethodGet, "/api/client-releases/latest?current_version=1.8.0", "", "")
	require.Equal(t, http.StatusOK, latest.Code, latest.Body.String())
	assert.Contains(t, latest.Body.String(), `"update_available":true`)
	assert.Contains(t, latest.Body.String(), `"download_url":"http://127.0.0.1:8080/client.exe"`)

	second := create("1.10.0")
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	row = model.ClientRelease{}
	require.NoError(t, db.Where("version = ?", "1.10.0").First(&row).Error)
	secondID := strconv.Itoa(row.ID)
	require.Equal(t, http.StatusOK, call(http.MethodPost, "/api/client-releases/"+secondID+"/publish", adminToken, "").Code)
	assert.Contains(t, call(http.MethodGet, "/api/client-releases/latest", "", "").Body.String(), `"version":"1.10.0"`)
	assert.Equal(t, http.StatusConflict, call(http.MethodDelete, "/api/client-releases/"+secondID, adminToken, "").Code)

	require.Equal(t, http.StatusOK, call(http.MethodPost, "/api/client-releases/"+secondID+"/unpublish", adminToken, "").Code)
	assert.Contains(t, call(http.MethodGet, "/api/client-releases/latest", "", "").Body.String(), `"version":"1.9.0"`)
	assert.Equal(t, http.StatusOK, call(http.MethodDelete, "/api/client-releases/"+secondID, adminToken, "").Code)

	assert.Equal(t, http.StatusBadRequest, call(http.MethodGet, "/api/client-releases/latest?current_version=latest", "", "").Code)
	assert.Contains(t, call(http.MethodGet, "/api/client-releases/", adminToken, "").Body.String(), `"version":"1.9.0"`)
}
