export type MemberType = 'unspecified' | 'intern' | 'full_time' | 'other'
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
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_eligible_input?: number
  cache_hit_rate?: number
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
  active_average_rpm?: number
  active_minutes?: number
  tokens_per_hour?: number
  error_rate?: number
  last_active: number
  models: string[]
  recent_ips?: string[]
  attention: string[]
  deleted: boolean
  quota: number
  used_quota: number
  request_count: number
  assigned_quota: number
  remaining_quota: number
  quota_utilization: number
  workspace_project: string
  workspace_branch: string
  workspace_source: string
  workspace_last_seen: number
}
export interface UsageSummary {
  version: number
  start_time: number
  end_time: number
  generated_at: number
  active_members: number
  attention_members: number
  active_minutes?: number
  average_rpm?: number
  active_average_rpm?: number
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

export interface MemberRequestContent {
  id: number
  user_id: number
  username: string
  request_id: string
  created_at: number
  path: string
  model: string
  content: string
  content_hash: string
  bytes: number
  truncated: boolean
}

export interface MemberRequestContentAlert {
  user_id: number
  username: string
  model: string
  content_hash: string
  repeat_count: number
  first_seen_at: number
  last_seen_at: number
}
