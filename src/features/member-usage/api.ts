import { api } from '@/lib/api'

import type {
  UsageProfile,
  UsageReport,
  UsageSummary,
  WorkSession,
} from './types'

export async function getWorkSessions(): Promise<{
  items: WorkSession[]
  generated_at: number
  stale_after_seconds: number
}> {
  const res = await api.get('/api/member-usage/work-sessions')
  return unwrap(res.data)
}

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

export async function getUsageSummary(
  start: number,
  end: number
): Promise<UsageSummary> {
  const res = await api.get('/api/member-usage/summary', {
    params: { start, end },
  })
  return unwrap(res.data)
}
export async function saveUsageProfile(
  profile: UsageProfile
): Promise<UsageProfile> {
  const res = await api.put(`/api/member-usage/profiles/${profile.user_id}`, {
    member_type: profile.member_type,
    project: profile.project,
    purpose: profile.purpose,
  })
  return unwrap(res.data)
}
export async function getUsageReports(): Promise<UsageReport[]> {
  const res = await api.get('/api/member-usage/reports')
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
