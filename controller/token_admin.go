package controller

import (
	"errors"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func AdminListMemberTokens(c *gin.Context) {
	page := common.GetPageQuery(c)
	status := 0
	if value := c.Query("status"); value != "" {
		var err error
		status, err = strconv.Atoi(value)
		if err != nil || status < common.TokenStatusEnabled || status > common.TokenStatusExhausted {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid key status"})
			return
		}
	}
	if page.Page < 1 || page.PageSize < 1 || page.Page > 1000000 || utf8.RuneCountInString(c.Query("keyword")) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid member key filters"})
		return
	}
	items, total, err := model.ListManagedMemberTokens(c.Request.Context(), c.Query("keyword"), status, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.SysError("failed to list member API keys: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load member API keys"})
		return
	}
	page.SetItems(items)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func AdminGetMemberTokenKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid API key ID"})
		return
	}
	token, err := model.GetManagedMemberToken(c.Request.Context(), id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Member API key not found"})
		return
	}
	if err != nil {
		common.SysError("failed to read member API key: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load API keys"})
		return
	}
	common.ApiSuccess(c, gin.H{"key": token.GetFullKey()})
}
