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
  normalized_records: 1,
  estimated_records: 0,
  unknown_source_records: 1,
  reference_value: '0',
  recorded_cost: '0',
  rows: [],
  prices: [],
  costs: [],
}

describe('non-profit value accounting', () => {
  it('does not present missing prices or unregistered costs as free service', () => {
    render(<ValueOverview data={data} />)
    expect(screen.getByText('Not calculated')).toBeInTheDocument()
    expect(screen.getByText('No costs registered')).toBeInTheDocument()
    expect(screen.queryByText('Profit')).not.toBeInTheDocument()
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
  })
  it('shows an explicitly priced zero as zero rather than missing data', () => {
    render(<ValueOverview data={{ ...data, priced: 1 }} />)
    expect(screen.queryByText('Not calculated')).not.toBeInTheDocument()
    expect(screen.getByText(/0\.00/)).toBeInTheDocument()
  })
  it('rejects negative reference prices without saving and accepts valid versioned prices', async () => {
    vi.mocked(api.request).mockImplementation(async (request) => ({
      data: {
        success: true,
        data: request.method === 'get' ? data : { id: 1 },
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
      screen.getByRole('button', { name: 'Add reference price version' })
    )
    await user.type(screen.getByLabelText('Model ID'), 'model-a')
    await user.type(screen.getByLabelText('Input CNY per million'), '-2')
    await user.type(screen.getByLabelText('Output CNY per million'), '8')
    await user.type(
      screen.getByLabelText('Price source and exchange-rate basis'),
      'Reviewed public price'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'member_usage_value_invalid_price'
    )
    expect(
      vi.mocked(api.request).mock.calls.some(([r]) => r.method === 'post')
    ).toBe(false)
    await user.clear(screen.getByLabelText('Input CNY per million'))
    await user.type(screen.getByLabelText('Input CNY per million'), '2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        data: expect.objectContaining({
          input: '2',
          output: '8',
          channel_id: 0,
        }),
      })
    )
  })
})
