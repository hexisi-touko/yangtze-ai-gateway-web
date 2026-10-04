package service

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"
	"github.com/google/uuid"
)

func ValidateWorkSessionID(id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		return errors.New("member_usage_invalid_work_session")
	}
	return nil
}

func StartMemberWorkSession(ctx context.Context, row *model.MemberWorkSession) error {
	if err := ValidateWorkSessionID(row.SessionID); err != nil {
		return err
	}
	row.Project, row.Branch, row.Purpose = strings.TrimSpace(row.Project), strings.TrimSpace(row.Branch), strings.TrimSpace(row.Purpose)
	for _, field := range []struct {
		value string
		limit int
	}{{row.Project, 120}, {row.Branch, 200}, {row.Purpose, 500}} {
		if !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.limit || strings.ContainsFunc(field.value, unicode.IsControl) {
			return errors.New("member_usage_invalid_work_session")
		}
	}
	if row.UserID <= 0 || row.Project == "" || (row.Source != "git" && row.Source != "directory" && row.Source != "codex") || strings.ContainsAny(row.Project, `/\\`) {
		return errors.New("member_usage_invalid_work_session")
	}
	row.EndedAt = 0
	return model.StartMemberWorkSession(ctx, row)
}
