package model

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm/clause"
)

var ErrWorkSessionEnded = errors.New("member_usage_work_session_ended")

// Client reports describe a selected workspace, not verified activity or token attribution.
type MemberWorkSession struct {
	UserID     int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	SessionID  string `json:"session_id" gorm:"primaryKey;size:36"`
	Project    string `json:"project" gorm:"size:120"`
	Branch     string `json:"branch" gorm:"size:200"`
	Source     string `json:"source" gorm:"size:20"`
	Purpose    string `json:"purpose" gorm:"size:500"`
	StartedAt  int64  `json:"started_at"`
	LastSeenAt int64  `json:"last_seen_at" gorm:"index"`
	EndedAt    int64  `json:"ended_at"`
}

type MemberWorkSessionView struct {
	MemberWorkSession
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	MemberType  string `json:"member_type"`
}

func StartMemberWorkSession(ctx context.Context, row *MemberWorkSession) error {
	row.StartedAt = time.Now().Unix()
	row.LastSeenAt = row.StartedAt
	// A retry with the same ID must not overwrite a stopped session or change its project.
	if err := DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error; err != nil {
		return err
	}
	return DB.WithContext(ctx).Where("user_id = ? AND session_id = ?", row.UserID, row.SessionID).First(row).Error
}

func UpdateMemberWorkSession(ctx context.Context, userID int, id string, stop bool) error {
	now := time.Now().Unix()
	updates := map[string]interface{}{"last_seen_at": now}
	if stop {
		updates["ended_at"] = now
	}
	result := DB.WithContext(ctx).Model(&MemberWorkSession{}).
		Where("user_id = ? AND session_id = ? AND ended_at = 0", userID, id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	// Read-back supports idempotent stop across databases with different RowsAffected semantics.
	var row MemberWorkSession
	if err := DB.WithContext(ctx).Where("user_id = ? AND session_id = ?", userID, id).First(&row).Error; err != nil {
		return err
	}
	if !stop && row.EndedAt != 0 {
		return ErrWorkSessionEnded
	}
	return nil
}

func ListMemberWorkSessions(ctx context.Context, before int64) ([]MemberWorkSessionView, error) {
	rows := make([]MemberWorkSessionView, 0)
	query := DB.WithContext(ctx).Model(&MemberWorkSession{}).
		Select("member_work_sessions.*, users.username, users.display_name, member_usage_profiles.member_type").
		Joins("JOIN users ON users.id = member_work_sessions.user_id AND users.deleted_at IS NULL").
		Joins("LEFT JOIN member_usage_profiles ON member_usage_profiles.user_id = member_work_sessions.user_id")
	if before > 0 {
		query = query.Where("member_work_sessions.last_seen_at < ?", before)
	}
	err := query.Order("member_work_sessions.last_seen_at DESC, member_work_sessions.session_id").Limit(100).Scan(&rows).Error
	return rows, err
}

// LatestMemberWorkspaces returns the most recently reported workspace for each
// member. The full session history remains available to the client-projects
// tab; usage rows only need the current workspace label.
func LatestMemberWorkspaces(ctx context.Context) (map[int]MemberWorkSession, error) {
	if !DB.Migrator().HasTable(&MemberWorkSession{}) {
		return map[int]MemberWorkSession{}, nil
	}
	rows := make([]MemberWorkSession, 0)
	if err := DB.WithContext(ctx).
		Order("last_seen_at DESC, session_id DESC").
		Limit(5000).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	latest := make(map[int]MemberWorkSession, len(rows))
	for _, row := range rows {
		if _, exists := latest[row.UserID]; !exists {
			latest[row.UserID] = row
		}
	}
	return latest, nil
}
