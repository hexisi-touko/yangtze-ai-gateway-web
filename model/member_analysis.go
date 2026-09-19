package model

// Kept outside Option so generic settings endpoints cannot expose this credential.
// Like channel keys, this value requires database/backups to be access controlled.
type MemberAnalysisConfig struct {
	ID      int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	BaseURL string `json:"base_url" gorm:"size:500"`
	Model   string `json:"model" gorm:"size:120"`
	APIKey  string `json:"-" gorm:"type:text"`
	Version int64  `json:"version"`
}

// Each successful answer is an immutable turn, retaining the exact reviewed input.
type MemberAnalysisRun struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	ParentID  int    `json:"parent_id"`
	CreatedBy int    `json:"created_by" gorm:"index"`
	CreatedAt int64  `json:"created_at" gorm:"index"`
	StartTime int64  `json:"start_time"`
	EndTime   int64  `json:"end_time"`
	MemberID  int    `json:"member_id"`
	Model     string `json:"model" gorm:"size:120"`
	Question  string `json:"question" gorm:"type:text"`
	Answer    string `json:"answer" gorm:"type:text"`
	Snapshot  string `json:"snapshot,omitempty" gorm:"type:text"`
	Messages  string `json:"messages,omitempty" gorm:"type:text"`
}
