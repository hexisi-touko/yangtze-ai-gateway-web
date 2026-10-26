package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxClientConfigReleaseNotesBytes = 64 * 1024

type clientConfigReleaseRequest struct {
	Version      int64                    `json:"version"`
	ReleaseNotes string                   `json:"release_notes"`
	Config       model.ClientRemoteConfig `json:"config"`
	Mandatory    bool                     `json:"mandatory"`
}

type clientConfigReleaseResponse struct {
	ID           int                      `json:"id"`
	Version      int64                    `json:"version"`
	ReleaseNotes string                   `json:"release_notes"`
	Config       model.ClientRemoteConfig `json:"config"`
	Mandatory    bool                     `json:"mandatory"`
	Published    bool                     `json:"published"`
	CreatedBy    int                      `json:"created_by"`
	PublishedAt  int64                    `json:"published_at"`
	CreatedAt    int64                    `json:"created_at"`
	UpdatedAt    int64                    `json:"updated_at"`
}

func clientConfigReleaseError(c *gin.Context, status int, code string) {
	c.JSON(status, gin.H{"success": false, "message": code, "code": code})
}

func decodeClientConfigReleaseRequest(c *gin.Context) (clientConfigReleaseRequest, error) {
	var request clientConfigReleaseRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxClientConfigReleaseNotesBytes+8192)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		return request, errors.New("client_config_release_invalid_request")
	}
	if request.Version <= 0 {
		return request, errors.New("client_config_release_invalid_version")
	}
	if len(request.ReleaseNotes) > maxClientConfigReleaseNotesBytes {
		return request, errors.New("client_config_release_notes_too_long")
	}
	if request.Config.UpdateCheckIntervalMinutes < 5 || request.Config.UpdateCheckIntervalMinutes > 1440 {
		return request, errors.New("client_config_release_invalid_interval")
	}
	return request, nil
}

func clientConfigReleaseModel(request clientConfigReleaseRequest, createdBy int) (model.ClientConfigRelease, error) {
	configJSON, err := common.Marshal(request.Config)
	if err != nil {
		return model.ClientConfigRelease{}, errors.New("client_config_release_invalid_config")
	}
	return model.ClientConfigRelease{
		Version:      request.Version,
		ReleaseNotes: strings.TrimSpace(request.ReleaseNotes),
		ConfigJSON:   string(configJSON),
		Mandatory:    request.Mandatory,
		CreatedBy:    createdBy,
	}, nil
}

func buildClientConfigReleaseResponse(release *model.ClientConfigRelease) (clientConfigReleaseResponse, error) {
	var config model.ClientRemoteConfig
	if err := common.Unmarshal([]byte(release.ConfigJSON), &config); err != nil {
		return clientConfigReleaseResponse{}, errors.New("client_config_release_invalid_config")
	}
	return clientConfigReleaseResponse{
		ID: release.ID, Version: release.Version, ReleaseNotes: release.ReleaseNotes,
		Config: config, Mandatory: release.Mandatory, Published: release.Published,
		CreatedBy: release.CreatedBy, PublishedAt: release.PublishedAt,
		CreatedAt: release.CreatedAt, UpdatedAt: release.UpdatedAt,
	}, nil
}

func ListClientConfigReleases(c *gin.Context) {
	releases, err := model.ListClientConfigReleases(c.Request.Context())
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, "client_config_release_unavailable")
		return
	}
	result := make([]clientConfigReleaseResponse, 0, len(releases))
	for index := range releases {
		item, err := buildClientConfigReleaseResponse(&releases[index])
		if err != nil {
			clientConfigReleaseError(c, http.StatusInternalServerError, err.Error())
			return
		}
		result = append(result, item)
	}
	common.ApiSuccess(c, result)
}

func CreateClientConfigRelease(c *gin.Context) {
	request, err := decodeClientConfigReleaseRequest(c)
	if err != nil {
		clientConfigReleaseError(c, http.StatusBadRequest, err.Error())
		return
	}
	release, err := clientConfigReleaseModel(request, c.GetInt("id"))
	if err != nil {
		clientConfigReleaseError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := model.SaveClientConfigRelease(c.Request.Context(), &release); err != nil {
		clientConfigReleaseError(c, http.StatusConflict, "client_config_release_conflict")
		return
	}
	result, err := buildClientConfigReleaseResponse(&release)
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, err.Error())
		return
	}
	common.ApiSuccess(c, result)
}

func UpdateClientConfigRelease(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		clientConfigReleaseError(c, http.StatusBadRequest, "client_config_release_invalid_id")
		return
	}
	request, err := decodeClientConfigReleaseRequest(c)
	if err != nil {
		clientConfigReleaseError(c, http.StatusBadRequest, err.Error())
		return
	}
	release, err := clientConfigReleaseModel(request, c.GetInt("id"))
	if err != nil {
		clientConfigReleaseError(c, http.StatusBadRequest, err.Error())
		return
	}
	release.ID = id
	if err := model.SaveClientConfigRelease(c.Request.Context(), &release); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			clientConfigReleaseError(c, http.StatusNotFound, "client_config_release_not_found")
			return
		}
		if errors.Is(err, model.ErrClientConfigReleasePublished) {
			clientConfigReleaseError(c, http.StatusConflict, err.Error())
			return
		}
		clientConfigReleaseError(c, http.StatusConflict, "client_config_release_conflict")
		return
	}
	result, err := buildClientConfigReleaseResponse(&release)
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, err.Error())
		return
	}
	common.ApiSuccess(c, result)
}

func SetClientConfigReleasePublished(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		clientConfigReleaseError(c, http.StatusBadRequest, "client_config_release_invalid_id")
		return
	}
	action := c.Param("action")
	if action != "publish" && action != "unpublish" {
		clientConfigReleaseError(c, http.StatusBadRequest, "client_config_release_invalid_action")
		return
	}
	if err := model.SetClientConfigReleasePublished(c.Request.Context(), id, action == "publish"); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			clientConfigReleaseError(c, http.StatusNotFound, "client_config_release_not_found")
			return
		}
		clientConfigReleaseError(c, http.StatusInternalServerError, "client_config_release_unavailable")
		return
	}
	release, err := model.GetClientConfigRelease(c.Request.Context(), id)
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, "client_config_release_unavailable")
		return
	}
	result, err := buildClientConfigReleaseResponse(release)
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, err.Error())
		return
	}
	common.ApiSuccess(c, result)
}

func DeleteClientConfigRelease(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		clientConfigReleaseError(c, http.StatusBadRequest, "client_config_release_invalid_id")
		return
	}
	if err := model.DeleteClientConfigRelease(c.Request.Context(), id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			clientConfigReleaseError(c, http.StatusNotFound, "client_config_release_not_found")
			return
		}
		if errors.Is(err, model.ErrClientConfigReleasePublished) {
			clientConfigReleaseError(c, http.StatusConflict, err.Error())
			return
		}
		clientConfigReleaseError(c, http.StatusInternalServerError, "client_config_release_unavailable")
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": true})
}

func GetLatestClientConfig(c *gin.Context) {
	currentVersion, err := strconv.ParseInt(strings.TrimSpace(c.Query("current_version")), 10, 64)
	if err != nil || currentVersion < 0 {
		currentVersion = 0
	}
	release, err := model.GetLatestClientConfigRelease(c.Request.Context())
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, "client_config_release_unavailable")
		return
	}
	// Return a different published version in either direction so an admin can
	// roll back a bad configuration without rebuilding the client.
	if release == nil || release.Version == currentVersion {
		common.ApiSuccess(c, gin.H{"config_available": false, "release": nil})
		return
	}
	result, err := buildClientConfigReleaseResponse(release)
	if err != nil {
		clientConfigReleaseError(c, http.StatusInternalServerError, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{"config_available": true, "release": result})
}
