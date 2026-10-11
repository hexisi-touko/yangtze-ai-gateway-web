package controller

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// RegisterScheduledSystemTasks wires the periodic channel test, upstream model
// update, and async task polling (Midjourney / Suno / video) jobs into the
// system task framework so a DB lease dedups execution across multiple master
// instances and each run is recorded as one task row. Call this before
// service.StartSystemTaskRunner.
func RegisterScheduledSystemTasks() {
	service.RegisterSystemTaskHandler(channelTestHandler{})
	service.RegisterSystemTaskHandler(modelUpdateHandler{})
	service.RegisterSystemTaskHandler(midjourneyPollHandler{})
	service.RegisterSystemTaskHandler(asyncTaskPollHandler{})
	service.RegisterSystemTaskHandler(memberUsageDailyReportHandler{})
	service.RegisterSystemTaskHandler(officialPriceSyncHandler{})
}

type officialPriceSyncHandler struct{}

func (officialPriceSyncHandler) Type() string { return model.SystemTaskTypeOfficialPriceSync }
func (officialPriceSyncHandler) Enabled() bool {
	return common.GetEnvOrDefaultBool("OPENAI_OFFICIAL_PRICE_SYNC_ENABLED", true)
}
func (officialPriceSyncHandler) Interval() time.Duration { return 24 * time.Hour }
func (officialPriceSyncHandler) NewPayload() any {
	return map[string]string{"exchange_rate": common.GetEnvOrDefaultString("OPENAI_USD_CNY_RATE", "7.2")}
}
func (officialPriceSyncHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := map[string]string{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	rate := payload["exchange_rate"]
	if rate == "" {
		rate = common.GetEnvOrDefaultString("OPENAI_USD_CNY_RATE", "7.2")
	}
	result, err := service.SyncOpenAIOfficialPrices(ctx, rate, 0)
	if err != nil {
		// A pricing page outage must not erase the last successful snapshot.
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, map[string]any{"source_url": "https://developers.openai.com/api/docs/pricing", "preserved_previous_snapshot": true}, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, result, nil)
}

type memberUsageDailyReportHandler struct{}

func (memberUsageDailyReportHandler) Type() string { return model.SystemTaskTypeMemberUsageDailyReport }

func (memberUsageDailyReportHandler) Enabled() bool {
	return common.GetEnvOrDefaultBool("MEMBER_USAGE_DAILY_REPORT_ENABLED", true)
}

func (memberUsageDailyReportHandler) Interval() time.Duration { return 24 * time.Hour }

func (memberUsageDailyReportHandler) NewPayload() any {
	start, end := service.PreviousLocalDayRange(1)
	return map[string]int64{"start": start, "end": end}
}

func (memberUsageDailyReportHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := map[string]int64{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	start, end := payload["start"], payload["end"]
	if start <= 0 || end <= start {
		start, end = service.PreviousLocalDayRange(1)
	}
	report, _, err := service.ArchiveDailyMemberUsageReport(ctx, start, end)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	// Daily reports are retained for traceability. Request bodies are cleaned
	// only after the previous calendar month has been archived, so the five
	// lowest-usage members are selected from a complete month rather than one
	// arbitrary day.
	// Check on every daily run. Archiving is idempotent, so a restart or an
	// outage on the first day of a month cannot permanently skip last month's
	// report and request-body cleanup.
	monthlyReportID := 0
	monthlyDeleted := int64(0)
	monthStart, monthEnd := service.PreviousLocalMonthRange(1)
	monthlyReport, monthlyErr := service.ArchiveMonthlyMemberUsageReport(ctx, monthStart, monthEnd)
	if monthlyErr != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, monthlyErr)
		return
	}
	monthlyReportID = monthlyReport.ID
	monthlyDeleted, err = service.CleanupLowUsageRequestContent(ctx, monthStart, monthEnd)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	maxRetention := common.GetEnvOrDefault("MEMBER_REQUEST_CONTENT_MAX_RETENTION_DAYS", 0)
	oldContentDeleted := int64(0)
	if maxRetention > 0 {
		cutoff, _ := service.PreviousLocalDayRange(maxRetention)
		oldContentDeleted, err = service.CleanupArchivedRequestContentBefore(ctx, cutoff)
		if err != nil {
			finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
			return
		}
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, map[string]any{
		"report_id": report.ID, "start": start, "end": end,
		"monthly_report_id": monthlyReportID, "monthly_request_content_deleted": monthlyDeleted,
		"old_request_content_deleted": oldContentDeleted,
	}, nil)
}

// channelTestHandler runs the scheduled "test all channels" job. Enablement and
// cadence still come from the monitor settings; only the execution path moved
// into the system task runner.
type channelTestHandler struct{}

func (channelTestHandler) Type() string { return model.SystemTaskTypeChannelTest }

func (channelTestHandler) Enabled() bool {
	return operation_setting.GetMonitorSetting().AutoTestChannelEnabled
}

func (channelTestHandler) Interval() time.Duration {
	minutes := operation_setting.GetMonitorSetting().AutoTestChannelMinutes
	if minutes <= 0 {
		minutes = 10
	}
	return time.Duration(minutes * float64(time.Minute))
}

func (channelTestHandler) NewPayload() any { return nil }

// channelTestTaskPayload controls one channel_test run. A nil/empty payload is a
// scheduled run, which uses the configured monitor ChannelTestMode and does not
// notify. A manual "test all channels" trigger sets Mode=scheduled_all and
// Notify=true to reproduce the legacy manual behavior (test every channel and
// notify root on completion).
type channelTestTaskPayload struct {
	Mode   string `json:"mode,omitempty"`
	Notify bool   `json:"notify,omitempty"`
}

func (channelTestHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := channelTestTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	summary, err := runChannelTestTask(ctx, payload.Mode, payload.Notify, service.NewSystemTaskProgressReporter(task, runnerID))
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// modelUpdateHandler runs the scheduled upstream model update detection job.
type modelUpdateHandler struct{}

func (modelUpdateHandler) Type() string { return model.SystemTaskTypeModelUpdate }

func (modelUpdateHandler) Enabled() bool {
	return common.GetEnvOrDefaultBool("CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_ENABLED", true)
}

func (modelUpdateHandler) Interval() time.Duration {
	intervalMinutes := common.GetEnvOrDefault(
		"CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_INTERVAL_MINUTES",
		channelUpstreamModelUpdateTaskDefaultIntervalMinutes,
	)
	if intervalMinutes < 1 {
		intervalMinutes = channelUpstreamModelUpdateTaskDefaultIntervalMinutes
	}
	return time.Duration(intervalMinutes) * time.Minute
}

func (modelUpdateHandler) NewPayload() any { return nil }

// modelUpdateTaskPayload controls one model_update run. A scheduled run
// (Manual=false) respects the per-channel minimum check interval and may
// auto-apply detected models when a channel has auto-sync enabled. A manual
// "detect all" trigger sets Manual=true to reproduce the legacy detect-all
// semantics: force a re-check regardless of the interval and never auto-apply,
// so the admin reviews and applies changes explicitly.
type modelUpdateTaskPayload struct {
	Manual bool `json:"manual,omitempty"`
}

func (modelUpdateHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := modelUpdateTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	summary := runChannelUpstreamModelUpdateTaskOnce(ctx, payload.Manual, !payload.Manual, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// midjourneyPollHandler runs one Midjourney polling pass per scheduled run.
// Enabled() folds the "are there unfinished tasks?" check into enablement so the
// scheduler creates no row when the system is idle; only when at least one
// Midjourney task is in progress does a row get scheduled.
type midjourneyPollHandler struct{}

func (midjourneyPollHandler) Type() string { return model.SystemTaskTypeMidjourneyPoll }

func (midjourneyPollHandler) Enabled() bool {
	return constant.UpdateTask && model.HasUnfinishedMidjourneyTasks()
}

func (midjourneyPollHandler) Interval() time.Duration { return 15 * time.Second }

func (midjourneyPollHandler) NewPayload() any { return nil }

func (midjourneyPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := runMidjourneyTaskUpdateOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// asyncTaskPollHandler runs one async-task (Suno/video) polling pass per
// scheduled run. Like midjourneyPollHandler, Enabled() folds in the unfinished
// task existence check so an idle system schedules no rows.
type asyncTaskPollHandler struct{}

func (asyncTaskPollHandler) Type() string { return model.SystemTaskTypeAsyncTaskPoll }

func (asyncTaskPollHandler) Enabled() bool {
	return constant.UpdateTask && model.HasUnfinishedSyncTasks()
}

func (asyncTaskPollHandler) Interval() time.Duration { return 15 * time.Second }

func (asyncTaskPollHandler) NewPayload() any { return nil }

func (asyncTaskPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := service.RunTaskPollingOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func finishSystemTaskHandler(task *model.SystemTask, runnerID string, status model.SystemTaskStatus, result any, runErr error) {
	errorMessage := ""
	if runErr != nil {
		errorMessage = runErr.Error()
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, result, errorMessage); err != nil {
		common.SysLog(fmt.Sprintf("system task %s failed to persist result: %v", task.TaskID, err))
	}
}
