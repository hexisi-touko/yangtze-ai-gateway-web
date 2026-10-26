package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/google/uuid"
)

// Preserve complete member text unless the administrator explicitly sets a cap.
const defaultMemberRequestContentMaxBytes = 0

var workspacePathPatterns = []*regexp.Regexp{
	regexp.MustCompile("(?im)(?:session\\s+)?workspace(?:\\s+(?:root|path|directory))?\\s*(?:is|:|=)\\s*[\\\"'`]?((?:[A-Za-z]:[\\\\/]|/)[^\\\"'`\\r\\n]+)"),
	regexp.MustCompile("(?im)(?:working\\s+(?:directory|dir)|workdir|工作(?:目录|区))\\s*(?:is|:|=)\\s*[\\\"'`]?((?:[A-Za-z]:[\\\\/]|/)[^\\\"'`\\r\\n]+)"),
}

// CaptureMemberRequestContent stores the member's current turn, redacts JSON
// credentials and hashes the saved content for correlation.
func CaptureMemberRequestContent(ctx context.Context, userID int, username, requestID, path, modelName string, raw []byte) {
	if userID <= 0 || len(raw) == 0 {
		return
	}
	copyOfRaw := append([]byte(nil), raw...)
	maxBytes := common.GetEnvOrDefault("MEMBER_REQUEST_CONTENT_MAX_BYTES", defaultMemberRequestContentMaxBytes)
	// Redact the complete JSON before extracting the final member turn. Parsing
	// an already-truncated payload would lose the message array entirely.
	redacted := redactRequestBody(copyOfRaw)
	// Harness clients send the complete conversation on every turn. Keep the
	// audit record focused on the member's current request instead of storing
	// repeated history and injected runtime instructions.
	content := memberRequestContentOnly(redacted)
	// A Harness request can contain only runtime instructions (for example when
	// the client is starting a session). Do not create a misleading audit row
	// for that payload; the next real member turn will be captured normally.
	if strings.TrimSpace(content) == "" {
		return
	}
	// Limit the extracted text, not serialized JSON: cutting JSON would make
	// it unreadable, and escaping <, > and & can increase its byte length.
	var message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	var truncated bool
	if common.Unmarshal([]byte(content), &message) == nil && message.Role == "user" {
		message.Content, truncated = truncateMemberRequestText(message.Content, maxBytes)
		if encoded, err := common.Marshal(message); err == nil {
			content = string(encoded)
		}
	} else {
		content, truncated = truncateMemberRequestText(content, maxBytes)
	}
	hash := sha256.Sum256([]byte(content))
	row := &model.MemberRequestContent{
		UserID:      userID,
		Username:    username,
		RequestID:   requestID,
		Path:        truncateString(path, 200),
		Model:       truncateString(modelName, 120),
		Content:     content,
		ContentHash: hex.EncodeToString(hash[:]),
		Bytes:       len(copyOfRaw),
		Truncated:   truncated,
	}
	row.ContentText = memberRequestPlainText(content)
	if err := model.SaveMemberRequestContent(ctx, row); err != nil {
		common.SysError(fmt.Sprintf("failed to save member request content: %v", err))
	}
}

func memberRequestContentOnly(content string) string {
	var value any
	if common.Unmarshal([]byte(content), &value) != nil {
		text := stripHarnessRuntimeContext(strings.TrimSpace(content))
		if isInternalHarnessMessage(text) {
			return ""
		}
		return text
	}
	if body, ok := value.(map[string]any); ok {
		if role, roleOK := body["role"].(string); roleOK {
			if !strings.EqualFold(role, "user") && !strings.EqualFold(role, "request") {
				return ""
			}
			text := stripHarnessRuntimeContext(memberValueText(body["content"]))
			if isInternalHarnessMessage(text) {
				return ""
			}
			if text != "" {
				if encoded, err := common.Marshal(map[string]any{"role": "user", "content": text}); err == nil {
					return string(encoded)
				}
				return text
			}
			return ""
		}
		hasMessageContainer := false
		for _, key := range []string{"messages", "input", "contents"} {
			if _, exists := body[key]; exists {
				hasMessageContainer = true
			}
			if messages := memberMessages(body[key]); len(messages) > 0 {
				if encoded, err := common.Marshal(map[string]any{"role": "user", "content": messages[len(messages)-1]}); err == nil {
					return string(encoded)
				}
			}
		}
		if hasMessageContainer {
			return ""
		}
		for _, key := range []string{"prompt", "query", "text", "input", "content"} {
			if text, ok := body[key].(string); ok && strings.TrimSpace(text) != "" {
				cleaned := stripHarnessRuntimeContext(text)
				if strings.TrimSpace(cleaned) == "" || isInternalHarnessMessage(cleaned) {
					return ""
				}
				if encoded, err := common.Marshal(map[string]any{"role": "user", "content": cleaned}); err == nil {
					return string(encoded)
				}
				return cleaned
			}
		}
	}
	return stripHarnessRuntimeContext(strings.TrimSpace(content))
}

func memberMessages(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			text = stripHarnessRuntimeContext(text)
			if text == "" || isInternalHarnessMessage(text) {
				return nil
			}
			return []string{text}
		}
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		role, _ := row["role"].(string)
		role = strings.ToLower(strings.TrimSpace(role))
		if role != "" && role != "user" && role != "request" {
			continue
		}
		var text string
		for _, key := range []string{"content", "text", "input", "parts"} {
			if candidate := memberValueText(row[key]); candidate != "" {
				text = candidate
				break
			}
		}
		text = stripHarnessRuntimeContext(strings.TrimSpace(text))
		if text != "" && !isInternalHarnessMessage(text) {
			result = append(result, text)
		}
	}
	return result
}

func isInternalHarnessMessage(text string) bool {
	normalized := strings.Join(strings.Fields(text), " ")
	return isStandaloneSubagentNotification(text) || internalHarnessMessagePattern.MatchString(normalized) || normalized == repeatedToolCallReminder
}

func isStandaloneSubagentNotification(text string) bool {
	normalized := strings.TrimSpace(text)
	if !subagentNotificationPattern.MatchString(normalized) {
		return false
	}
	// A member may quote one or more notification tags in an otherwise normal
	// request. Only a payload made of one complete notification is internal.
	lower := strings.ToLower(normalized)
	return strings.Count(lower, "<subagent_notification") == 1 &&
		strings.Count(lower, "</subagent_notification") == 1
}

// Match complete runtime envelopes, not ordinary English conclusions or quoted logs.
var subagentNotificationPattern = regexp.MustCompile(`(?is)^<subagent_notification\b[^>]*>.*?</subagent_notification\s*>$`)
var internalHarnessMessagePattern = regexp.MustCompile(`(?i)^(?:background (?:subagent|agent) [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} finished and will do no further work\b|agent [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} sent a message:)`)

const repeatedToolCallReminder = "You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again; if the task is not complete, try a different approach or different arguments instead of repeating the call."

func memberValueText(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if items, ok := value.([]any); ok {
		parts := make([]string, 0, len(items))
		for _, item := range items {
			if text := memberValueText(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	}
	if row, ok := value.(map[string]any); ok {
		for _, key := range []string{"text", "content", "input_text", "output_text", "value"} {
			if text := memberValueText(row[key]); text != "" {
				return text
			}
		}
	}
	return ""
}

// ExtractMemberWorkspaceFromRequest recognizes the selected Harness workspace
// from its Responses runtime context. Newer lab clients can send a dedicated
// header; this fallback keeps existing installed clients useful without asking
// every member to reinstall just to report their current project.
func ExtractMemberWorkspaceFromRequest(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if common.Unmarshal(raw, &value) != nil {
		return workspacePathFromText(string(raw))
	}
	return workspacePathFromValue(value, "")
}

func workspacePathFromValue(value any, key string) string {
	switch item := value.(type) {
	case string:
		if isWorkspaceField(key) && rootedWorkspacePath(item) {
			return strings.TrimSpace(item)
		}
		return workspacePathFromText(item)
	case []any:
		for _, child := range item {
			if path := workspacePathFromValue(child, key); path != "" {
				return path
			}
		}
	case map[string]any:
		for _, preferredKey := range []string{"workspace", "workspace_path", "workspace_root", "working_directory", "workdir", "cwd", "project_path"} {
			if child, ok := item[preferredKey]; ok {
				if path := workspacePathFromValue(child, preferredKey); path != "" {
					return path
				}
			}
		}
		for childKey, child := range item {
			if path := workspacePathFromValue(child, childKey); path != "" {
				return path
			}
		}
	}
	return ""
}

func isWorkspaceField(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	return key == "workspace" || key == "workspace_path" || key == "workspace_root" ||
		key == "working_directory" || key == "workdir" || key == "cwd" || key == "project_path"
}

func workspacePathFromText(text string) string {
	for _, pattern := range workspacePathPatterns {
		matches := pattern.FindStringSubmatch(text)
		if len(matches) < 2 {
			continue
		}
		candidate := strings.TrimSpace(matches[1])
		candidate = strings.TrimRight(candidate, "`\\\"'.,;:)")
		if rootedWorkspacePath(candidate) {
			return candidate
		}
	}
	return ""
}

func rootedWorkspacePath(value string) bool {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if strings.HasPrefix(value, "/") {
		return true
	}
	return len(value) >= 3 && ((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) && value[1] == ':' && value[2] == '/'
}

func stripHarnessRuntimeContext(text string) string {
	text = strings.TrimSpace(text)
	// Harness serializes its internal context as XML-like blocks inside the
	// member's input. Remove these blocks before the content reaches storage.
	// They contain system prompts, skill manifests and local policy text rather
	// than the member's request.
	hadRuntimeBlock := false
	for _, pattern := range harnessRuntimeBlockPatterns {
		hadRuntimeBlock = hadRuntimeBlock || pattern.MatchString(text)
		text = pattern.ReplaceAllString(text, "")
	}
	lower := strings.ToLower(text)
	// The harness places the actual turn after a labelled user message. Keep
	// only that suffix when present.
	if hadRuntimeBlock {
		for _, marker := range []string{"\nuser message:", "\nuser request:", "\nmember message:", "\nmember request:"} {
			if index := strings.LastIndex(lower, marker); index >= 0 {
				return strings.TrimSpace(text[index+len(marker):])
			}
		}
	}
	return strings.TrimSpace(text)
}

var harnessRuntimeBlockPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?is)<system-reminder\b[^>]*>.*?</system-reminder\s*>`),
	regexp.MustCompile(`(?is)<available_skills\b[^>]*>.*?</available_skills\s*>`),
	regexp.MustCompile(`(?is)<environment_context\b[^>]*>.*?</environment_context\s*>`),
	regexp.MustCompile(`(?is)<app-context\b[^>]*>.*?</app-context\s*>`),
	regexp.MustCompile(`(?is)<skills_instructions\b[^>]*>.*?</skills_instructions\s*>`),
	regexp.MustCompile(`(?is)<permissions\s+instructions\b[^>]*>.*?</permissions\s+instructions\s*>`),
}

func redactRequestBody(raw []byte) string {
	var value any
	if common.Unmarshal(raw, &value) == nil {
		redactJSONValue(value)
		if encoded, err := common.Marshal(value); err == nil {
			raw = encoded
		}
	}
	if !utf8.Valid(raw) {
		return "[non-text request body omitted]"
	}
	return string(raw)
}

func truncateMemberRequestText(text string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(text) <= maxBytes {
		return text, false
	}
	for maxBytes > 0 && !utf8.RuneStart(text[maxBytes]) {
		maxBytes--
	}
	return text[:maxBytes] + "\n...[truncated]", true
}

func redactJSONValue(value any) {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			lower := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
			if strings.Contains(lower, "password") || strings.Contains(lower, "secret") ||
				strings.Contains(lower, "authorization") || strings.Contains(lower, "api_key") ||
				lower == "token" || lower == "key" || strings.HasSuffix(lower, "_token") {
				item[key] = "[redacted]"
				continue
			}
			redactJSONValue(child)
		}
	case []any:
		for _, child := range item {
			redactJSONValue(child)
		}
	}
}

func truncateString(value string, max int) string {
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

func ListMemberRequestContent(ctx context.Context, userID int, start, end int64, limit int) ([]model.MemberRequestContent, error) {
	if start > 0 || end > 0 {
		if err := ValidateMemberUsageRange(start, end); err != nil {
			return nil, err
		}
	}
	rows, err := model.ListMemberRequestContent(ctx, userID, start, end, limit)
	if err != nil && isOptionalMemberUsageTableError(err) {
		// Keep the tab usable while an older GoLand process is restarting and
		// applying AutoMigrate. Once the process is restarted, real rows appear.
		return []model.MemberRequestContent{}, nil
	}
	if err != nil {
		return nil, err
	}
	// Normalize rows written by older deployments on read as well. This keeps
	// the administrator view clean immediately after an upgrade; old database
	// rows do not need to be rewritten before they can be safely displayed.
	cleaned := make([]model.MemberRequestContent, 0, len(rows))
	for _, row := range rows {
		row.Content = normalizeStoredMemberRequestContent(row.Content)
		if strings.TrimSpace(row.Content) == "" {
			continue
		}
		row.ContentText = memberRequestPlainText(row.Content)
		cleaned = append(cleaned, row)
	}
	return cleaned, nil
}

type MemberRequestContentPage struct {
	Items      []model.MemberRequestContent `json:"items"`
	NextCursor int64                        `json:"next_cursor"`
	HasMore    bool                         `json:"has_more"`
}

func ListMemberRequestContentPage(ctx context.Context, userID int, start, end, beforeID int64, limit int) (*MemberRequestContentPage, error) {
	if err := ValidateMemberUsageRange(start, end); err != nil {
		return nil, err
	}
	if beforeID < 0 || userID < 0 {
		return nil, errors.New("member_usage_invalid_range")
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := model.ListMemberRequestContentPage(ctx, userID, start, end, beforeID, limit)
	if err != nil {
		return nil, err
	}
	page := &MemberRequestContentPage{Items: []model.MemberRequestContent{}, HasMore: len(rows) > limit}
	if page.HasMore {
		rows = rows[:limit]
	}
	for _, row := range rows {
		page.NextCursor = row.ID
		row.Content = normalizeStoredMemberRequestContent(row.Content)
		if row.Content != "" {
			row.ContentText = memberRequestPlainText(row.Content)
			page.Items = append(page.Items, row)
		}
	}
	return page, nil
}

func normalizeStoredMemberRequestContent(content string) string {
	return memberRequestContentOnly(content)
}

func memberRequestPlainText(content string) string {
	normalized := normalizeStoredMemberRequestContent(content)
	if normalized == "" {
		return ""
	}
	var message struct {
		Content string `json:"content"`
	}
	if common.UnmarshalJsonStr(normalized, &message) == nil && strings.TrimSpace(message.Content) != "" {
		return message.Content
	}
	return normalized
}

func ListMemberRequestContentAlerts(ctx context.Context, userID int, start, end int64, limit int) ([]model.MemberRequestContentAlert, error) {
	if err := ValidateMemberUsageRange(start, end); err != nil {
		return nil, err
	}
	threshold := common.GetEnvOrDefault("MEMBER_REQUEST_CONTENT_REPEAT_ALERT_THRESHOLD", 10)
	rows, err := model.ListRepeatedMemberRequestContent(ctx, userID, start, end, threshold, limit)
	if err != nil && isOptionalMemberUsageTableError(err) {
		return []model.MemberRequestContentAlert{}, nil
	}
	return rows, err
}

func isOptionalMemberUsageTableError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		strings.Contains(message, "no such column") ||
		strings.Contains(message, "unknown column") ||
		strings.Contains(message, "doesn't exist") ||
		strings.Contains(message, "does not exist") ||
		strings.Contains(message, "undefined table")
}

func CaptureMemberRequestContentFromContext(ctx context.Context, requestContext interface{ GetString(string) string }, userID int, path, modelName string, storage common.BodyStorage) {
	if storage == nil {
		return
	}
	raw, err := storage.Bytes()
	if err != nil {
		return
	}
	CaptureMemberRequestContent(ctx, userID, requestContext.GetString("username"), requestContext.GetString(common.RequestIdKey), path, modelName, raw)
}

// CaptureMemberWorkspaceFromRequest records the workspace reported by the
// private Harness client. A workspace is deliberately reduced to its final
// directory name before storage, so the server does not retain a developer's
// absolute local path. Missing headers are ignored for compatibility with
// older clients.
func CaptureMemberWorkspaceFromRequest(ctx context.Context, userID int, workspace, branch, source, sessionID string) {
	workspace = strings.TrimSpace(strings.ReplaceAll(workspace, "\\", "/"))
	workspace = strings.TrimSuffix(workspace, "/")
	if workspace == "" {
		return
	}
	workspace = filepath.Base(workspace)
	if workspace == "." || workspace == "/" || workspace == "" {
		return
	}
	if source == "" {
		source = "codex"
	}
	if source != "git" && source != "directory" && source != "codex" {
		source = "codex"
	}
	if sessionID == "" || ValidateWorkSessionID(sessionID) != nil {
		// The client may omit a session id. The model layer will reject an
		// invalid id, so use a stable value derived by the caller when absent.
		sessionID = uuid.NewSHA1(uuid.NameSpaceURL, []byte(fmt.Sprintf("new-api:%d:%s:%s", userID, workspace, branch))).String()
	}
	row := &model.MemberWorkSession{UserID: userID, SessionID: sessionID, Project: workspace, Branch: strings.TrimSpace(branch), Source: source}
	if err := StartMemberWorkSession(ctx, row); err != nil {
		common.SysError(fmt.Sprintf("failed to save member workspace: %v", err))
		return
	}
	if err := model.UpdateMemberWorkSession(ctx, userID, row.SessionID, false); err != nil {
		if errors.Is(err, model.ErrWorkSessionEnded) {
			row.SessionID = uuid.New().String()
			if restartErr := StartMemberWorkSession(ctx, row); restartErr == nil {
				_ = model.UpdateMemberWorkSession(ctx, userID, row.SessionID, false)
			}
			return
		}
		common.SysError(fmt.Sprintf("failed to heartbeat member workspace: %v", err))
	}
}
