package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMemberKeyRoutesRequireAuthentication(t *testing.T) {
	previousRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = previousRedis })
	engine := gin.New()
	SetApiRouter(engine)
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, "/api/token/admin/members?p=1&size=20"},
		{http.MethodPost, "/api/token/admin/members/1/key"},
	} {
		t.Run(request.method, func(t *testing.T) {
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(request.method, request.path, nil))
			assert.Equal(t, http.StatusUnauthorized, response.Code)
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		})
	}
}

func TestMemberKeyRoutesDenyOrdinaryMembers(t *testing.T) {
	oldDB, oldRedis, oldType := model.DB, common.RedisEnabled, common.MainDatabaseType()
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
	require.NoError(t, db.AutoMigrate(&model.User{}))
	credential := "member-keys-access-test"
	require.NoError(t, db.Create(&model.User{Username: "ordinary-member", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AccessToken: &credential, AffCode: "member-keys-aff"}).Error)
	engine := gin.New()
	SetApiRouter(engine)
	for _, input := range []struct{ method, path string }{
		{http.MethodGet, "/api/token/admin/members"},
		{http.MethodPost, "/api/token/admin/members/1/key"},
	} {
		t.Run(input.method, func(t *testing.T) {
			request := httptest.NewRequest(input.method, input.path, nil)
			request.Header.Set("Authorization", "Bearer "+credential)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			assert.Equal(t, http.StatusForbidden, response.Code)
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		})
	}
}
