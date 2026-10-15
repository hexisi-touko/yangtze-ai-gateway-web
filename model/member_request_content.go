package model

import (
	"context"
	"time"
)

// MemberRequestContent keeps the reviewed request payload separate from the
// billing ledger. It is an admin-only audit table and is intentionally not
// exposed through the ordinary user log endpoints.
type MemberRequestContent struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	UserID    int    `json:"user_id" gorm:"index"`
	Username  string `json:"username" gorm:"index;default:''"`
	RequestID string `json:"request_id" gorm:"size:64;index"`
	CreatedAt int64  `json:"created_at" gorm:"index"`
	Path      string `json:"path" gorm:"size:200"`
	Model     string `json:"model" gorm:"size:120;index"`
	Content   string `json:"content" gorm:"type:text"`
	// ContentText is a normalized administrator-facing plain-text view. It is
	// derived on read so existing stored payloads remain backward-compatible.
	ContentText string `json:"content_text,omitempty" gorm:"-:all"`
	ContentHash string `json:"content_hash" gorm:"size:64;index"`
	Bytes       int    `json:"bytes"`
	Truncated   bool   `json:"truncated"`
}

// MemberRequestContentAlert describes a repeated request fingerprint for an
// administrator to review. It is an observation only: retries and batch work
// can legitimately produce matching content.
type MemberRequestContentAlert struct {
	UserID      int    `json:"user_id"`
	Username    string `json:"username"`
	Model       string `json:"model"`
	ContentHash string `json:"content_hash"`
	RepeatCount int64  `json:"repeat_count"`
	FirstSeenAt int64  `json:"first_seen_at"`
	LastSeenAt  int64  `json:"last_seen_at"`
}

func SaveMemberRequestContent(ctx context.Context, row *MemberRequestContent) error {
	if row.CreatedAt == 0 {
		row.CreatedAt = time.Now().Unix()
	}
	return DB.WithContext(ctx).Create(row).Error
}

func DeleteMemberRequestContentBefore(ctx context.Context, cutoff int64, batchSize int) (int64, error) {
	if cutoff <= 0 {
		return 0, nil
	}
	if batchSize <= 0 {
		batchSize = 500
	}
	var rows []MemberRequestContent
	if err := DB.WithContext(ctx).Where("created_at < ?", cutoff).
		Order("id asc").Limit(batchSize).Find(&rows).Error; err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	result := DB.WithContext(ctx).Where("id IN ?", ids).Delete(&MemberRequestContent{})
	return result.RowsAffected, result.Error
}

// DeleteAllMemberRequestContentBefore removes all payload rows before cutoff
// in bounded batches so a large cloud deployment does not hold one long
// transaction while reclaiming disk space.
func DeleteAllMemberRequestContentBefore(ctx context.Context, cutoff int64) (int64, error) {
	var total int64
	for {
		deleted, err := DeleteMemberRequestContentBefore(ctx, cutoff, 500)
		if err != nil {
			return total, err
		}
		total += deleted
		if deleted == 0 {
			return total, nil
		}
	}
}

func DeleteMemberRequestContentForUsers(ctx context.Context, userIDs []int, start, end int64) (int64, error) {
	if len(userIDs) == 0 || end <= start {
		return 0, nil
	}
	result := DB.WithContext(ctx).
		Where("user_id IN ? AND created_at >= ? AND created_at < ?", userIDs, start, end).
		Delete(&MemberRequestContent{})
	return result.RowsAffected, result.Error
}

func ListMemberRequestContent(ctx context.Context, userID int, start, end int64, limit int) ([]MemberRequestContent, error) {
	if limit <= 0 {
		limit = 100
	} else if limit > 1000 {
		limit = 1000
	}
	query := DB.WithContext(ctx).Order("created_at desc, id desc").Limit(limit)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if start > 0 {
		query = query.Where("created_at >= ?", start)
	}
	if end > 0 {
		query = query.Where("created_at < ?", end)
	}
	rows := make([]MemberRequestContent, 0)
	err := query.Find(&rows).Error
	return rows, err
}

func ListMemberRequestContentPage(ctx context.Context, userID int, start, end, beforeID int64, limit int) ([]MemberRequestContent, error) {
	query := DB.WithContext(ctx).Where("created_at >= ? AND created_at < ?", start, end).
		Order("id desc").Limit(limit + 1)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	rows := make([]MemberRequestContent, 0)
	err := query.Find(&rows).Error
	return rows, err
}

// A high-water mark prevents later writes from changing an archive in progress.
func MemberRequestArchiveBounds(ctx context.Context, userID int, start, end int64) (int64, int64, error) {
	var result struct {
		Count int64
		MaxID int64
	}
	err := DB.WithContext(ctx).Model(&MemberRequestContent{}).
		Select("COUNT(*) AS count, COALESCE(MAX(id), 0) AS max_id").
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start, end).Scan(&result).Error
	return result.Count, result.MaxID, err
}

func ReadMemberRequestArchiveBatch(ctx context.Context, userID int, start, end, maxID, afterTime, afterID int64) ([]MemberRequestContent, error) {
	rows := make([]MemberRequestContent, 0)
	query := DB.WithContext(ctx).Where("user_id = ? AND created_at >= ? AND created_at < ? AND id <= ?", userID, start, end, maxID).
		Order("created_at asc, id asc").Limit(200)
	if afterID > 0 {
		query = query.Where("created_at > ? OR (created_at = ? AND id > ?)", afterTime, afterTime, afterID)
	}
	err := query.Find(&rows).Error
	return rows, err
}

func ListRepeatedMemberRequestContent(ctx context.Context, userID int, start, end int64, threshold, limit int) ([]MemberRequestContentAlert, error) {
	if threshold < 2 {
		threshold = 2
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := DB.WithContext(ctx).Model(&MemberRequestContent{}).
		Select("user_id, MAX(username) AS username, MAX(model) AS model, content_hash, COUNT(*) AS repeat_count, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at").
		Group("user_id, content_hash").
		Having("COUNT(*) >= ?", threshold).
		Order("repeat_count DESC, last_seen_at DESC").
		Limit(limit)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if start > 0 {
		query = query.Where("created_at >= ?", start)
	}
	if end > 0 {
		query = query.Where("created_at < ?", end)
	}
	alerts := make([]MemberRequestContentAlert, 0)
	return alerts, query.Scan(&alerts).Error
}
