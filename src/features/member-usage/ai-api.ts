import { api } from '@/lib/api'

export type AnalysisConfig = {
  base_url: string
  model: string
  has_key: boolean
  version: number
}
export type AnalysisMessage = { role: 'user' | 'assistant'; content: string }
export type AnalysisRun = {
  id: number
  created_at: number
  start_time: number
  end_time: number
  member_id: number
  model: string
  question: string
  answer: string
  snapshot?: string
  messages?: string
}

async function request<T>(
  method: 'get' | 'post' | 'put',
  path: string,
  data?: unknown
): Promise<T> {
  const res = await api.request<{
    success: boolean
    message?: string
    data: T
  }>({
    method,
    url: `/api/member-usage/ai/${path}`,
    data,
    timeout: 75000,
    skipErrorHandler: true,
  })
  if (!res.data.success)
    {throw Object.assign(new Error('Analysis request failed'), {
      code: res.data.message || 'member_usage_ai_upstream_error',
    })}
  return res.data.data
}
export const getAnalysisConfig = () => request<AnalysisConfig>('get', 'config')
export const saveAnalysisConfig = (data: {
  base_url: string
  model: string
  api_key: string
  clear_key?: boolean
}) => request<AnalysisConfig>('put', 'config', data)
export const testAnalysis = () =>
  request<{ connected: boolean }>('post', 'test')
export const previewAnalysis = (data: {
  start: number
  end: number
  member_id: number
}) => request<AnalysisRun>('post', 'preview', data)
export const chatAnalysis = (data: {
  parent_id: number
  question: string
  consent: boolean
  config_version: number
}) => request<AnalysisRun>('post', 'chat', data)
export const listAnalysis = () => request<AnalysisRun[]>('get', 'history')
export const getAnalysis = (id: number) =>
  request<AnalysisRun>('get', `history/${id}`)
