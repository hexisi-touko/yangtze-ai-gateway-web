package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type analysisTestTransport func(*http.Request) (*http.Response, error)

func (f analysisTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMemberAnalysisExternalProtocolAndBoundedErrors(t *testing.T) {
	cfg := model.MemberAnalysisConfig{BaseURL: "https://analysis.example/v1", Model: "analysis-model", APIKey: "private-test-key"}
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"success", 200, `{"choices":[{"message":{"role":"assistant","content":"Evidence insufficient"}}]}`, ""},
		{"authentication", 401, `private-test-key`, "member_usage_ai_auth_error"},
		{"quota", 429, `private-test-key`, "member_usage_ai_rate_limited"},
		{"provider failure", 500, `private-test-key`, "member_usage_ai_upstream_error"},
		{"invalid JSON", 200, `<html>private-test-key</html>`, "member_usage_ai_invalid_response"},
		{"empty choices", 200, `{"choices":[]}`, "member_usage_ai_invalid_response"},
		{"oversized", 200, strings.Repeat("x", 256*1024+1), "member_usage_ai_invalid_response"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: analysisTestTransport(func(r *http.Request) (*http.Response, error) {
				assert.Equal(t, "https://analysis.example/v1/chat/completions", r.URL.String())
				assert.Equal(t, "Bearer private-test-key", r.Header.Get("Authorization"))
				var payload struct {
					Model     string            `json:"model"`
					Messages  []AnalysisMessage `json:"messages"`
					Stream    bool              `json:"stream"`
					MaxTokens int               `json:"max_tokens"`
				}
				require.NoError(t, common.DecodeJson(r.Body, &payload))
				assert.Equal(t, cfg.Model, payload.Model)
				assert.Equal(t, 2000, payload.MaxTokens)
				assert.False(t, payload.Stream)
				assert.Equal(t, []AnalysisMessage{{Role: "user", Content: "Inspect statistics"}}, payload.Messages)
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})}
			answer, err := callMemberAnalysis(context.Background(), cfg, []AnalysisMessage{{Role: "user", Content: "Inspect statistics"}}, client)
			if tc.want == "" {
				require.NoError(t, err)
				assert.Equal(t, "Evidence insufficient", answer)
			} else {
				require.EqualError(t, err, tc.want)
				assert.Empty(t, answer)
			}
		})
	}
	client := &http.Client{Transport: analysisTestTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("secret in upstream error") })}
	_, err := callMemberAnalysis(context.Background(), cfg, nil, client)
	assert.EqualError(t, err, "member_usage_ai_network_error")
}

func TestMemberAnalysisRejectsUnsafeDestinations(t *testing.T) {
	for _, base := range []string{"http://api.example/v1", "https://user:pass@api.example/v1", "https://api.example/v1?key=secret", "https://api.example:8080/v1", "https://api.example/v1#fragment", "https://api.example/v1/chat/completions", "https://api.example/v1/responses"} {
		assert.Error(t, validateAnalysisURL(base))
	}
	client := analysisHTTPClient()
	defer client.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, base := range []string{"https://127.0.0.1/v1", "https://169.254.169.254/v1", "https://[::1]/v1"} {
		_, err := callMemberAnalysis(ctx, model.MemberAnalysisConfig{BaseURL: base, Model: "test", APIKey: "not-real"}, nil, client)
		assert.EqualError(t, err, "member_usage_ai_network_error")
	}
	assert.Error(t, client.CheckRedirect(nil, nil))
}

func TestMemberAnalysisSnapshotMinimizesDataAndKeepsEvidence(t *testing.T) {
	summary := &MemberUsageSummary{StartTime: 100, EndTime: 200, Members: []MemberUsageRow{
		{UsageMemberIdentity: model.UsageMemberIdentity{ID: 1, Username: "private-name", DisplayName: "real-name"}, Profile: model.MemberUsageProfile{MemberType: "intern", Project: "secret-project", Purpose: "password=secret"}, MemberUsageMetrics: MemberUsageMetrics{Tokens: 99}},
		{UsageMemberIdentity: model.UsageMemberIdentity{ID: 2}},
	}}
	data, err := analysisSnapshot(summary, []model.MemberWorkSession{{UserID: 1, Project: "secret-project", Branch: "private-branch", Purpose: "key=secret", Source: "codex", StartedAt: 150}}, 1)
	require.NoError(t, err)
	for _, secret := range []string{"private-name", "real-name", "secret-project", "password", "private-branch", "key=secret", "member-2"} {
		assert.NotContains(t, data, secret)
	}
	assert.Contains(t, data, `"tokens":99`)
	assert.Contains(t, data, `"member":"member-1"`)
	assert.Contains(t, data, `"project_alias":"project-1"`)
	_, err = analysisSnapshot(summary, nil, 999)
	assert.EqualError(t, err, "member_usage_not_found")
}

func TestMemberAnalysisConfigPreviewAndConsent(t *testing.T) {
	oldDB, oldLogs := model.DB, model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogs
		conn, e := db.DB()
		if e == nil {
			_ = conn.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&model.MemberAnalysisConfig{}, &model.MemberAnalysisRun{}, &model.MemberWorkSession{}, &model.MemberUsageProfile{}, &model.User{}, &model.Log{}))
	ctx := context.Background()
	cfg, err := SaveMemberAnalysisConfig(ctx, "https://analysis.example/v1/", "test-model", "test-secret", false)
	require.NoError(t, err)
	encoded, err := common.Marshal(cfg)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "test-secret")
	_, err = SaveMemberAnalysisConfig(ctx, "https://other.example/v1", "test-model", "", false)
	assert.EqualError(t, err, "member_usage_ai_key_required")
	retained, err := SaveMemberAnalysisConfig(ctx, cfg.BaseURL, "another-model", "", false)
	require.NoError(t, err)
	assert.Equal(t, cfg.APIKey, retained.APIKey)
	assert.Greater(t, retained.Version, cfg.Version)
	user := model.User{Username: "analysis-member", AffCode: "analysis-aff", Role: 1, Status: 1, Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	now := time.Now().Unix()
	require.NoError(t, db.Create(&model.Log{UserId: user.Id, Type: model.LogTypeConsume, CreatedAt: now - 10, PromptTokens: 25, Content: "private prompt"}).Error)
	preview, err := PreviewMemberAnalysis(ctx, now-60, now, user.Id, 99)
	require.NoError(t, err)
	assert.Contains(t, preview.Snapshot, `"tokens":25`)
	assert.NotContains(t, preview.Snapshot, "private prompt")
	client := &http.Client{Transport: analysisTestTransport(func(r *http.Request) (*http.Response, error) {
		var payload struct {
			Messages []AnalysisMessage `json:"messages"`
		}
		require.NoError(t, common.DecodeJson(r.Body, &payload))
		assert.Contains(t, payload.Messages[1].Content, preview.Snapshot)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"Evidence only"}}]}`)), Header: make(http.Header)}, nil
	})}
	completed, err := completeMemberAnalysisTurn(ctx, retained, preview, "Summarize", client)
	require.NoError(t, err)
	assert.NotEqual(t, preview.ID, completed.ID)
	stored, err := GetMemberAnalysisRun(ctx, completed.ID, 99)
	require.NoError(t, err)
	assert.Equal(t, preview.Snapshot, stored.Snapshot)
	assert.Equal(t, "Evidence only", stored.Answer)
	assert.Contains(t, stored.Messages, "Summarize")
	unchangedPreview, err := GetMemberAnalysisRun(ctx, preview.ID, 99)
	require.NoError(t, err)
	assert.Equal(t, "[]", unchangedPreview.Messages)
	_, err = GetMemberAnalysisRun(ctx, preview.ID, 100)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	_, err = ChatMemberAnalysis(ctx, preview.ID, 99, "question", false, retained.Version)
	assert.EqualError(t, err, "member_usage_ai_consent_required")
	_, err = ChatMemberAnalysis(ctx, preview.ID, 99, "question", true, cfg.Version)
	assert.EqualError(t, err, "member_usage_ai_config_changed")
	cleared, err := SaveMemberAnalysisConfig(ctx, "", "", "", true)
	require.NoError(t, err)
	assert.Empty(t, cleared.APIKey)
	_, err = ChatMemberAnalysis(ctx, preview.ID, 99, "question", true, cleared.Version)
	assert.EqualError(t, err, "member_usage_ai_not_configured")
	var unchanged model.User
	require.NoError(t, db.First(&unchanged, user.Id).Error)
	assert.Equal(t, 1000, unchanged.Quota)
	var runs int64
	require.NoError(t, db.Model(&model.MemberAnalysisRun{}).Count(&runs).Error)
	assert.Equal(t, int64(2), runs)
}
