import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { getWorkSessions } from '../api'
import { WorkSessions } from '../components/work-sessions'

vi.mock('../api', () => ({ getWorkSessions: vi.fn() }))

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WorkSessions />
    </QueryClientProvider>
  )
}

it('shows reporting freshness separately from use and supports project search', async () => {
  const base = {
    user_id: 1,
    username: 'researcher',
    display_name: '',
    member_type: 'intern',
    project: 'oilfield',
    source: 'git' as const,
    branch: 'main',
    purpose: 'research',
    started_at: 900,
    ended_at: 0,
  }
  vi.mocked(getWorkSessions).mockResolvedValue({
    generated_at: 1200,
    stale_after_seconds: 180,
    items: [
      { ...base, session_id: 'a', last_seen_at: 1190 },
      { ...base, session_id: 'b', project: 'old-project', last_seen_at: 950 },
      {
        ...base,
        session_id: 'c',
        project: 'done-project',
        last_seen_at: 1180,
        ended_at: 1180,
      },
    ],
  })
  mount()
  expect(await screen.findByText('Recently reported')).toBeInTheDocument()
  expect(screen.getByText('Reporting interrupted')).toBeInTheDocument()
  expect(screen.getByText('Reporting stopped')).toBeInTheDocument()
  expect(screen.queryByText('Tokens')).not.toBeInTheDocument()
  await userEvent.setup().type(screen.getByRole('textbox'), 'oilfield')
  expect(screen.queryByText('old-project')).not.toBeInTheDocument()
})

it('distinguishes server error from empty data and retries', async () => {
  vi.mocked(getWorkSessions)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      generated_at: 1200,
      stale_after_seconds: 180,
      items: [],
    })
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Client project reports unavailable'
  )
  expect(
    screen.queryByText('No client project reports')
  ).not.toBeInTheDocument()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Refresh client projects' }))
  expect(
    await screen.findByText('No client project reports')
  ).toBeInTheDocument()
})
