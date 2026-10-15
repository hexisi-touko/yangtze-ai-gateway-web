import { expect, it } from 'vitest'

import { buildReadableReportExport } from '../lib'
import type { UsageReport, UsageSummary } from '../types'

const report: UsageReport = {
  id: 15,
  title: '成员使用月报 2026-09',
  note: '月度核验',
  start_time: 1788192000,
  end_time: 1790784000,
  created_at: 1790784001,
  created_by: 1,
}

const summary: UsageSummary = {
  version: 1,
  start_time: report.start_time,
  end_time: report.end_time,
  generated_at: report.created_at,
  active_members: 1,
  attention_members: 0,
  average_rpm: 0.125,
  totals: {
    consume_records: 3,
    error_records: 1,
    refund_records: 0,
    tokens: 161000,
    input_tokens: 157877,
    output_tokens: 3123,
    cache_read_tokens: 94208,
    cache_eligible_input: 102300,
    cache_hit_rate: 0.9212,
    charged_quota: 0,
    refund_quota: 0,
  },
  members: [
    {
      user_id: 12,
      username: 'member-a',
      display_name: '成员甲',
      profile: {
        user_id: 12,
        member_type: 'intern',
        project: '',
        purpose: '',
        updated_at: 0,
        updated_by: 0,
      },
      consume_records: 3,
      error_records: 1,
      refund_records: 0,
      tokens: 161000,
      input_tokens: 157877,
      output_tokens: 3123,
      cache_read_tokens: 94208,
      cache_eligible_input: 102300,
      cache_hit_rate: 0.9212,
      charged_quota: 0,
      refund_quota: 0,
      peak_minute_records: 1,
      average_rpm: 0.125,
      last_active: 1790783900,
      models: [],
      attention: [],
      deleted: false,
      quota: 0,
      used_quota: 0,
      request_count: 4,
      assigned_quota: 0,
      remaining_quota: 0,
      quota_utilization: 0,
      workspace_project: '测试项目',
      workspace_branch: '',
      workspace_source: '',
      workspace_last_seen: 0,
    },
  ],
}

it('exports a readable Chinese report without raw internal fields or timestamps', () => {
  const result = buildReadableReportExport(summaryReport(), summary, {
    timezone: 'Asia/Shanghai',
    members: [
      {
        user_id: 12,
        display_name: '成员甲',
        username: 'member-a',
        records: 4,
      },
    ],
  })
  const text = JSON.stringify(result)

  expect(result.报告说明.统计周期).toContain('2026-09-01')
  expect(result.汇总结果.缓存命中率).toBe('92.12%')
  expect(result.汇总结果.平均请求频率).toBe('0.13 次/分钟')
  expect(result.成员明细[0]).toMatchObject({
    成员ID: 12,
    成员名称: '成员甲',
    登录名: 'member-a',
    成员分类: '实习生',
    工作项目: '测试项目',
    请求总数: 4,
  })
  expect(text).not.toContain('usage_summary')
  expect(text).not.toContain('start_time')
  expect(text).not.toContain('generated_at')
  expect(text).not.toContain('quota_utilization')
})

function summaryReport(): UsageReport {
  return report
}
