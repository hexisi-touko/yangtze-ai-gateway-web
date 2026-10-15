import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AdminUpdates } from '../index'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

it('shows the current business version and lets maintainers expand the baseline', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        current_version: '1.0.1',
        scope: '管理员业务版本',
        revision: 'local-development',
        build_time: 'not-recorded',
        versions: [
          {
            version: '1.0.1',
            title: '正文修复',
            status: '本地验证',
            date: '2026-10-11',
            tag: 'admin-v1.0.1',
            summary: '第二版',
            changes: ['完整请求正文'],
            technical: ['数据库迁移'],
            limitations: ['旧内容无法补回'],
          },
          {
            version: '1.0.0',
            title: '初始版本',
            status: '已留档',
            date: '2026-10-11',
            tag: 'admin-v1.0.0',
            summary: '同学补丁基线',
            changes: ['原有业务'],
            technical: ['补丁来源'],
            limitations: ['镜像未逐字核对'],
          },
        ],
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdminUpdates />
    </QueryClientProvider>
  )
  expect(await screen.findByText('完整请求正文')).toBeVisible()
  expect(screen.getByRole('main')).toHaveClass(
    'min-h-0',
    'flex-1',
    'overflow-y-auto'
  )
  const baseline = screen.getByText('v1.0.0 · 初始版本').closest('details')
  expect(baseline).not.toHaveAttribute('open')
  await userEvent.setup().click(screen.getByText('v1.0.0 · 初始版本'))
  expect(baseline).toHaveAttribute('open')
  expect(screen.getByText('同学补丁基线')).toBeVisible()
})

it('shows a retry action when the backend does not support update history yet', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('404'))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdminUpdates />
    </QueryClientProvider>
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Update history unavailable'
  )
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})
