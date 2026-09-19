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
  official_input_usd?: string
  official_output_usd?: string
  official_cache_read_usd?: string
  official_cache_write_usd?: string
  source_url?: string
  synced_at?: number
  official_exchange_rate?: string
  official?: boolean
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
  cache_eligible_input: number
  cache_hit_rate: number
  upstream_usage_records: number
  upstream_tokens: number
  local_estimated_tokens: number
  internal_quota_used: number
  quota_equivalent_usd: string
  quota_equivalent_cny: string
  cache_savings_value: string
  normalized_records: number
  estimated_records: number
  unknown_source_records: number
  reference_value: string
  recorded_cost: string
  actual_total_cost: string
  upstream_cost: string
  actual_procurement_cost: string
  operating_cost: string
  savings_value: string
  value_multiplier: string
  savings_comparable: boolean
  rows: ValueRow[]
  costs: UsageCost[]
  prices: ReferencePrice[]
}

function normalizeReferencePrice(
  value: Partial<ReferencePrice>
): ReferencePrice {
  const number = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : 0
  const string = (input: unknown) => (typeof input === 'string' ? input : '')
  const optionalString = (input: unknown) =>
    typeof input === 'string' ? input : undefined
  const source = string(value.source)
  const sourceURL = optionalString(value.source_url)
  const officialSource = `${sourceURL || ''} ${source}`.toLowerCase()
  const official =
    value.official === true ||
    officialSource.includes('developers.openai.com') ||
    officialSource.includes('platform.openai.com') ||
    officialSource.includes('openai official')
  return {
    id: number(value.id),
    model: string(value.model),
    channel_id: number(value.channel_id),
    effective_at: number(value.effective_at),
    input: string(value.input),
    output: string(value.output),
    cache_read: string(value.cache_read),
    cache_write: string(value.cache_write),
    cache_write_1h: string(value.cache_write_1h),
    official_input_usd: optionalString(value.official_input_usd),
    official_output_usd: optionalString(value.official_output_usd),
    official_cache_read_usd: optionalString(value.official_cache_read_usd),
    official_cache_write_usd: optionalString(value.official_cache_write_usd),
    source_url: sourceURL,
    synced_at: number(value.synced_at) || undefined,
    official_exchange_rate: optionalString(value.official_exchange_rate),
    official,
    source,
  }
}

// Keep the page readable while an administrator is rolling out a new backend.
// Older local binaries do not return the recently added accounting fields;
// normalizing at the API boundary prevents an absent optional field from
// becoming a render-time `undefined.toLocaleString()` error.
export function normalizeUsageValueSummary(
  value: Partial<ValueSummary>
): ValueSummary {
  const number = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : 0
  const string = (input: unknown) => (typeof input === 'string' ? input : '0')
  const nonNegativeMoney = (input: unknown) => {
    const normalized = string(input)
    const amount = Number(normalized)
    return Number.isFinite(amount) ? Math.max(0, amount).toString() : '0'
  }
  const rows = Array.isArray(value.rows)
    ? value.rows.map((row) => ({
        ...row,
        records: number(row.records),
        priced: number(row.priced),
        input: number(row.input),
        output: number(row.output),
        cache_read: number(row.cache_read),
        cache_write: number(row.cache_write),
        reference_value: string(row.reference_value),
        pending: row.pending ?? {},
        price_ids: Array.isArray(row.price_ids) ? row.price_ids : [],
      }))
    : []
  return {
    start: number(value.start),
    end: number(value.end),
    generated_at: number(value.generated_at),
    currency: value.currency || 'CNY',
    records: number(value.records),
    priced: number(value.priced),
    raw_tokens: number(value.raw_tokens),
    input: number(value.input),
    output: number(value.output),
    cache_read: number(value.cache_read),
    cache_write: number(value.cache_write),
    cache_eligible_input: number(value.cache_eligible_input),
    cache_hit_rate: number(value.cache_hit_rate),
    upstream_usage_records: number(value.upstream_usage_records),
    upstream_tokens: number(value.upstream_tokens),
    local_estimated_tokens: number(value.local_estimated_tokens),
    internal_quota_used: number(value.internal_quota_used),
    quota_equivalent_usd: string(value.quota_equivalent_usd),
    quota_equivalent_cny: string(value.quota_equivalent_cny),
    cache_savings_value: string(value.cache_savings_value),
    normalized_records: number(value.normalized_records),
    estimated_records: number(value.estimated_records),
    unknown_source_records: number(value.unknown_source_records),
    reference_value: string(value.reference_value),
    recorded_cost: string(value.recorded_cost),
    actual_total_cost: string(value.actual_total_cost ?? value.recorded_cost),
    upstream_cost: string(value.upstream_cost),
    actual_procurement_cost: string(
      value.actual_procurement_cost ?? value.upstream_cost
    ),
    operating_cost: string(value.operating_cost),
    // Older archived snapshots were calculated as reference minus all costs
    // and could contain a negative "saving". The current report definition
    // treats that case as zero; normalize at the API boundary too so every
    // consumer (including exported historical views) sees the same result.
    savings_value: nonNegativeMoney(value.savings_value),
    value_multiplier: string(value.value_multiplier),
    savings_comparable: value.savings_comparable === true,
    rows,
    costs: Array.isArray(value.costs) ? value.costs : [],
    // Older GoLand builds did not include the `official` flag. Infer it from
    // the persisted source metadata so a successful sync is still rendered.
    prices: Array.isArray(value.prices)
      ? value.prices.map((price) => normalizeReferencePrice(price))
      : [],
  }
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
export const getUsageValue = async (range: { start: number; end: number }) =>
  normalizeUsageValueSummary(
    await request<Partial<ValueSummary>>('get', '', undefined, range)
  )
export const addReferencePrice = (price: Omit<ReferencePrice, 'id'>) =>
  request<ReferencePrice>('post', '/prices', price)
export type OfficialPriceSyncResult = {
  source_url: string
  synced_at: number
  exchange_rate: string
  created: number
  models: ReferencePrice[]
}
export const syncOfficialPrices = (exchange_rate: string) =>
  request<OfficialPriceSyncResult>('post', '/prices/sync', { exchange_rate })
export const addUsageCost = (cost: Omit<UsageCost, 'id'>) =>
  request<UsageCost>('post', '/costs', cost)
export const deleteUsageCost = (id: number) =>
  request<null>('delete', `/costs/${id}`)
