package controller

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const maxClientReleaseNotesBytes = 64 * 1024

var clientReleaseSHA256Pattern = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)

type clientReleaseRequest struct {
	Version      string `json:"version"`
	Platform     string `json:"platform"`
	Channel      string `json:"channel"`
	ReleaseNotes string `json:"release_notes"`
	DownloadURL  string `json:"download_url"`
	FileName     string `json:"file_name"`
	FileSize     int64  `json:"file_size"`
	SHA256       string `json:"sha256"`
	Mandatory    bool   `json:"mandatory"`
}

func clientReleaseError(c *gin.Context, status int, code string) {
	c.JSON(status, gin.H{"success": false, "message": code, "code": code})
}

func validateClientReleaseRequest(request *clientReleaseRequest) error {
	version, err := model.NormalizeClientReleaseVersion(request.Version)
	if err != nil {
		return err
	}
	request.Version = version
	request.Platform = strings.TrimSpace(request.Platform)
	if request.Platform == "" {
		request.Platform = "windows-x64"
	}
	if request.Platform != "windows-x64" && request.Platform != "windows-arm64" {
		return errors.New("client_release_invalid_platform")
	}
	request.Channel = strings.TrimSpace(request.Channel)
	if request.Channel == "" {
		request.Channel = "stable"
	}
	if request.Channel != "stable" && request.Channel != "beta" {
		return errors.New("client_release_invalid_channel")
	}
	if len(request.ReleaseNotes) > maxClientReleaseNotesBytes {
		return errors.New("client_release_notes_too_long")
	}
	if request.FileSize < 0 {
		return errors.New("client_release_invalid_file_size")
	}
	if request.SHA256 != "" && !clientReleaseSHA256Pattern.MatchString(request.SHA256) {
		return errors.New("client_release_invalid_sha256")
	}
	request.SHA256 = strings.ToLower(request.SHA256)
	parsed, err := url.ParseRequestURI(strings.TrimSpace(request.DownloadURL))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return errors.New("client_release_invalid_download_url")
	}
	request.DownloadURL = parsed.String()
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLocalReleaseHost(parsed.Hostname())) {
		return errors.New("client_release_download_url_must_use_https")
	}
	request.FileName = strings.TrimSpace(request.FileName)
	if request.FileName == "" {
		request.FileName = path.Base(parsed.Path)
	}
	if request.FileName == "." || request.FileName == "/" || len(request.FileName) > 255 {
		return errors.New("client_release_invalid_file_name")
	}
	return nil
}

func isLocalReleaseHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func clientReleaseFileSizeLimit() int64 {
	value := int64(common.GetEnvOrDefault("MAX_CLIENT_RELEASE_SIZE_MB", 512))
	if value <= 0 {
		value = 512
	}
	return value * 1024 * 1024
}

func clientReleaseStorageDir() string {
	dir := strings.TrimSpace(os.Getenv("CLIENT_RELEASE_DIR"))
	if dir == "" {
		dir = filepath.Join("data", "client-releases")
	}
	return dir
}

func clientReleasePublicURL(c *gin.Context, fileName string) string {
	scheme := c.GetHeader("X-Forwarded-Proto")
	if scheme != "https" && scheme != "http" {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s/api/client-releases/files/%s", scheme, c.Request.Host, url.PathEscape(fileName))
}

func UploadClientReleaseFile(c *gin.Context) {
	limit := clientReleaseFileSizeLimit()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit+1024*1024)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			clientReleaseError(c, http.StatusRequestEntityTooLarge, "client_release_file_too_large")
			return
		}
		clientReleaseError(c, http.StatusBadRequest, "client_release_file_required")
		return
	}
	defer file.Close()
	originalName := filepath.Base(strings.TrimSpace(header.Filename))
	if originalName == "." || originalName == "" || !strings.EqualFold(filepath.Ext(originalName), ".exe") {
		clientReleaseError(c, http.StatusBadRequest, "client_release_file_must_be_exe")
		return
	}
	if header.Size > limit {
		clientReleaseError(c, http.StatusRequestEntityTooLarge, "client_release_file_too_large")
		return
	}
	if err := os.MkdirAll(clientReleaseStorageDir(), 0755); err != nil {
		clientReleaseError(c, http.StatusInternalServerError, "client_release_file_unavailable")
		return
	}
	storageName := uuid.NewString() + ".exe"
	storagePath := filepath.Join(clientReleaseStorageDir(), storageName)
	out, err := os.OpenFile(storagePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		clientReleaseError(c, http.StatusInternalServerError, "client_release_file_unavailable")
		return
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(out, hash), io.LimitReader(file, limit+1))
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil || written > limit {
		_ = os.Remove(storagePath)
		if written > limit {
			clientReleaseError(c, http.StatusRequestEntityTooLarge, "client_release_file_too_large")
		} else {
			clientReleaseError(c, http.StatusInternalServerError, "client_release_file_unavailable")
		}
		return
	}
	checksum := fmt.Sprintf("%x", hash.Sum(nil))
	common.ApiSuccess(c, gin.H{
		"download_url": clientReleasePublicURL(c, storageName) + "?name=" + url.QueryEscape(originalName),
		"file_name":    originalName,
		"file_size":    written,
		"sha256":       checksum,
	})
}

func DownloadClientReleaseFile(c *gin.Context) {
	storageName := filepath.Base(c.Param("file_name"))
	if storageName != c.Param("file_name") || !strings.HasSuffix(strings.ToLower(storageName), ".exe") {
		c.Status(http.StatusNotFound)
		return
	}
	storagePath := filepath.Join(clientReleaseStorageDir(), storageName)
	if _, err := os.Stat(storagePath); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	downloadName := filepath.Base(strings.TrimSpace(c.Query("name")))
	if downloadName == "." || downloadName == "" || !strings.EqualFold(filepath.Ext(downloadName), ".exe") {
		downloadName = storageName
	}
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", downloadName))
	http.ServeFile(c.Writer, c.Request, storagePath)
}

func decodeClientReleaseRequest(c *gin.Context) (clientReleaseRequest, error) {
	var request clientReleaseRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxClientReleaseNotesBytes+8*1024)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		return request, errors.New("client_release_invalid_request")
	}
	if err := validateClientReleaseRequest(&request); err != nil {
		return request, err
	}
	return request, nil
}

func clientReleaseModel(request clientReleaseRequest, createdBy int) model.ClientRelease {
	return model.ClientRelease{
		Version:      request.Version,
		Platform:     request.Platform,
		Channel:      request.Channel,
		ReleaseNotes: request.ReleaseNotes,
		DownloadURL:  request.DownloadURL,
		FileName:     request.FileName,
		FileSize:     request.FileSize,
		SHA256:       request.SHA256,
		Mandatory:    request.Mandatory,
		CreatedBy:    createdBy,
	}
}

func ListClientReleases(c *gin.Context) {
	releases, err := model.ListClientReleases(c.Request.Context())
	if err != nil {
		clientReleaseError(c, http.StatusInternalServerError, "client_release_unavailable")
		return
	}
	common.ApiSuccess(c, releases)
}

func CreateClientRelease(c *gin.Context) {
	request, err := decodeClientReleaseRequest(c)
	if err != nil {
		clientReleaseError(c, http.StatusBadRequest, err.Error())
		return
	}
	release := clientReleaseModel(request, c.GetInt("id"))
	if err := model.SaveClientRelease(c.Request.Context(), &release); err != nil {
		clientReleaseError(c, http.StatusConflict, "client_release_conflict")
		return
	}
	common.ApiSuccess(c, release)
}

func UpdateClientRelease(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		clientReleaseError(c, http.StatusBadRequest, "client_release_invalid_id")
		return
	}
	request, err := decodeClientReleaseRequest(c)
	if err != nil {
		clientReleaseError(c, http.StatusBadRequest, err.Error())
		return
	}
	release := clientReleaseModel(request, c.GetInt("id"))
	release.ID = id
	if err := model.SaveClientRelease(c.Request.Context(), &release); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			clientReleaseError(c, http.StatusNotFound, "client_release_not_found")
			return
		}
		if errors.Is(err, model.ErrClientReleasePublished) {
			clientReleaseError(c, http.StatusConflict, err.Error())
			return
		}
		clientReleaseError(c, http.StatusConflict, "client_release_conflict")
		return
	}
	common.ApiSuccess(c, release)
}

func SetClientReleasePublished(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		clientReleaseError(c, http.StatusBadRequest, "client_release_invalid_id")
		return
	}
	published := c.Param("action") == "publish"
	if !published && c.Param("action") != "unpublish" {
		clientReleaseError(c, http.StatusBadRequest, "client_release_invalid_action")
		return
	}
	if err := model.SetClientReleasePublished(c.Request.Context(), id, published); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			clientReleaseError(c, http.StatusNotFound, "client_release_not_found")
			return
		}
		clientReleaseError(c, http.StatusInternalServerError, "client_release_unavailable")
		return
	}
	release, err := model.GetClientRelease(c.Request.Context(), id)
	if err != nil {
		clientReleaseError(c, http.StatusInternalServerError, "client_release_unavailable")
		return
	}
	common.ApiSuccess(c, release)
}

func DeleteClientRelease(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		clientReleaseError(c, http.StatusBadRequest, "client_release_invalid_id")
		return
	}
	if err := model.DeleteClientRelease(c.Request.Context(), id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			clientReleaseError(c, http.StatusNotFound, "client_release_not_found")
			return
		}
		if errors.Is(err, model.ErrClientReleasePublished) {
			clientReleaseError(c, http.StatusConflict, err.Error())
			return
		}
		clientReleaseError(c, http.StatusInternalServerError, "client_release_unavailable")
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": true})
}

func GetLatestClientRelease(c *gin.Context) {
	platform := c.DefaultQuery("platform", "windows-x64")
	channel := c.DefaultQuery("channel", "stable")
	if (platform != "windows-x64" && platform != "windows-arm64") || (channel != "stable" && channel != "beta") {
		clientReleaseError(c, http.StatusBadRequest, "client_release_invalid_target")
		return
	}
	currentVersion := strings.TrimSpace(c.Query("current_version"))
	if currentVersion != "" {
		var err error
		currentVersion, err = model.NormalizeClientReleaseVersion(currentVersion)
		if err != nil {
			clientReleaseError(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	release, err := model.GetLatestClientRelease(c.Request.Context(), platform, channel)
	if err != nil {
		clientReleaseError(c, http.StatusInternalServerError, "client_release_unavailable")
		return
	}
	available := release != nil && currentVersion != "" && model.ReleaseVersionIsNewer(release.Version, currentVersion)
	common.ApiSuccess(c, gin.H{
		"release":          release,
		"update_available": available,
	})
}
