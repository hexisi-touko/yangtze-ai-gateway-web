import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { downloadMemberDocument, getUsageReport, getUsageReports } from '../api'
import { Reports } from '../components/reports'
import type { UsageReport } from '../types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getUsageReports: vi.fn(),
  getUsageReport: vi.fn(),
  downloadMemberDocument: vi.fn(),
  rebuildRequestArchive: vi.fn(),
}))

function fixture(archive: boolean): UsageReport {
  return {
    id: 7,
    title: '九月归档',
    note: '月度记录',
    start_time: 1788192000,
    end_time: 1790784000,
    created_at: 1790784001,
    created_by: 1,
    snapshot: JSON.stringify({ members: [] }),
    request_archive: archive
      ? JSON.stringify({
          version: 1,
          start: 1788192000,
          end: 1790784000,
          timezone: 'Asia/Shanghai',
          rebuilt: false,
          members: [
            {
              user_id: 12,
              display_name: '成员甲显示名',
              username: '成员甲',
              records: 23,
              source_records: 23,
            },
          ],
        })
      : '',
  }
}

it('exports the selected monthly member rather than the whole statistics JSON', async () => {
  const report = fixture(true)
  vi.mocked(getUsageReports).mockResolvedValue([report])
  vi.mocked(getUsageReport).mockResolvedValue(report)
  vi.mocked(downloadMemberDocument).mockResolvedValue()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Reports />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'View' }))
  expect(await screen.findByText('成员甲显示名')).toBeInTheDocument()
  expect(screen.getByText(/#12 · 成员甲 · 23/)).toBeInTheDocument()
  await user.click(
    await screen.findByRole('button', { name: 'Export member document' })
  )
  expect(downloadMemberDocument).toHaveBeenCalledWith(7, 12)
  expect(
    screen.queryByRole('button', { name: 'Rebuild request documents' })
  ).not.toBeInTheDocument()
})

it('explains missing legacy content and offers an explicit rebuild', async () => {
  const report = fixture(false)
  vi.mocked(getUsageReports).mockResolvedValue([report])
  vi.mocked(getUsageReport).mockResolvedValue(report)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Reports />
    </QueryClientProvider>
  )
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'View' }))
  expect(
    await screen.findByRole('button', { name: 'Rebuild request documents' })
  ).toBeEnabled()
  expect(
    screen.getByText(/This older report contains statistics only/)
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Export member document' })
  ).not.toBeInTheDocument()
})
