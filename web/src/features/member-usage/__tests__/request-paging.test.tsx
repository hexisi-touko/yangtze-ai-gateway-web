import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import {
  getMemberRequestContentAlerts,
  getMemberRequestContentsPage,
} from '../api'
import { RequestContents } from '../components/request-contents'

vi.mock('../api', () => ({
  getMemberRequestContentAlerts: vi.fn(),
  getMemberRequestContentsPage: vi.fn(),
}))

it('loads earlier requests past a hidden page and shows the complete normal member text', async () => {
  const text = `Key conclusion: Please explain workspace-write. ${'完整中文正文'.repeat(2000)} 正文结尾`
  vi.mocked(getMemberRequestContentAlerts).mockResolvedValue([])
  vi.mocked(getMemberRequestContentsPage)
    .mockResolvedValueOnce({ items: [], next_cursor: 101, has_more: true })
    .mockResolvedValueOnce({
      items: [
        {
          id: 100,
          user_id: 1,
          username: 'researcher',
          created_at: 1789600000,
          request_id: 'r100',
          path: '/v1/responses',
          model: 'model',
          content: JSON.stringify({ role: 'user', content: text }),
          content_hash: 'hash',
          bytes: 10000,
          truncated: false,
        },
      ],
      next_cursor: 100,
      has_more: false,
    })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RequestContents
        range={{ start: 1789500000, end: 1789700000 }}
        members={[]}
      />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Load earlier requests' })
  )
  await user.click(
    await screen.findByRole('button', { name: 'View request content' })
  )
  expect(await screen.findByText(text)).toBeInTheDocument()
  expect(getMemberRequestContentsPage).toHaveBeenLastCalledWith({
    start: 1789500000,
    end: 1789700000,
    user_id: undefined,
    before_id: 101,
  })
  expect(
    screen.queryByRole('button', { name: 'Load earlier requests' })
  ).not.toBeInTheDocument()
})
