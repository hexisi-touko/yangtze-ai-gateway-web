package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestCacheMissingAPIRoutes(t *testing.T) {
	for _, path := range []string{"/api/member-usage/summary?start=1&end=2", "/api", "/v1/models"} {
		t.Run(path, func(t *testing.T) {
			router := gin.New()
			router.Use(Cache())
			router.NoRoute(func(c *gin.Context) {
				c.JSON(http.StatusNotFound, gin.H{"success": false})
			})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

			assert.Equal(t, http.StatusNotFound, response.Code)
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
			assert.NotContains(t, response.Header().Get("Cache-Control"), "604800")
		})
	}
}

func TestCachePreservesStaticAssetPolicy(t *testing.T) {
	router := gin.New()
	router.Use(Cache())
	router.GET("/static/js/index.hash.js", func(c *gin.Context) {
		c.String(http.StatusOK, "script")
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/static/js/index.hash.js", nil))

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "max-age=604800", response.Header().Get("Cache-Control"))
}
