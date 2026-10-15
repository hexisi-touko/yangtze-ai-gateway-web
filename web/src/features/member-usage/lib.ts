import dayjs from 'dayjs'

import type { UsageMember, UsageReport, UsageSummary } from './types'

type RequestArchive = {
  timezone?: string
  members?: Array<{
    user_id: number
    display_name: string
    username: string
    records: number
  }>
}

function formatReportDate(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '无记录'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(timestamp * 1000))
    .replaceAll('/', '-')
}

function formatCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0
}

function formatRate(value: number | undefined): string {
  return `${(Number.isFinite(value) ? Math.max(0, value ?? 0) : 0).toFixed(2)} 次/分钟`
}

function formatPercent(value: number | undefined): string {
  return `${((Number.isFinite(value) ? Math.max(0, value ?? 0) : 0) * 100).toFixed(2)}%`
}

function memberTypeName(value: string | undefined): string {
  const names: Record<string, string> = {
    intern: '实习生',
    full_time: '全职人员',
    other: '其他',
    unspecified: '未分类',
  }
  return names[value ?? ''] || '未分类'
}

export function buildReadableReportExport(
  report: UsageReport,
  summary: UsageSummary | null,
  archive: RequestArchive | null
) {
  const timezone = archive?.timezone || 'Asia/Shanghai'
  const totals = summary?.totals
  const usageByID = new Map(
    (summary?.members ?? []).map((member) => [member.user_id, member])
  )
  const archiveMembers = archive?.members ?? []
  const members = archiveMembers.length
    ? archiveMembers.map((archivedMember) => {
        const usage = usageByID.get(archivedMember.user_id)
        return {
          成员ID: archivedMember.user_id,
          成员名称:
            archivedMember.display_name ||
            archivedMember.username ||
            `成员${archivedMember.user_id}`,
          登录名: archivedMember.username || '未提供',
          成员分类: memberTypeName(usage?.profile.member_type),
          工作项目: usage?.workspace_project || '未记录',
          请求总数: formatCount(
            usage
              ? usage.consume_records + usage.error_records
              : archivedMember.records
          ),
          成功请求数: formatCount(usage?.consume_records),
          失败请求数: formatCount(usage?.error_records),
          总Token数: formatCount(usage?.tokens),
          输入Token数: formatCount(usage?.input_tokens),
          输出Token数: formatCount(usage?.output_tokens),
          缓存读取Token数: formatCount(usage?.cache_read_tokens),
          缓存命中率:
            (usage?.cache_eligible_input ?? 0) > 0
              ? formatPercent(usage?.cache_hit_rate)
              : '暂无缓存统计',
          平均请求频率: formatRate(usage?.average_rpm),
          最后活跃时间: usage
            ? formatReportDate(usage.last_active, timezone)
            : '无记录',
          请求正文: '请查看本报告中的对应成员请求文档；正文按日期整理。',
        }
      })
    : (summary?.members ?? []).map((usage) => ({
        成员ID: usage.user_id,
        成员名称:
          usage.display_name || usage.username || `成员${usage.user_id}`,
        登录名: usage.username || '未提供',
        成员分类: memberTypeName(usage.profile.member_type),
        工作项目: usage.workspace_project || '未记录',
        请求总数: formatCount(usage.consume_records + usage.error_records),
        成功请求数: formatCount(usage.consume_records),
        失败请求数: formatCount(usage.error_records),
        总Token数: formatCount(usage.tokens),
        输入Token数: formatCount(usage.input_tokens),
        输出Token数: formatCount(usage.output_tokens),
        缓存读取Token数: formatCount(usage.cache_read_tokens),
        缓存命中率:
          (usage.cache_eligible_input ?? 0) > 0
            ? formatPercent(usage.cache_hit_rate)
            : '暂无缓存统计',
        平均请求频率: formatRate(usage.average_rpm),
        最后活跃时间: formatReportDate(usage.last_active, timezone),
        请求正文: '本归档未包含成员请求文档。',
      }))

  return {
    报告说明: {
      报告编号: report.id,
      报告名称: report.title,
      统计周期: `${formatReportDate(report.start_time, timezone)} 至 ${formatReportDate(report.end_time - 1, timezone)}`,
      生成时间: formatReportDate(report.created_at, timezone),
      时区: '北京时间',
      管理员备注: report.note || '无',
      口径说明: 'Token 数是模型处理量，不等同于金额；缓存命中率仅在有可统计缓存数据时显示。请求正文请查看对应成员的请求文档。',
    },
    汇总结果: {
      活跃成员数: formatCount(summary?.active_members),
      请求总数: formatCount(
        (totals?.consume_records ?? 0) + (totals?.error_records ?? 0)
      ),
      成功请求数: formatCount(totals?.consume_records),
      失败请求数: formatCount(totals?.error_records),
      总Token数: formatCount(totals?.tokens),
      输入Token数: formatCount(totals?.input_tokens),
      输出Token数: formatCount(totals?.output_tokens),
      缓存读取Token数: formatCount(totals?.cache_read_tokens),
      缓存命中率:
        (totals?.cache_eligible_input ?? 0) > 0
          ? formatPercent(totals?.cache_hit_rate)
          : '暂无缓存统计',
      平均请求频率: formatRate(summary?.average_rpm),
    },
    成员明细: members,
  }
}

export function valueMoney(value: string): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount)
}

export function usageDateRange(
  from: string,
  to: string
): { start: number; end: number } | null {
  const start = dayjs(from).startOf('day')
  const end = dayjs(to).add(1, 'day').startOf('day')
  if (
    !from ||
    !to ||
    !start.isValid() ||
    !end.isValid() ||
    start.format('YYYY-MM-DD') !== from ||
    dayjs(to).format('YYYY-MM-DD') !== to ||
    dayjs(to).isAfter(dayjs(), 'day') ||
    end.diff(start, 'second') <= 0 ||
    end.diff(start, 'second') > 31 * 86400
  ) {
    return null
  }
  return { start: start.unix(), end: end.unix() }
}

export function filterUsageMembers(
  members: UsageMember[],
  search: string,
  memberType: string,
  attentionOnly: boolean
): UsageMember[] {
  const query = search.trim().toLocaleLowerCase()
  return members.filter((member) => {
    if (memberType !== 'all' && member.profile.member_type !== memberType) {
      return false
    }
    if (attentionOnly && member.attention.length === 0) return false
    return [
      member.username,
      member.display_name,
      member.workspace_project,
      member.workspace_branch,
      member.workspace_source,
      // Keep legacy profile fields searchable for records created before the
      // client workspace reporting change. They are not displayed as current
      // attribution and do not drive review signals.
      member.profile.project,
      member.profile.purpose,
    ].some((value) => value.toLocaleLowerCase().includes(query))
  })
}

export function exportUsageJSON(data: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
