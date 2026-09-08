export type MemberType = 'unspecified' | 'intern' | 'full_time'
export interface WorkSession {
  user_id: number
  session_id: string
  username: string
  display_name: string
  member_type: string
  project: string
  branch: string
  source: 'git' | 'directory'
  purpose: string
  started_at: number
  last_seen_at: number
  ended_at: number
}
export interface UsageProfile {
  user_id: number
  member_type: MemberType
  project: string
  purpose: string
  updated_at: number
  updated_by: number
}
export interface UsageMetrics {
  consume_records: number
  error_records: number
  refund_records: number
  tokens: number
  charged_quota: number
  refund_quota: number
}
export interface UsageMember extends UsageMetrics {
  user_id: number
  username: string
  display_name: string
  profile: UsageProfile
  peak_minute_records: number
  average_rpm?: number
  tokens_per_hour?: number
  error_rate?: number
  last_active: number
  models: string[]
  attention: string[]
  deleted: boolean
}
export interface UsageSummary {
  version: number
  start_time: number
  end_time: number
  generated_at: number
  active_members: number
  attention_members: number
  totals: UsageMetrics
  members: UsageMember[]
}
export interface UsageReport {
  id: number
  title: string
  note: string
  start_time: number
  end_time: number
  created_at: number
  created_by: number
  snapshot?: string
  value_snapshot?: string
}
