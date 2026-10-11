package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/adminversion"
	"github.com/gin-gonic/gin"
)

func GetAdminUpdates(c *gin.Context) {
	var manifest map[string]any
	if err := common.Unmarshal(adminversion.Manifest, &manifest); err != nil {
		common.ApiErrorMsg(c, "admin_updates_unavailable")
		return
	}
	manifest["revision"] = adminversion.Revision
	manifest["build_time"] = adminversion.BuildTime
	common.ApiSuccess(c, manifest)
}
