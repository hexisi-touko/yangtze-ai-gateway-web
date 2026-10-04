package model

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
)

var ErrClientReleaseNotFound = errors.New("client_release_not_found")
var ErrClientReleasePublished = errors.New("client_release_published")

type ClientRelease struct {
	ID           int    `json:"id" gorm:"primaryKey"`
	Version      string `json:"version" gorm:"size:128;not null;uniqueIndex:idx_client_release_target_version,priority:3"`
	Platform     string `json:"platform" gorm:"size:32;not null;uniqueIndex:idx_client_release_target_version,priority:1"`
	Channel      string `json:"channel" gorm:"size:20;not null;uniqueIndex:idx_client_release_target_version,priority:2"`
	ReleaseNotes string `json:"release_notes" gorm:"type:text"`
	DownloadURL  string `json:"download_url" gorm:"type:text;not null"`
	FileName     string `json:"file_name" gorm:"size:255"`
	FileSize     int64  `json:"file_size"`
	SHA256       string `json:"sha256" gorm:"size:64"`
	Mandatory    bool   `json:"mandatory"`
	Published    bool   `json:"published" gorm:"index"`
	CreatedBy    int    `json:"created_by" gorm:"index"`
	PublishedAt  int64  `json:"published_at" gorm:"index"`
	CreatedAt    int64  `json:"created_at" gorm:"index"`
	UpdatedAt    int64  `json:"updated_at"`
}

func ListClientReleases(ctx context.Context) ([]ClientRelease, error) {
	releases := make([]ClientRelease, 0)
	err := DB.WithContext(ctx).Order("created_at desc, id desc").Limit(200).Find(&releases).Error
	return releases, err
}

func GetClientRelease(ctx context.Context, id int) (*ClientRelease, error) {
	var release ClientRelease
	if err := DB.WithContext(ctx).First(&release, id).Error; err != nil {
		return nil, err
	}
	return &release, nil
}

func SaveClientRelease(ctx context.Context, release *ClientRelease) error {
	now := time.Now().Unix()
	if release.ID == 0 {
		release.CreatedAt = now
		release.UpdatedAt = now
		return DB.WithContext(ctx).Create(release).Error
	}
	var existing ClientRelease
	if err := DB.WithContext(ctx).First(&existing, release.ID).Error; err != nil {
		return err
	}
	if existing.Published {
		return ErrClientReleasePublished
	}
	release.CreatedAt = existing.CreatedAt
	release.CreatedBy = existing.CreatedBy
	release.UpdatedAt = now
	return DB.WithContext(ctx).Model(&existing).Select(
		"Version", "Platform", "Channel", "ReleaseNotes", "DownloadURL", "FileName", "FileSize", "SHA256", "Mandatory", "UpdatedAt",
	).Updates(release).Error
}

func SetClientReleasePublished(ctx context.Context, id int, published bool) error {
	var release ClientRelease
	if err := DB.WithContext(ctx).First(&release, id).Error; err != nil {
		return err
	}
	if published && release.PublishedAt == 0 {
		release.PublishedAt = time.Now().Unix()
	}
	return DB.WithContext(ctx).Model(&release).Updates(map[string]any{
		"published":    published,
		"published_at": release.PublishedAt,
		"updated_at":   time.Now().Unix(),
	}).Error
}

func DeleteClientRelease(ctx context.Context, id int) error {
	var release ClientRelease
	if err := DB.WithContext(ctx).First(&release, id).Error; err != nil {
		return err
	}
	if release.Published {
		return ErrClientReleasePublished
	}
	return DB.WithContext(ctx).Delete(&release).Error
}

func GetLatestClientRelease(ctx context.Context, platform, channel string) (*ClientRelease, error) {
	releases := make([]ClientRelease, 0)
	err := DB.WithContext(ctx).
		Where("platform = ? AND channel = ? AND published = ?", platform, channel, true).
		Find(&releases).Error
	if err != nil {
		return nil, err
	}
	if len(releases) == 0 {
		return nil, nil
	}
	sort.Slice(releases, func(i, j int) bool {
		comparison := compareReleaseVersions(releases[i].Version, releases[j].Version)
		if comparison == 0 {
			return releases[i].PublishedAt > releases[j].PublishedAt
		}
		return comparison > 0
	})
	return &releases[0], nil
}

func NormalizeClientReleaseVersion(version string) (string, error) {
	version = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(version), "v"))
	if len(version) == 0 || len(version) > 128 {
		return "", errors.New("client_release_invalid_version")
	}
	coreAndSuffix := strings.SplitN(version, "+", 2)
	core := coreAndSuffix[0]
	if len(coreAndSuffix) == 2 && !validVersionIdentifiers(coreAndSuffix[1], false) {
		return "", errors.New("client_release_invalid_version")
	}
	coreAndPrerelease := strings.SplitN(core, "-", 2)
	parts := strings.Split(coreAndPrerelease[0], ".")
	if len(parts) != 3 {
		return "", errors.New("client_release_invalid_version")
	}
	for _, part := range parts {
		if !validNumericIdentifier(part) {
			return "", errors.New("client_release_invalid_version")
		}
	}
	if len(coreAndPrerelease) == 2 && !validVersionIdentifiers(coreAndPrerelease[1], true) {
		return "", errors.New("client_release_invalid_version")
	}
	return version, nil
}

func validVersionIdentifiers(value string, rejectLeadingZero bool) bool {
	if value == "" {
		return false
	}
	for _, identifier := range strings.Split(value, ".") {
		if identifier == "" {
			return false
		}
		digits := true
		for _, char := range identifier {
			if !(char >= '0' && char <= '9') && !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') && char != '-' {
				return false
			}
			if char < '0' || char > '9' {
				digits = false
			}
		}
		if rejectLeadingZero && digits && len(identifier) > 1 && identifier[0] == '0' {
			return false
		}
	}
	return true
}

func validNumericIdentifier(value string) bool {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func compareReleaseVersions(left, right string) int {
	leftParts := strings.SplitN(strings.SplitN(left, "+", 2)[0], "-", 2)
	rightParts := strings.SplitN(strings.SplitN(right, "+", 2)[0], "-", 2)
	leftCore, rightCore := strings.Split(leftParts[0], "."), strings.Split(rightParts[0], ".")
	for index := 0; index < 3; index++ {
		if result := compareNumericIdentifiers(leftCore[index], rightCore[index]); result != 0 {
			return result
		}
	}
	if len(leftParts) == 1 && len(rightParts) > 1 {
		return 1
	}
	if len(rightParts) == 1 && len(leftParts) > 1 {
		return -1
	}
	if len(leftParts) == 1 {
		return 0
	}
	leftIdentifiers, rightIdentifiers := strings.Split(leftParts[1], "."), strings.Split(rightParts[1], ".")
	for index := 0; index < len(leftIdentifiers) && index < len(rightIdentifiers); index++ {
		leftNumber, rightNumber := isNumericIdentifier(leftIdentifiers[index]), isNumericIdentifier(rightIdentifiers[index])
		switch {
		case leftNumber && rightNumber:
			if result := compareNumericIdentifiers(leftIdentifiers[index], rightIdentifiers[index]); result != 0 {
				return result
			}
		case leftNumber:
			return -1
		case rightNumber:
			return 1
		case leftIdentifiers[index] < rightIdentifiers[index]:
			return -1
		case leftIdentifiers[index] > rightIdentifiers[index]:
			return 1
		}
	}
	if len(leftIdentifiers) < len(rightIdentifiers) {
		return -1
	}
	if len(leftIdentifiers) > len(rightIdentifiers) {
		return 1
	}
	return 0
}

func isNumericIdentifier(value string) bool {
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return value != ""
}

func compareNumericIdentifiers(left, right string) int {
	left, right = strings.TrimLeft(left, "0"), strings.TrimLeft(right, "0")
	if left == "" {
		left = "0"
	}
	if right == "" {
		right = "0"
	}
	if len(left) < len(right) {
		return -1
	}
	if len(left) > len(right) {
		return 1
	}
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func ReleaseVersionIsNewer(candidate, current string) bool {
	return compareReleaseVersions(candidate, current) > 0
}
