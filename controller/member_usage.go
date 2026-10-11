package controller

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func memberUsageError(c *gin.Context, err error) {
	code, status := "member_usage_unavailable", http.StatusInternalServerError
	if errors.Is(err, gorm.ErrRecordNotFound) {
		code, status = "member_usage_not_found", http.StatusNotFound
	}
	if strings.HasPrefix(err.Error(), "member_usage_") {
		code, status = err.Error(), http.StatusBadRequest
	}
	switch code {
	case "member_usage_value_official_sync_network_error", "member_usage_value_official_sync_http_error", "member_usage_value_official_sync_parse_error":
		status = http.StatusBadGateway
	case "member_usage_value_official_sync_database_error":
		status = http.StatusInternalServerError
	}
	c.JSON(status, gin.H{"success": false, "message": code, "code": code})
}

func GetMemberUsageSummary(c *gin.Context) {
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	result, err := service.BuildMemberUsageSummary(c.Request.Context(), start, end)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetMemberUsageTrend(c *gin.Context) {
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	points, err := service.BuildMemberUsageTrend(c.Request.Context(), start, end, c.Query("granularity"))
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, points)
}

func PutMemberUsageProfile(c *gin.Context) {
	var request struct {
		MemberType string `json:"member_type"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		memberUsageError(c, errors.New("member_usage_invalid_profile"))
		return
	}
	id, _ := strconv.Atoi(c.Param("user_id"))
	// Project and purpose remain in the table for historical compatibility, but
	// are no longer editable from the member classification form. Preserve any
	// legacy values when a classification-only update is submitted.
	profile := model.MemberUsageProfile{UserID: id, MemberType: request.MemberType, UpdatedBy: c.GetInt("id")}
	var existing model.MemberUsageProfile
	if err := model.DB.WithContext(c.Request.Context()).First(&existing, id).Error; err == nil {
		profile.Project, profile.Purpose = existing.Project, existing.Purpose
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		memberUsageError(c, err)
		return
	}
	if err := service.UpdateMemberUsageProfile(c.Request.Context(), &profile); err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, profile)
}

// GetMemberUsageProfile is used by the user-management editor to show the
// reporting classification without exposing the member-usage page itself.
func GetMemberUsageProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("user_id"))
	if err != nil || id <= 0 {
		memberUsageError(c, errors.New("member_usage_invalid_profile"))
		return
	}
	var profile model.MemberUsageProfile
	err = model.DB.WithContext(c.Request.Context()).First(&profile, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		profile = model.MemberUsageProfile{UserID: id, MemberType: "unspecified"}
		err = nil
	}
	if err != nil {
		memberUsageError(c, err)
		return
	}
	if profile.MemberType == "" {
		profile.MemberType = "unspecified"
	}
	common.ApiSuccess(c, profile)
}

func PostMemberUsageReport(c *gin.Context) {
	var request struct {
		Title     string `json:"title"`
		Note      string `json:"note"`
		StartTime int64  `json:"start_time"`
		EndTime   int64  `json:"end_time"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		memberUsageError(c, errors.New("member_usage_invalid_report"))
		return
	}
	report := model.MemberUsageReport{Title: request.Title, Note: request.Note, StartTime: request.StartTime, EndTime: request.EndTime, CreatedBy: c.GetInt("id")}
	if err := service.ArchiveMemberUsageReport(c.Request.Context(), &report); err != nil {
		memberUsageError(c, err)
		return
	}
	report.Snapshot = ""
	report.ValueSnapshot = ""
	report.RequestArchive = ""
	common.ApiSuccess(c, report)
}

func ListMemberUsageReports(c *gin.Context) {
	reports, err := model.ListMemberUsageReports(c.Request.Context())
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, reports)
}

func GetMemberUsageReport(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		memberUsageError(c, errors.New("member_usage_not_found"))
		return
	}
	report, err := model.GetMemberUsageReport(c.Request.Context(), id)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, report)
}

// GetMemberRequestContents exposes only the redacted request audit table to
// administrators. It deliberately does not reuse the ordinary log endpoint.
func GetMemberRequestContents(c *gin.Context) {
	userID, _ := strconv.Atoi(c.Query("user_id"))
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	contents, err := service.ListMemberRequestContent(c.Request.Context(), userID, start, end, limit)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, contents)
}

func GetMemberRequestContentsPage(c *gin.Context) {
	userID, _ := strconv.Atoi(c.Query("user_id"))
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	beforeID, _ := strconv.ParseInt(c.Query("before_id"), 10, 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	page, err := service.ListMemberRequestContentPage(c.Request.Context(), userID, start, end, beforeID, limit)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func GetMemberReportRequestArchive(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		memberUsageError(c, errors.New("member_usage_not_found"))
		return
	}
	report, err := model.GetMemberUsageReport(c.Request.Context(), id)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	archive, err := service.DecodeMemberRequestArchive(report)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, archive)
}

func RebuildMemberReportRequestArchive(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		memberUsageError(c, errors.New("member_usage_not_found"))
		return
	}
	report, err := model.GetMemberUsageReport(c.Request.Context(), id)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	archive, err := service.EnsureMemberRequestArchive(c.Request.Context(), report)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, archive)
}

func ExportMemberReportDocument(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	userID, _ := strconv.Atoi(c.Param("user_id"))
	if id <= 0 || userID <= 0 {
		memberUsageError(c, errors.New("member_usage_not_found"))
		return
	}
	report, err := model.GetMemberUsageReport(c.Request.Context(), id)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	// Finish and validate before sending a successful download response.
	output, err := service.CreateMemberRequestDocumentFile(c.Request.Context(), report, userID)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	defer os.Remove(output)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.FileAttachment(output, fmt.Sprintf("member-%d-report-%d.html", userID, id))
}

// GetMemberRequestContentAlerts returns repeated request fingerprints that
// need a human check. It intentionally does not label any member as violating
// policy, because retries and batch tasks can have the same request body.
func GetMemberRequestContentAlerts(c *gin.Context) {
	userID, _ := strconv.Atoi(c.Query("user_id"))
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	limit, _ := strconv.Atoi(c.Query("limit"))
	alerts, err := service.ListMemberRequestContentAlerts(c.Request.Context(), userID, start, end, limit)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, alerts)
}
