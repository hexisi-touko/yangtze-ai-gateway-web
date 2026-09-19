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

func GetUsageValue(c *gin.Context) {
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	result, err := service.BuildUsageValue(c.Request.Context(), start, end)
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func SyncOfficialUsagePrices(c *gin.Context) {
	var input struct {
		ExchangeRate string `json:"exchange_rate"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		memberUsageError(c, errors.New("member_usage_value_invalid_exchange_rate"))
		return
	}
	if input.ExchangeRate == "" {
		input.ExchangeRate = "7.2"
	}
	result, err := service.SyncOpenAIOfficialPrices(c.Request.Context(), input.ExchangeRate, c.GetInt("id"))
	if err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func PostUsageReferencePrice(c *gin.Context) {
	var input model.UsageReferencePrice
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		memberUsageError(c, errors.New("member_usage_value_invalid_price"))
		return
	}
	input.CreatedBy = c.GetInt("id")
	if err := service.SaveUsageReferencePrice(c.Request.Context(), &input); err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, input)
}

func PostUsageCost(c *gin.Context) {
	var input model.UsageCost
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if common.DecodeJson(c.Request.Body, &input) != nil {
		memberUsageError(c, errors.New("member_usage_value_invalid_cost"))
		return
	}
	input.CreatedBy = c.GetInt("id")
	if err := service.SaveUsageCost(c.Request.Context(), &input); err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, input)
}

func DeleteUsageCost(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		memberUsageError(c, errors.New("member_usage_not_found"))
		return
	}
	var cost model.UsageCost
	if err = model.DB.WithContext(c.Request.Context()).First(&cost, id).Error; err != nil {
		memberUsageError(c, err)
		return
	}
	if err = model.DB.WithContext(c.Request.Context()).Delete(&cost).Error; err != nil {
		memberUsageError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
