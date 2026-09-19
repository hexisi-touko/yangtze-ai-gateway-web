package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func analysisConfigResponse(c *gin.Context, cfg model.MemberAnalysisConfig) {
	common.ApiSuccess(c, gin.H{"base_url": cfg.BaseURL, "model": cfg.Model, "has_key": cfg.APIKey != "", "version": cfg.Version})
}

func GetMemberAnalysisConfig(c *gin.Context) {
	cfg, err := service.GetMemberAnalysisConfig(c.Request.Context())
	if err != nil {
		memberUsageError(c, err)
		return
	}
	analysisConfigResponse(c, cfg)
}

func PutMemberAnalysisConfig(c *gin.Context) {
	var input struct {
		BaseURL  string `json:"base_url"`
		Model    string `json:"model"`
		APIKey   string `json:"api_key"`
		ClearKey bool   `json:"clear_key"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		memberUsageError(c, errors.New("member_usage_ai_invalid_config"))
		return
	}
	cfg, err := service.SaveMemberAnalysisConfig(c.Request.Context(), input.BaseURL, input.Model, input.APIKey, input.ClearKey)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	analysisConfigResponse(c, cfg)
}

func TestMemberAnalysis(c *gin.Context) {
	if err := service.TestMemberAnalysis(c.Request.Context()); err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"connected": true})
}

func PreviewMemberAnalysis(c *gin.Context) {
	var input struct {
		Start    int64 `json:"start"`
		End      int64 `json:"end"`
		MemberID int   `json:"member_id"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		memberUsageError(c, errors.New("member_usage_invalid_range"))
		return
	}
	run, err := service.PreviewMemberAnalysis(c.Request.Context(), input.Start, input.End, input.MemberID, c.GetInt("id"))
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, run)
}

func ChatMemberAnalysis(c *gin.Context) {
	var input struct {
		ParentID      int    `json:"parent_id"`
		Question      string `json:"question"`
		Consent       bool   `json:"consent"`
		ConfigVersion int64  `json:"config_version"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16000)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		memberUsageError(c, errors.New("member_usage_ai_invalid_question"))
		return
	}
	run, err := service.ChatMemberAnalysis(c.Request.Context(), input.ParentID, c.GetInt("id"), input.Question, input.Consent, input.ConfigVersion)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, run)
}

func ListMemberAnalysis(c *gin.Context) {
	runs := make([]model.MemberAnalysisRun, 0)
	err := model.DB.WithContext(c.Request.Context()).Omit("snapshot", "messages", "answer").Where("created_by = ? AND answer <> ''", c.GetInt("id")).Order("id desc").Limit(50).Find(&runs).Error
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, runs)
}

func GetMemberAnalysis(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	run, err := service.GetMemberAnalysisRun(c.Request.Context(), id, c.GetInt("id"))
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, run)
}
