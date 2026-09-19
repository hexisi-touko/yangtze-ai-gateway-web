package model

import "gorm.io/gorm"

// Reference prices are independent of the relay's quota/billing settings.
type UsageReferencePrice struct {
	ID           int    `json:"id" gorm:"primaryKey"`
	Model        string `json:"model" gorm:"size:120;uniqueIndex:idx_reference_version"`
	ChannelID    int    `json:"channel_id" gorm:"uniqueIndex:idx_reference_version"`
	EffectiveAt  int64  `json:"effective_at" gorm:"uniqueIndex:idx_reference_version"`
	Input        string `json:"input" gorm:"size:32"`
	Output       string `json:"output" gorm:"size:32"`
	CacheRead    string `json:"cache_read" gorm:"size:32"`
	CacheWrite   string `json:"cache_write" gorm:"size:32"`
	CacheWrite1h string `json:"cache_write_1h" gorm:"size:32"`
	// Input/Output are stored in CNY per million tokens for the accounting
	// calculation. The USD fields preserve the official source value so the
	// administrator can distinguish a published price from the converted value.
	OfficialInputUSD      string `json:"official_input_usd" gorm:"size:32"`
	OfficialOutputUSD     string `json:"official_output_usd" gorm:"size:32"`
	OfficialCacheReadUSD  string `json:"official_cache_read_usd" gorm:"size:32"`
	OfficialCacheWriteUSD string `json:"official_cache_write_usd" gorm:"size:32"`
	SourceURL             string `json:"source_url" gorm:"size:500"`
	SyncedAt              int64  `json:"synced_at"`
	OfficialExchangeRate  string `json:"official_exchange_rate" gorm:"size:32"`
	Official              bool   `json:"official"`
	Source                string `json:"source" gorm:"size:1000"`
	CreatedBy             int    `json:"created_by"`
	CreatedAt             int64  `json:"created_at"`
}

type UsageCost struct {
	ID         int            `json:"id" gorm:"primaryKey"`
	Category   string         `json:"category" gorm:"size:30"`
	Amount     string         `json:"amount" gorm:"size:32"`
	IncurredAt int64          `json:"incurred_at" gorm:"index"`
	Note       string         `json:"note" gorm:"size:500"`
	CreatedBy  int            `json:"created_by"`
	CreatedAt  int64          `json:"created_at"`
	DeletedAt  gorm.DeletedAt `json:"-" gorm:"index"`
}
