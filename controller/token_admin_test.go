package controller

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupManagedTokenTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB, oldLogDB, oldRedis := model.DB, model.LOG_DB, common.RedisEnabled
	oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled = oldDB, oldLogDB, oldRedis
		common.SetDatabaseTypes(oldMainType, oldLogType)
	})
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserApplication{}))
	return db
}

type managedMemberTokenPageResponse struct {
	Items []model.ManagedMemberToken `json:"items"`
	Total int                        `json:"total"`
}

func seedManagedTokenUser(t *testing.T, username string, role int, status int) model.User {
	t.Helper()
	user := model.User{
		Username: username, Password: "password-hash", DisplayName: username + " display",
		Email: username + "@example.com", Role: role, Status: status, Group: "default",
		Quota: 9000, UsedQuota: 1200, RequestCount: 37, AuthVersion: 1, AffCode: username + "-aff",
	}
	require.NoError(t, model.DB.Create(&user).Error)
	return user
}

func markTokenAsApplicationIssued(t *testing.T, userId int, tokenId int) {
	t.Helper()
	application := model.UserApplication{
		UserId: userId, Reason: "Approved project access request.", Status: model.UserApplicationStatusApproved,
		IssuedTokenId: &tokenId, CreatedAt: 1700000000, UpdatedAt: 1700000000,
	}
	require.NoError(t, model.DB.Create(&application).Error)
}

func TestAdminListMemberTokensConnectsMaskedKeyWithMemberUsage(t *testing.T) {
	db := setupManagedTokenTestDB(t)

	member := seedManagedTokenUser(t, "member-one", common.RoleCommonUser, common.UserStatusEnabled)
	memberToken := seedToken(t, db, member.Id, "member-one approved access key", "memberkey1234567890")
	memberToken.UsedQuota = 700
	memberToken.RemainQuota = 8300
	memberToken.AccessedTime = 1700000000
	require.NoError(t, db.Save(memberToken).Error)
	markTokenAsApplicationIssued(t, member.Id, memberToken.Id)

	admin := seedManagedTokenUser(t, "admin-one", common.RoleAdminUser, common.UserStatusEnabled)
	adminToken := seedToken(t, db, admin.Id, "admin key", "adminkey1234567890")

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/admin/members?p=1&size=20", nil, admin.Id)
	AdminListMemberTokens(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var page managedMemberTokenPageResponse
	require.NoError(t, common.Unmarshal(response.Data, &page))
	require.Len(t, page.Items, 1)
	assert.Equal(t, 1, page.Total)
	assert.Equal(t, member.Id, page.Items[0].UserId)
	assert.Equal(t, member.Username, page.Items[0].Username)
	assert.Equal(t, member.RequestCount, page.Items[0].UserRequestCount)
	assert.Equal(t, member.UsedQuota, page.Items[0].UserUsedQuota)
	assert.Equal(t, memberToken.UsedQuota, page.Items[0].UsedQuota)
	assert.Equal(t, memberToken.GetMaskedKey(), page.Items[0].Key)
	assert.NotContains(t, recorder.Body.String(), memberToken.Key)
	assert.NotContains(t, recorder.Body.String(), adminToken.Key)
}

func TestAdminListMemberTokensFiltersByMemberAndTokenStatus(t *testing.T) {
	db := setupManagedTokenTestDB(t)

	matchingMember := seedManagedTokenUser(t, "matching-member", common.RoleCommonUser, common.UserStatusEnabled)
	matchingToken := seedToken(t, db, matchingMember.Id, "approved access key", "matching1234567890")
	markTokenAsApplicationIssued(t, matchingMember.Id, matchingToken.Id)
	disabledMember := seedManagedTokenUser(t, "matching-disabled", common.RoleCommonUser, common.UserStatusDisabled)
	disabledToken := seedToken(t, db, disabledMember.Id, "disabled access key", "disabled1234567890")
	disabledToken.Status = common.TokenStatusDisabled
	require.NoError(t, db.Save(disabledToken).Error)
	markTokenAsApplicationIssued(t, disabledMember.Id, disabledToken.Id)

	requestPath := "/api/token/admin/members?p=1&size=20&keyword=matching-member&status=" + strconv.Itoa(common.TokenStatusEnabled)
	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, requestPath, nil, 99)
	AdminListMemberTokens(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var page managedMemberTokenPageResponse
	require.NoError(t, common.Unmarshal(response.Data, &page))
	require.Len(t, page.Items, 1)
	assert.Equal(t, matchingToken.Id, page.Items[0].Id)
}

func TestAdminGetMemberTokenKeyReturnsOnlyMemberKey(t *testing.T) {
	db := setupManagedTokenTestDB(t)

	member := seedManagedTokenUser(t, "key-member", common.RoleCommonUser, common.UserStatusEnabled)
	memberToken := seedToken(t, db, member.Id, "approved access key", "fullmemberkey123456")
	markTokenAsApplicationIssued(t, member.Id, memberToken.Id)
	admin := seedManagedTokenUser(t, "key-admin", common.RoleAdminUser, common.UserStatusEnabled)
	adminToken := seedToken(t, db, admin.Id, "admin key", "fulladminkey12345678")

	memberCtx, memberRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/admin/members/1/key", nil, admin.Id)
	memberCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(memberToken.Id)}}
	AdminGetMemberTokenKey(memberCtx)
	memberResponse := decodeAPIResponse(t, memberRecorder)
	require.True(t, memberResponse.Success, memberResponse.Message)
	var keyData tokenKeyResponse
	require.NoError(t, common.Unmarshal(memberResponse.Data, &keyData))
	assert.Equal(t, memberToken.Key, keyData.Key)

	adminCtx, adminRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/admin/members/2/key", nil, admin.Id)
	adminCtx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(adminToken.Id)}}
	AdminGetMemberTokenKey(adminCtx)
	adminResponse := decodeAPIResponse(t, adminRecorder)
	assert.False(t, adminResponse.Success)
	assert.False(t, strings.Contains(adminRecorder.Body.String(), adminToken.Key))
}

func TestAdminMemberKeysExcludeUnissuedMismatchedAndDeletedTokens(t *testing.T) {
	db := setupManagedTokenTestDB(t)
	member := seedManagedTokenUser(t, "scope-member", common.RoleCommonUser, common.UserStatusEnabled)
	other := seedManagedTokenUser(t, "other-member", common.RoleCommonUser, common.UserStatusEnabled)
	valid := seedToken(t, db, member.Id, "approved", "valid-member-secret")
	markTokenAsApplicationIssued(t, member.Id, valid.Id)
	markTokenAsApplicationIssued(t, member.Id, valid.Id)
	unissued := seedToken(t, db, member.Id, "private", "unissued-secret")
	mismatched := seedToken(t, db, other.Id, "mismatch", "mismatched-secret")
	markTokenAsApplicationIssued(t, member.Id, mismatched.Id)
	deleted := seedToken(t, db, member.Id, "deleted", "deleted-secret")
	markTokenAsApplicationIssued(t, member.Id, deleted.Id)
	require.NoError(t, db.Delete(deleted).Error)
	deletedOwner := seedManagedTokenUser(t, "deleted-owner", common.RoleCommonUser, common.UserStatusEnabled)
	deletedOwnerKey := seedToken(t, db, deletedOwner.Id, "owner deleted", "deleted-owner-secret")
	markTokenAsApplicationIssued(t, deletedOwner.Id, deletedOwnerKey.Id)
	require.NoError(t, db.Delete(&deletedOwner).Error)
	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/admin/members?p=1&size=1", nil, 99)
	AdminListMemberTokens(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success)
	var page managedMemberTokenPageResponse
	require.NoError(t, common.Unmarshal(response.Data, &page))
	require.Len(t, page.Items, 1)
	assert.Equal(t, 1, page.Total)
	assert.Equal(t, valid.Id, page.Items[0].Id)
	for _, token := range []*model.Token{unissued, mismatched, deleted, deletedOwnerKey} {
		ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/admin/members/key", nil, 99)
		ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(token.Id)}}
		AdminGetMemberTokenKey(ctx)
		assert.Equal(t, http.StatusNotFound, recorder.Code)
		assert.NotContains(t, recorder.Body.String(), token.Key)
	}
}

func TestAdminMemberKeysValidateFiltersAndEscapeSearch(t *testing.T) {
	db := setupManagedTokenTestDB(t)
	member := seedManagedTokenUser(t, "literal-member", common.RoleCommonUser, common.UserStatusEnabled)
	token := seedToken(t, db, member.Id, "Review 100%_Done", "literal-key-secret")
	markTokenAsApplicationIssued(t, member.Id, token.Id)
	for _, query := range []string{"?status=bad", "?status=0", "?status=5", "?p=-1", "?size=-1"} {
		ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/admin/members"+query, nil, 99)
		AdminListMemberTokens(ctx)
		assert.Equal(t, http.StatusBadRequest, recorder.Code, query)
	}
	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/admin/members?keyword=100%25_done", nil, 99)
	AdminListMemberTokens(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success)
	var page managedMemberTokenPageResponse
	require.NoError(t, common.Unmarshal(response.Data, &page))
	assert.Equal(t, 1, page.Total)
	ctx, recorder = newAuthenticatedContext(t, http.MethodGet, "/api/token/admin/members?keyword=nonexistent", nil, 99)
	AdminListMemberTokens(ctx)
	response = decodeAPIResponse(t, recorder)
	require.True(t, response.Success)
	require.NoError(t, common.Unmarshal(response.Data, &page))
	assert.Empty(t, page.Items)
	assert.NotNil(t, page.Items)
	assert.Zero(t, page.Total)
}
