package model

import (
	"context"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type ManagedMemberToken struct {
	Token
	Username         string `json:"username"`
	DisplayName      string `json:"display_name"`
	Email            string `json:"email"`
	UserStatus       int    `json:"user_status"`
	UserQuota        int    `json:"user_quota"`
	UserUsedQuota    int    `json:"user_used_quota"`
	UserRequestCount int    `json:"user_request_count"`
}

func managedMemberTokens(ctx context.Context) *gorm.DB {
	// Match both owner and issued token; an unrelated token must never be exposed.
	approved := DB.WithContext(ctx).Model(&UserApplication{}).Select("1").
		Where("user_applications.user_id = tokens.user_id AND user_applications.issued_token_id = tokens.id").
		Where("user_applications.status = ?", UserApplicationStatusApproved)
	return DB.WithContext(ctx).Model(&Token{}).
		Joins("JOIN users ON users.id = tokens.user_id AND users.deleted_at IS NULL").
		Where("users.role = ?", common.RoleCommonUser).
		Where("EXISTS (?)", approved)
}

func ListManagedMemberTokens(ctx context.Context, keyword string, status, offset, limit int) ([]ManagedMemberToken, int64, error) {
	query := managedMemberTokens(ctx)
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(keyword)) + "%"
		query = query.Where("(LOWER(users.username) LIKE ? ESCAPE '!' OR LOWER(users.display_name) LIKE ? ESCAPE '!' OR LOWER(users.email) LIKE ? ESCAPE '!' OR LOWER(tokens.name) LIKE ? ESCAPE '!')", pattern, pattern, pattern, pattern)
	}
	if status != 0 {
		query = query.Where("tokens.status = ?", status)
	}
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]ManagedMemberToken, 0)
	err := query.Select(`tokens.*, users.username, users.display_name, users.email,
		users.status AS user_status, users.quota AS user_quota,
		users.used_quota AS user_used_quota, users.request_count AS user_request_count`).
		Order("tokens.id DESC").Offset(offset).Limit(limit).Find(&items).Error
	for i := range items {
		items[i].Key = items[i].GetMaskedKey()
	}
	return items, total, err
}

func GetManagedMemberToken(ctx context.Context, id int) (*Token, error) {
	var token Token
	err := managedMemberTokens(ctx).Select("tokens.*").Where("tokens.id = ?", id).Take(&token).Error
	return &token, err
}
