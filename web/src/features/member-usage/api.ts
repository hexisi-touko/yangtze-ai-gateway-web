import { api } from '@/lib/api'

import type {
  MemberRequestContentAlert,
  MemberRequestContent,
  UsageProfile,
  UsageReport,
  UsageMember,
  UsageSummary,
} from './types'

function unwrap<T>(response: {
  success: boolean
  message?: string
  data: T
}): T {
  if (!response.success) {
    throw new Error(response.message || 'member_usage_unavailable')
  }
  return response.data
}

// The page can briefly talk to an older GoLand binary while the backend is
// being rebuilt. Normalize that response at the boundary so a missing array
// or profile object cannot crash the route during a hot reload.
export function normalizeUsageSummary(
  value: Partial<UsageSummary>
): UsageSummary {
  const number = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : 0
  const members = Array.isArray(value.members)
    ? value.members.map((member) => {
        const raw = member as UsageMember & {
          member_type?: string
          project?: string
          purpose?: string
        }
        const profile = raw.profile ?? ({} as UsageMember['profile'])
        const remainingQuota =
          raw.remaining_quota === undefined
            ? number(raw.quota)
            : number(raw.remaining_quota)
        const assignedQuota =
          raw.assigned_quota === undefined
            ? number(raw.quota) + number(raw.used_quota)
            : number(raw.assigned_quota)
        let quotaUtilization = number(raw.quota_utilization)
        if (raw.quota_utilization === undefined && assignedQuota > 0) {
          quotaUtilization = number(raw.used_quota) / assignedQuota
        }
        return {
          ...raw,
          user_id: number(raw.user_id),
          username: raw.username || '',
          display_name: raw.display_name || '',
          profile: {
            ...profile,
            user_id: number(profile.user_id || raw.user_id),
            member_type:
              profile.member_type || raw.member_type || 'unspecified',
            project: profile.project || raw.project || '',
            purpose: profile.purpose || raw.purpose || '',
            updated_at: number(profile.updated_at),
            updated_by: number(profile.updated_by),
          },
          consume_records: number(raw.consume_records),
          error_records: number(raw.error_records),
          refund_records: number(raw.refund_records),
          tokens: number(raw.tokens),
          input_tokens: number(raw.input_tokens),
          output_tokens: number(raw.output_tokens),
          cache_read_tokens: number(raw.cache_read_tokens),
          cache_eligible_input: number(raw.cache_eligible_input),
          cache_hit_rate: number(raw.cache_hit_rate),
          charged_quota: number(raw.charged_quota),
          refund_quota: number(raw.refund_quota),
          peak_minute_records: number(raw.peak_minute_records),
          average_rpm: number(raw.average_rpm),
          active_average_rpm: number(raw.active_average_rpm),
          active_minutes: number(raw.active_minutes),
          tokens_per_hour: number(raw.tokens_per_hour),
          error_rate: number(raw.error_rate),
          last_active: number(raw.last_active),
          models: Array.isArray(raw.models) ? raw.models : [],
          recent_ips: Array.isArray(raw.recent_ips) ? raw.recent_ips : [],
          attention: Array.isArray(raw.attention) ? raw.attention : [],
          deleted: raw.deleted === true,
          quota: number(raw.quota),
          used_quota: number(raw.used_quota),
          request_count: number(raw.request_count),
          assigned_quota: assignedQuota,
          remaining_quota: remainingQuota,
          quota_utilization: quotaUtilization,
          workspace_project: raw.workspace_project || '',
          workspace_branch: raw.workspace_branch || '',
          workspace_source: raw.workspace_source || '',
          workspace_last_seen: number(raw.workspace_last_seen),
        }
      })
    : []
  const totals = value.totals ?? ({} as UsageSummary['totals'])
  return {
    version: number(value.version),
    start_time: number(value.start_time),
    end_time: number(value.end_time),
    generated_at: number(value.generated_at),
    active_members: number(value.active_members),
    attention_members: number(value.attention_members),
    active_minutes: number(value.active_minutes),
    average_rpm: number(value.average_rpm),
    active_average_rpm: number(value.active_average_rpm),
    totals: {
      consume_records: number(totals.consume_records),
      error_records: number(totals.error_records),
      refund_records: number(totals.refund_records),
      tokens: number(totals.tokens),
      input_tokens: number(totals.input_tokens),
      output_tokens: number(totals.output_tokens),
      cache_read_tokens: number(totals.cache_read_tokens),
      cache_eligible_input: number(totals.cache_eligible_input),
      cache_hit_rate: number(totals.cache_hit_rate),
      charged_quota: number(totals.charged_quota),
      refund_quota: number(totals.refund_quota),
    },
    members,
  }
}

export async function getUsageSummary(
  start: number,
  end: number
): Promise<UsageSummary> {
  const res = await api.get('/api/member-usage/summary', {
    params: { start, end },
  })
  return normalizeUsageSummary(unwrap<Partial<UsageSummary>>(res.data))
}
export async function saveUsageProfile(
  profile: Pick<UsageProfile, 'user_id' | 'member_type'>
): Promise<UsageProfile> {
  const res = await api.put(`/api/member-usage/profiles/${profile.user_id}`, {
    member_type: profile.member_type,
  })
  return unwrap(res.data)
}
export async function getUsageProfile(userId: number): Promise<UsageProfile> {
  const res = await api.get(`/api/member-usage/profiles/${userId}`)
  return unwrap(res.data)
}
export async function getUsageReports(): Promise<UsageReport[]> {
  const res = await api.get('/api/member-usage/reports')
  return unwrap(res.data)
}
export async function getMemberRequestContents(input: {
  user_id?: number
  start?: number
  end?: number
  limit?: number
}): Promise<MemberRequestContent[]> {
  const res = await api.get('/api/member-usage/request-contents', {
    params: input,
  })
  return unwrap(res.data)
}
export async function getMemberRequestContentAlerts(input: {
  user_id?: number
  start: number
  end: number
  limit?: number
}): Promise<MemberRequestContentAlert[]> {
  const res = await api.get('/api/member-usage/request-content-alerts', {
    params: input,
  })
  return unwrap(res.data)
}
export async function getUsageReport(id: number): Promise<UsageReport> {
  const res = await api.get(`/api/member-usage/reports/${id}`)
  return unwrap(res.data)
}
export async function archiveUsageReport(input: {
  title: string
  note: string
  start_time: number
  end_time: number
}): Promise<UsageReport> {
  const res = await api.post('/api/member-usage/reports', input)
  return unwrap(res.data)
}
