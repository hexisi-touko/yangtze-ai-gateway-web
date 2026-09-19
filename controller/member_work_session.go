package controller

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func StartMemberWorkSession(c *gin.Context) {
	var request struct {
		SessionID string `json:"session_id"`
		Project   string `json:"project"`
		Branch    string `json:"branch"`
		Source    string `json:"source"`
		Purpose   string `json:"purpose"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		memberUsageError(c, errors.New("member_usage_invalid_work_session"))
		return
	}
	row := model.MemberWorkSession{UserID: c.GetInt("id"), SessionID: request.SessionID, Project: request.Project, Branch: request.Branch, Source: request.Source, Purpose: request.Purpose}
	if err := service.StartMemberWorkSession(c.Request.Context(), &row); err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}

func TouchMemberWorkSession(c *gin.Context) { updateMemberWorkSession(c, false) }
func StopMemberWorkSession(c *gin.Context)  { updateMemberWorkSession(c, true) }

func updateMemberWorkSession(c *gin.Context, stop bool) {
	id := c.Param("session_id")
	if err := service.ValidateWorkSessionID(id); err != nil {
		memberUsageError(c, err)
		return
	}
	if err := model.UpdateMemberWorkSession(c.Request.Context(), c.GetInt("id"), id, stop); err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ListMemberWorkSessions(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	rows, err := model.ListMemberWorkSessions(ctx, 0)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "generated_at": time.Now().Unix(), "stale_after_seconds": 180, "limit": 100})
}
