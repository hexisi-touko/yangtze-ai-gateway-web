package model

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm/clause"
)

type MemberUsageProfile struct {
	UserID     int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	MemberType string `json:"member_type" gorm:"size:20"`
	Project    string `json:"project" gorm:"size:120"`
	Purpose    string `json:"purpose" gorm:"size:500"`
	UpdatedAt  int64  `json:"updated_at"`
	UpdatedBy  int    `json:"updated_by"`
}

type MemberUsageReport struct {
	ID             int    `json:"id" gorm:"primaryKey"`
	Title          string `json:"title" gorm:"size:120"`
	Note           string `json:"note" gorm:"type:text"`
	StartTime      int64  `json:"start_time"`
	EndTime        int64  `json:"end_time"`
	CreatedAt      int64  `json:"created_at" gorm:"index"`
	CreatedBy      int    `json:"created_by"`
	Snapshot       string `json:"snapshot,omitempty" gorm:"type:text"`
	ValueSnapshot  string `json:"value_snapshot,omitempty" gorm:"type:text"`
	RequestArchive string `json:"request_archive,omitempty" gorm:"type:text"`
}

type UsageMemberIdentity struct {
	ID          int    `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	// Quota is the current remaining internal quota. UsedQuota is the
	// cumulative internal quota consumed by the account; neither is currency.
	Quota        int `json:"quota"`
	UsedQuota    int `json:"used_quota"`
	RequestCount int `json:"request_count"`
}

func LoadMemberUsageInputs(ctx context.Context, start, end int64) ([]UsageMemberIdentity, []MemberUsageProfile, []Log, error) {
	users := make([]UsageMemberIdentity, 0)
	profiles := make([]MemberUsageProfile, 0)
	logs := make([]Log, 0)
	if err := DB.WithContext(ctx).Model(&User{}).Select("id, username, display_name, quota, used_quota, request_count").Order("id").Limit(5001).Scan(&users).Error; err != nil {
		return nil, nil, nil, err
	}
	if len(users) > 5000 {
		return nil, nil, nil, errors.New("member_usage_too_many_members")
	}
	if err := DB.WithContext(ctx).Find(&profiles).Error; err != nil {
		return nil, nil, nil, err
	}
	err := LOG_DB.WithContext(ctx).Model(&Log{}).
		Select("id, user_id, username, created_at, type, quota, prompt_tokens, completion_tokens, model_name, channel_id, ip, other, request_id").
		Where("created_at >= ? AND created_at < ? AND type IN ?", start, end, []int{LogTypeConsume, LogTypeError, LogTypeRefund}).
		Order("created_at desc, id desc").
		Limit(50001).Find(&logs).Error
	if err != nil {
		return nil, nil, nil, err
	}
	if len(logs) > 50000 {
		return nil, nil, nil, errors.New("member_usage_range_too_large")
	}
	return users, profiles, logs, nil
}

// LoadMemberUsageLogs returns the bounded log slice used by the administrator
// trend view. Keeping this query separate from member identities avoids
// loading profile data when only a chart is requested.
func LoadMemberUsageLogs(ctx context.Context, start, end int64) ([]Log, error) {
	logs := make([]Log, 0)
	err := LOG_DB.WithContext(ctx).Model(&Log{}).
		Select("id, user_id, username, created_at, type, quota, prompt_tokens, completion_tokens, model_name, channel_id, ip, other, request_id").
		Where("created_at >= ? AND created_at < ? AND type IN ?", start, end, []int{LogTypeConsume, LogTypeError, LogTypeRefund}).
		Order("created_at asc, id asc").
		Limit(50001).Find(&logs).Error
	if err != nil {
		return nil, err
	}
	if len(logs) > 50000 {
		return nil, errors.New("member_usage_range_too_large")
	}
	return logs, nil
}

func SaveMemberUsageProfile(ctx context.Context, profile *MemberUsageProfile) error {
	var user User
	if err := DB.WithContext(ctx).Select("id").First(&user, profile.UserID).Error; err != nil {
		return err
	}
	profile.UpdatedAt = time.Now().Unix()
	return DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"member_type", "project", "purpose", "updated_at", "updated_by"}),
	}).Create(profile).Error
}

func SaveMemberUsageReport(ctx context.Context, report *MemberUsageReport) error {
	return DB.WithContext(ctx).Create(report).Error
}

func ListMemberUsageReports(ctx context.Context) ([]MemberUsageReport, error) {
	reports := make([]MemberUsageReport, 0)
	err := DB.WithContext(ctx).Omit("snapshot", "value_snapshot", "request_archive").Order("id desc").Limit(100).Find(&reports).Error
	return reports, err
}

func GetMemberUsageReport(ctx context.Context, id int) (*MemberUsageReport, error) {
	var report MemberUsageReport
	err := DB.WithContext(ctx).First(&report, id).Error
	return &report, err
}
