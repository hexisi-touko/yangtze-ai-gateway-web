package model

import (
	"context"
	"errors"
	"sort"
	"time"
)

var ErrClientConfigReleasePublished = errors.New("client_config_release_published")

// ClientRemoteConfig contains the small, non-sensitive settings that may be
// changed without rebuilding the desktop installer.
type ClientRemoteConfig struct {
	UpdateCheckIntervalMinutes int  `json:"update_check_interval_minutes"`
	AutoCheckUpdates           bool `json:"auto_check_updates"`
}

type ClientConfigRelease struct {
	ID           int    `json:"id" gorm:"primaryKey"`
	Version      int64  `json:"version" gorm:"uniqueIndex:idx_client_config_release_version"`
	ReleaseNotes string `json:"release_notes" gorm:"type:text"`
	ConfigJSON   string `json:"-" gorm:"type:text;not null"`
	Mandatory    bool   `json:"mandatory"`
	Published    bool   `json:"published" gorm:"index"`
	CreatedBy    int    `json:"created_by" gorm:"index"`
	PublishedAt  int64  `json:"published_at" gorm:"index"`
	CreatedAt    int64  `json:"created_at" gorm:"index"`
	UpdatedAt    int64  `json:"updated_at"`
}

func ListClientConfigReleases(ctx context.Context) ([]ClientConfigRelease, error) {
	releases := make([]ClientConfigRelease, 0)
	err := DB.WithContext(ctx).Order("version desc, id desc").Limit(200).Find(&releases).Error
	return releases, err
}

func GetClientConfigRelease(ctx context.Context, id int) (*ClientConfigRelease, error) {
	var release ClientConfigRelease
	if err := DB.WithContext(ctx).First(&release, id).Error; err != nil {
		return nil, err
	}
	return &release, nil
}

func SaveClientConfigRelease(ctx context.Context, release *ClientConfigRelease) error {
	now := time.Now().Unix()
	if release.ID == 0 {
		release.CreatedAt = now
		release.UpdatedAt = now
		return DB.WithContext(ctx).Create(release).Error
	}
	var existing ClientConfigRelease
	if err := DB.WithContext(ctx).First(&existing, release.ID).Error; err != nil {
		return err
	}
	if existing.Published {
		return ErrClientConfigReleasePublished
	}
	release.CreatedAt = existing.CreatedAt
	release.CreatedBy = existing.CreatedBy
	release.UpdatedAt = now
	return DB.WithContext(ctx).Model(&existing).Select(
		"Version", "ReleaseNotes", "ConfigJSON", "Mandatory", "UpdatedAt",
	).Updates(release).Error
}

func SetClientConfigReleasePublished(ctx context.Context, id int, published bool) error {
	var release ClientConfigRelease
	if err := DB.WithContext(ctx).First(&release, id).Error; err != nil {
		return err
	}
	if published {
		// Only one configuration can be active at a time. Older releases remain
		// in the database for audit and rollback purposes.
		if err := DB.WithContext(ctx).Model(&ClientConfigRelease{}).
			Where("published = ? AND id <> ?", true, id).
			Update("published", false).Error; err != nil {
			return err
		}
		if release.PublishedAt == 0 {
			release.PublishedAt = time.Now().Unix()
		}
	}
	return DB.WithContext(ctx).Model(&release).Updates(map[string]any{
		"published":    published,
		"published_at": release.PublishedAt,
		"updated_at":   time.Now().Unix(),
	}).Error
}

func DeleteClientConfigRelease(ctx context.Context, id int) error {
	var release ClientConfigRelease
	if err := DB.WithContext(ctx).First(&release, id).Error; err != nil {
		return err
	}
	if release.Published {
		return ErrClientConfigReleasePublished
	}
	return DB.WithContext(ctx).Delete(&release).Error
}

func GetLatestClientConfigRelease(ctx context.Context) (*ClientConfigRelease, error) {
	releases := make([]ClientConfigRelease, 0)
	if err := DB.WithContext(ctx).Where("published = ?", true).Find(&releases).Error; err != nil {
		return nil, err
	}
	if len(releases) == 0 {
		return nil, nil
	}
	sort.Slice(releases, func(i, j int) bool {
		if releases[i].Version == releases[j].Version {
			return releases[i].PublishedAt > releases[j].PublishedAt
		}
		return releases[i].Version > releases[j].Version
	})
	return &releases[0], nil
}
