import { api } from '@/lib/api'

export type ReferencePrice = {
  id: number
  model: string
  channel_id: number
  effective_at: number
  input: string
  output: string
  cache_read: string
  cache_write: string
  cache_write_1h: string
  source: string
}
export type UsageCost = {
  id: number
  category: string
  amount: string
  incurred_at: number
  note: string
}
export type ValueRow = {
  user_id: number
  username: string
  model: string
  channel_id: number
  records: number
  priced: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  reference_value: string
  pending: Record<string, number>
  price_ids: number[]
}
export type ValueSummary = {
  start: number
  end: number
  generated_at: number
  currency: string
  records: number
  priced: number
  raw_tokens: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  normalized_records: number
  estimated_records: number
  unknown_source_records: number
  reference_value: string
  recorded_cost: string
  rows: ValueRow[]
  costs: UsageCost[]
  prices: ReferencePrice[]
}
async function request<T>(
  method: 'get' | 'post' | 'delete',
  path: string,
  data?: unknown,
  params?: unknown
): Promise<T> {
  const res = await api.request<{
    success: boolean
    data: T
    message?: string
  }>({
    method,
    url: `/api/member-usage/value${path}`,
    data,
    params,
    skipErrorHandler: true,
  })
  if (!res.data.success) {
    throw Object.assign(new Error('Value accounting failed'), {
      code: res.data.message,
    })
  }
  return res.data.data
}
export const getUsageValue = (range: { start: number; end: number }) =>
  request<ValueSummary>('get', '', undefined, range)
export const addReferencePrice = (price: Omit<ReferencePrice, 'id'>) =>
  request<ReferencePrice>('post', '/prices', price)
export const addUsageCost = (cost: Omit<UsageCost, 'id'>) =>
  request<UsageCost>('post', '/costs', cost)
export const deleteUsageCost = (id: number) =>
  request<null>('delete', `/costs/${id}`)
