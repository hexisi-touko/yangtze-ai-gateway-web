import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AnalysisAssistant } from '../components/analysis-assistant'

vi.mock('@/lib/api', () => ({ api: { request: vi.fn() } }))
const config = {
  base_url: 'https://analysis.example/v1',
  model: 'external-analysis',
  has_key: true,
  version: 1,
}
const draft = {
  id: 1,
  start_time: 100,
  end_time: 200,
  member_id: 0,
  snapshot: '{"members":[]}',
  messages: '[]',
}

function renderAssistant() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AnalysisAssistant range={{ start: 100, end: 200 }} members={[]} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(api.request).mockImplementation(async (request) => {
    if (request.url?.endsWith('/config'))
      {return { data: { success: true, data: config } }}
    if (request.url?.endsWith('/history'))
      {return { data: { success: true, data: [] } }}
    if (request.url?.endsWith('/preview'))
      {return { data: { success: true, data: draft } }}
    if (request.url?.endsWith('/chat'))
      {return {
        data: {
          success: true,
          data: {
            ...draft,
            id: 2,
            messages: JSON.stringify([
              { role: 'user', content: 'Check evidence' },
              { role: 'assistant', content: 'There is insufficient evidence.' },
            ]),
          },
        },
      }}
    throw new Error('Unexpected test request')
  })
})

describe('analysis assistant', () => {
  it('requires reviewed data and consent before sending, then displays the answer', async () => {
    const user = userEvent.setup()
    renderAssistant()
    await screen.findByText('external-analysis')
    const send = screen.getByRole('button', { name: 'Send analysis question' })
    await user.type(screen.getByLabelText('Question for AI'), 'Check evidence')
    expect(send).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Prepare data preview' })
    )
    await screen.findByText('Data to share')
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(send)
    expect(
      await screen.findByText('There is insufficient evidence.')
    ).toBeInTheDocument()
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          parent_id: 1,
          question: 'Check evidence',
          consent: true,
          config_version: 1,
        },
      })
    )
  })

  it('preserves a failed question and does not invent an answer', async () => {
    const original = vi.mocked(api.request).getMockImplementation()
    if (!original) throw new Error('Missing API fixture')
    vi.mocked(api.request).mockImplementation(async (request) => {
      if (request.url?.endsWith('/chat'))
        {throw Object.assign(new Error('Authentication failed'), {
          code: 'member_usage_ai_auth_error',
        })}
      return original(request)
    })
    const user = userEvent.setup()
    renderAssistant()
    await screen.findByText('external-analysis')
    await user.click(
      screen.getByRole('button', { name: 'Prepare data preview' })
    )
    await screen.findByText('Data to share')
    await user.type(screen.getByLabelText('Question for AI'), 'Check evidence')
    await user.click(screen.getByRole('checkbox'))
    await user.click(
      screen.getByRole('button', { name: 'Send analysis question' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'member_usage_ai_auth_error'
    )
    expect(screen.getByLabelText('Question for AI')).toHaveValue(
      'Check evidence'
    )
    expect(
      screen.queryByText('There is insufficient evidence.')
    ).not.toBeInTheDocument()
  })

  it('never returns a saved key to the settings form and resets consent for new analysis', async () => {
    const user = userEvent.setup()
    renderAssistant()
    await screen.findByText('external-analysis')
    await user.click(screen.getByRole('button', { name: 'Analysis service' }))
    expect(screen.getByLabelText('Analysis API key')).toHaveValue('')
    expect(screen.getByLabelText('Analysis API key')).toHaveAttribute(
      'type',
      'password'
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await user.click(
      screen.getByRole('button', { name: 'Prepare data preview' })
    )
    await screen.findByText('Data to share')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'New analysis' }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Send analysis question' })
    ).toBeDisabled()
  })
})
