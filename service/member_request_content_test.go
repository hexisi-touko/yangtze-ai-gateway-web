package service

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCaptureMemberRequestContentPersistsCurrentTurn(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.MemberRequestContent{}))
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous; _ = sqlDB.Close() })

	tests := []struct {
		name      string
		raw       string
		limit     string
		want      string
		truncated bool
	}{
		{
			name:  "harness context expands during JSON redaction",
			raw:   `{"input":[{"role":"system","content":"Current runtime context <workspace> & <policy> ` + strings.Repeat("<instructions>&", 4000) + `"},{"role":"user","content":[{"type":"input_text","text":"你好，本地测试只回复ok"}]}],"api_key":"x"}`,
			limit: "524288",
			want:  "你好，本地测试只回复ok",
		},
		{
			name:  "small budget applies to member text instead of system context",
			raw:   `{"messages":[{"role":"system","content":"` + strings.Repeat("runtime instructions ", 100) + `"},{"role":"user","content":"你好"}]}`,
			limit: "8",
			want:  "你好",
		},
		{
			name:      "oversized Chinese text stays valid JSON and UTF8",
			raw:       `{"input":"你好，请检查这个项目"}`,
			limit:     "7",
			want:      "你好\n...[truncated]",
			truncated: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MEMBER_REQUEST_CONTENT_MAX_BYTES", tt.limit)
			CaptureMemberRequestContent(context.Background(), 1, "member", tt.name, "/v1/responses", "test-model", []byte(tt.raw))
			var row model.MemberRequestContent
			require.NoError(t, db.Where("request_id = ?", tt.name).First(&row).Error)
			require.True(t, utf8.ValidString(row.Content))
			var message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			}
			require.NoError(t, common.Unmarshal([]byte(row.Content), &message))
			assert.Equal(t, "user", message.Role)
			assert.Equal(t, tt.want, message.Content)
			rows, listErr := ListMemberRequestContent(context.Background(), 1, 0, 0, 10)
			require.NoError(t, listErr)
			var listed *model.MemberRequestContent
			for i := range rows {
				if rows[i].RequestID == tt.name {
					listed = &rows[i]
					break
				}
			}
			require.NotNil(t, listed)
			assert.Equal(t, tt.want, listed.ContentText)
			assert.Equal(t, tt.truncated, row.Truncated)
			assert.Equal(t, len(tt.raw), row.Bytes)
			assert.NotContains(t, row.Content, "api_key")
		})
	}
}

func TestMemberRequestContentOnlyUsesResponsesStringInput(t *testing.T) {
	content := memberRequestContentOnly(`{"model":"gpt-5.5","input":"请用中文回答：今天完成了什么工作？"}`)

	assert.JSONEq(t, `{"role":"user","content":"请用中文回答：今天完成了什么工作？"}`, content)
}

func TestMemberRequestContentOnlyUsesLastResponsesUserTurn(t *testing.T) {
	content := memberRequestContentOnly(`{"input":[{"role":"system","content":"运行环境说明"},{"role":"user","content":"先前的问题"},{"role":"assistant","content":"先前的回答"},{"role":"user","content":"请总结今天的工作"}]}`)

	assert.JSONEq(t, `{"role":"user","content":"请总结今天的工作"}`, content)
}

func TestMemberRequestContentOnlyUsesResponsesInputTextPart(t *testing.T) {
	content := memberRequestContentOnly(`{"input":[{"role":"system","content":"运行环境说明"},{"role":"user","content":[{"type":"input_text","text":"请只用中文说明今天完成的工作"}]}]}`)

	assert.JSONEq(t, `{"role":"user","content":"请只用中文说明今天完成的工作"}`, content)
}

func TestMemberRequestContentOnlyFiltersHarnessRuntimeBlocks(t *testing.T) {
	content := memberRequestContentOnly(`{"input":"<system-reminder>\n<available_skills>\n- code-review: internal instructions\n- diagnostics: internal instructions\n</available_skills>\n</system-reminder>\nuser message:\n请检查成员分析页面"}`)

	assert.JSONEq(t, `{"role":"user","content":"请检查成员分析页面"}`, content)
}

func TestMemberRequestContentOnlyDropsRuntimeOnlyHarnessPayload(t *testing.T) {
	content := memberRequestContentOnly(`{"input":"<system-reminder>\n<available_skills>\n- code-review: internal instructions\n</available_skills>\n</system-reminder>"}`)

	assert.Empty(t, content)
}

func TestMemberRequestContentOnlySkipsInternalHarnessReports(t *testing.T) {
	content := memberRequestContentOnly(`{"input":[{"role":"user","content":"Background subagent 6604a19b-7ac7-4bdf-857c-ec7483fdc005 finished and will do no further work unless you send it more. Its closing message:Findings sent to parent agent"}]}`)

	assert.Empty(t, content)
}

func TestMemberRequestContentOnlySkipsDirectInternalUserMessage(t *testing.T) {
	content := memberRequestContentOnly(`{"role":"user","content":"Background subagent 6604a19b-7ac7-4bdf-857c-ec7483fdc005 finished and will do no further work"}`)

	assert.Empty(t, content)
}

func TestMemberRequestContentOnlySkipsForwardedAgentMessage(t *testing.T) {
	content := memberRequestContentOnly(`{"role":"user","content":"Agent d47eb9f2-bcfd-4c5c-a803-979645a4f595 sent a message: 关键实践警告"}`)

	assert.Empty(t, content)
}

func TestMemberRequestContentOnlyUsesDirectUserMessage(t *testing.T) {
	content := memberRequestContentOnly(`{"role":"user","content":"请总结今天的工作"}`)

	assert.JSONEq(t, `{"role":"user","content":"请总结今天的工作"}`, content)
}

func TestNormalizeStoredMemberRequestContentFiltersLegacyInternalMessage(t *testing.T) {
	assert.Empty(t, normalizeStoredMemberRequestContent(`{"role":"user","content":"Agent d47eb9f2-bcfd-4c5c-a803-979645a4f595 sent a message: 关键实践警告"}`))
	assert.JSONEq(t, `{"role":"user","content":"请总结今天的工作"}`, normalizeStoredMemberRequestContent(`{"role":"user","content":"请总结今天的工作"}`))
}

func TestExtractMemberWorkspaceFromHarnessRuntimeContext(t *testing.T) {
	raw := []byte(`{"input":[{"role":"system","content":"Current runtime context. The current session workspace: \"D:\\夏至\\Documents\\测试\"."},{"role":"user","content":[{"type":"input_text","text":"请检查项目"}]}]}`)

	assert.Equal(t, `D:\夏至\Documents\测试`, ExtractMemberWorkspaceFromRequest(raw))
}

func TestMemberRequestPreservesNormalEnglishAndCode(t *testing.T) {
	for _, text := range []string{"Key conclusion: the pump needs maintenance.", "Explain this log: Findings sent to parent agent", "Please explain workspace-write and approval policy.\nuser request:\nkeep this label"} {
		body, err := common.Marshal(map[string]any{"role": "user", "content": text})
		require.NoError(t, err)
		assert.JSONEq(t, string(body), memberRequestContentOnly(string(body)))
	}
}

func TestMemberRequestSkipsReminderAndPreservesPreviousTurn(t *testing.T) {
	body, err := common.Marshal(map[string]any{"input": []any{map[string]any{"role": "user", "content": "请修复这个错误"}, map[string]any{"role": "user", "content": repeatedToolCallReminder}}})
	require.NoError(t, err)
	assert.JSONEq(t, `{"role":"user","content":"请修复这个错误"}`, memberRequestContentOnly(string(body)))
	assert.Empty(t, memberRequestContentOnly(repeatedToolCallReminder))
}

func TestMemberRequestDefaultPreservesLongTextAndLegacyPayload(t *testing.T) {
	text := strings.Repeat("长正文", 200000) + "正文结尾"
	full, truncated := truncateMemberRequestText(text, defaultMemberRequestContentMaxBytes)
	assert.Equal(t, text, full)
	assert.False(t, truncated)
	assert.JSONEq(t, `{"role":"user","content":"这是真实请求"}`, normalizeStoredMemberRequestContent(`{"input":[{"role":"system","content":"内部说明"},{"role":"user","content":"这是真实请求"}]}`))
	assert.JSONEq(t, `{"role":"user","content":"旧正文"}`, normalizeStoredMemberRequestContent(`{"content":"旧正文"}`))
}

func TestCaptureMemberRequestContentPreservesLongPlainText(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.MemberRequestContent{}))
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous; _ = sqlDB.Close() })

	long := strings.Repeat("这是一段需要完整保留的长请求。", 12000)
	raw, err := common.Marshal(map[string]any{
		"model": "gpt-5.5",
		"input": []any{
			map[string]any{"role": "system", "content": "内部运行信息"},
			map[string]any{"role": "user", "content": long},
		},
	})
	require.NoError(t, err)
	t.Setenv("MEMBER_REQUEST_CONTENT_MAX_BYTES", "0")
	CaptureMemberRequestContent(context.Background(), 1, "成员甲", "long-request", "/v1/responses", "gpt-5.5", raw)

	var row model.MemberRequestContent
	require.NoError(t, db.Where("request_id = ?", "long-request").First(&row).Error)
	rows, listErr := ListMemberRequestContent(context.Background(), 1, 0, 0, 10)
	require.NoError(t, listErr)
	require.Len(t, rows, 1)
	assert.Equal(t, long, rows[0].ContentText)
	assert.Equal(t, len(long), len(rows[0].ContentText))
}
