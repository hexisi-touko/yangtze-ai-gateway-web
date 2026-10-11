import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { UsageValue } from '../components/usage-value'
import { ValueOverview } from '../components/value-overview'
import type { ValueSummary } from '../value-api'

vi.mock('@/lib/api', () => ({ api: { request: vi.fn() } }))
const data: ValueSummary = {
  start: 100,
  end: 200,
  generated_at: 200,
  currency: 'CNY',
  records: 1,
  priced: 0,
  raw_tokens: 100,
  input: 100,
  output: 0,
  cache_read: 0,
  cache_write: 0,
  cache_eligible_input: 100,
  cache_hit_rate: 0,
  upstream_usage_records: 1,
  upstream_tokens: 100,
  local_estimated_tokens: 0,
  internal_quota_used: 0,
  quota_equivalent_usd: '0',
  quota_equivalent_cny: '0',
  cache_savings_value: '0',
  normalized_records: 1,
  estimated_records: 0,
  unknown_source_records: 1,
  reference_value: '0',
  recorded_cost: '0',
  actual_total_cost: '0',
  upstream_cost: '0',
  actual_procurement_cost: '0',
  operating_cost: '0',
  savings_value: '0',
  value_multiplier: '0',
  savings_comparable: false,
  rows: [],
  prices: [],
  costs: [],
}

describe('non-profit value accounting', () => {
  it('does not present missing prices or unregistered costs as free service', () => {
    render(<ValueOverview data={data} />)
    expect(screen.getAllByText('Not calculated').length).toBeGreaterThan(0)
    expect(screen.queryByText('Profit')).not.toBeInTheDocument()
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
  })
  it('explains why the official reference value is pending', () => {
    render(
      <ValueOverview
        data={{
          ...data,
          rows: [
            {
              user_id: 1,
              username: 'researcher',
              model: 'gpt-5.6-luna',
              channel_id: 1,
              records: 1,
              priced: 0,
              input: 100,
              output: 0,
              cache_read: 0,
              cache_write: 0,
              reference_value: '0',
              pending: { missing_price: 1 },
              price_ids: [],
            },
          ],
        }}
      />
    )
    expect(
      screen.getByText('value_pending_price_explanation')
    ).toBeInTheDocument()
  })

  it('shows the priced reference value when only some records are pending', () => {
    render(
      <ValueOverview
        data={{
          ...data,
          records: 3,
          priced: 2,
          reference_value: '10',
          rows: [
            {
              user_id: 1,
              username: 'researcher',
              model: 'gpt-5.6-luna',
              channel_id: 1,
              records: 3,
              priced: 2,
              input: 100,
              output: 0,
              cache_read: 0,
              cache_write: 0,
              reference_value: '10',
              pending: { missing_usage: 1 },
              price_ids: [1],
            },
          ],
        }}
      />
    )
    expect(screen.getByText('¥10.00')).toBeInTheDocument()
    expect(screen.queryByText('Not calculated')).not.toBeInTheDocument()
  })
  it('does not label missing usage data as a missing official price', () => {
    render(
      <ValueOverview
        data={{
          ...data,
          rows: [
            {
              user_id: 1,
              username: 'researcher',
              model: 'gpt-5.6-luna',
              channel_id: 1,
              records: 1,
              priced: 0,
              input: 0,
              output: 0,
              cache_read: 0,
              cache_write: 0,
              reference_value: '0',
              pending: { missing_usage: 1 },
              price_ids: [],
            },
          ],
        }}
      />
    )
    expect(
      screen.queryByText('value_pending_price_explanation')
    ).not.toBeInTheDocument()
  })
  it('clamps a historical negative saving to zero in the administrator view', () => {
    render(
      <ValueOverview
        data={{
          ...data,
          priced: 1,
          reference_value: '0.000841',
          actual_procurement_cost: '100',
          savings_value: '-99.999159',
          value_multiplier: '0.00000841',
          savings_comparable: true,
        }}
      />
    )
    expect(screen.queryByText(/-¥/)).not.toBeInTheDocument()
    expect(screen.getByText('¥0.00')).toBeInTheDocument()
  })
  it('shows an explicitly priced zero as zero rather than missing data', () => {
    render(<ValueOverview data={{ ...data, priced: 1 }} />)
    expect(screen.getAllByText(/0\.00/).length).toBeGreaterThan(0)
  })
  it('syncs official prices using an exchange rate instead of manual model rates', async () => {
    const syncedPrice = {
      id: 42,
      model: 'gpt-5.1',
      channel_id: 0,
      effective_at: 300,
      input: '10.8',
      output: '86.4',
      cache_read: '5.4',
      cache_write: '',
      cache_write_1h: '',
      official_input_usd: '1.5',
      official_output_usd: '12',
      official_cache_read_usd: '0.75',
      source_url: 'https://developers.openai.com/api/docs/pricing',
      synced_at: 300,
      official_exchange_rate: '7.2',
      official: true,
      source: 'OpenAI official pricing',
    }
    vi.mocked(api.request).mockImplementation(async (request) => ({
      data: {
        success: true,
        data:
          request.method === 'get'
            ? data
            : {
                source_url: syncedPrice.source_url,
                synced_at: syncedPrice.synced_at,
                exchange_rate: syncedPrice.official_exchange_rate,
                created: 1,
                models: [syncedPrice],
              },
      },
    }))
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={client}>
        <UsageValue range={{ start: 100, end: 200 }} />
      </QueryClientProvider>
    )
    await user.click(
      screen.getByRole('button', { name: 'Sync official OpenAI prices' })
    )
    await user.clear(screen.getByLabelText('USD/CNY exchange rate'))
    await user.type(screen.getByLabelText('USD/CNY exchange rate'), '7.2')
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: '/api/member-usage/value/prices/sync',
        data: { exchange_rate: '7.2' },
      })
    )
    expect(await screen.findByText('gpt-5.1')).toBeInTheDocument()
    expect(screen.getByText(/Official price snapshot/)).toBeInTheDocument()
  })
  it('keeps the returned official snapshot visible when the refresh is temporarily unavailable', async () => {
    const syncedPrice = {
      id: 43,
      model: 'gpt-5.2',
      channel_id: 0,
      effective_at: 300,
      input: '7.2',
      output: '57.6',
      cache_read: '3.6',
      cache_write: '',
      cache_write_1h: '',
      official_input_usd: '1',
      official_output_usd: '8',
      official_cache_read_usd: '0.5',
      source_url: 'https://developers.openai.com/api/docs/pricing',
      synced_at: 300,
      official_exchange_rate: '7.2',
      official: true,
      source: 'OpenAI official pricing',
    }
    let reads = 0
    vi.mocked(api.request).mockImplementation(async (request) => {
      if (request.method === 'get') {
        reads += 1
        if (reads > 1) throw new Error('refresh temporarily unavailable')
        return { data: { success: true, data } }
      }
      return {
        data: {
          success: true,
          data: {
            source_url: syncedPrice.source_url,
            synced_at: syncedPrice.synced_at,
            exchange_rate: syncedPrice.official_exchange_rate,
            created: 1,
            models: [syncedPrice],
          },
        },
      }
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <UsageValue range={{ start: 100, end: 200 }} />
      </QueryClientProvider>
    )
    await user.click(
      screen.getByRole('button', { name: 'Sync official OpenAI prices' })
    )
    await user.click(screen.getByRole('button', { name: 'Sync' }))

    expect(await screen.findByText('gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText(/Official price snapshot/)).toBeInTheDocument()
    expect(screen.getByText(/Models synced/)).toBeInTheDocument()
  })
  it('shows the official sync failure category instead of member-analysis copy', async () => {
    vi.mocked(api.request).mockImplementation(async (request) => {
      if (request.method === 'get') {
        return { data: { success: true, data } }
      }
      throw Object.assign(new Error('sync failed'), {
        response: {
          data: {
            success: false,
            code: 'member_usage_value_official_sync_http_error',
          },
        },
      })
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <UsageValue range={{ start: 100, end: 200 }} />
      </QueryClientProvider>
    )
    await user.click(
      screen.getByRole('button', { name: 'Sync official OpenAI prices' })
    )
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    expect(
      await screen.findByText('member_usage_value_official_sync_http_error')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('member_usage_unavailable')
    ).not.toBeInTheDocument()
  })
})
