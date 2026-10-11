import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { formatQuotaAmount } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { MemberTable } from '../components/member-table'
import { RequestContents } from '../components/request-contents'
import { filterUsageMembers, usageDateRange } from '../lib'
import type { UsageMember } from '../types'

const requestContentApi = vi.hoisted(() => ({
  getMemberRequestContents: vi.fn(),
  getMemberRequestContentAlerts: vi.fn(),
}))

vi.mock('../api', () => ({
  ...requestContentApi,
  getMemberRequestContentsPage: async (params: unknown) => ({
    items: await requestContentApi.getMemberRequestContents(params),
    has_more: false,
    next_cursor: 0,
  }),
}))

function member(overrides: Partial<UsageMember> = {}): UsageMember {
  return {
    user_id: 1,
    username: 'researcher',
    display_name: 'Researcher',
    profile: {
      user_id: 1,
      member_type: 'intern',
      project: 'Project A',
      purpose: 'Research',
      updated_at: 0,
      updated_by: 1,
    },
    consume_records: 0,
    error_records: 0,
    refund_records: 0,
    tokens: 0,
    charged_quota: 0,
    refund_quota: 0,
    peak_minute_records: 0,
    last_active: 0,
    models: [],
    attention: [],
    deleted: false,
    quota: 0,
    used_quota: 0,
    request_count: 0,
    assigned_quota: 0,
    remaining_quota: 0,
    quota_utilization: 0,
    workspace_project: 'Project A',
    workspace_branch: 'main',
    workspace_source: 'codex',
    workspace_last_seen: 0,
    ...overrides,
  }
}

describe('member usage', () => {
  it('uses inclusive calendar dates and rejects invalid ranges', () => {
    const range = usageDateRange('2026-09-01', '2026-09-01')
    expect(range).not.toBeNull()
    if (!range) throw new Error('Expected a valid date range')
    expect(range.end - range.start).toBe(86400)
    expect(usageDateRange('', '2026-09-01')).toBeNull()
    expect(usageDateRange('2026-09-03', '2026-09-01')).toBeNull()
    expect(usageDateRange('2026-07-01', '2026-09-01')).toBeNull()
  })
  it('combines member type, project search and review filters without modifying data', () => {
    const members = [
      member(),
      member({ user_id: 2, attention: ['error_records'] }),
    ]
    expect(
      filterUsageMembers(members, 'PROJECT A', 'intern', true).map(
        (item) => item.user_id
      )
    ).toEqual([2])
    expect(filterUsageMembers(members, '', 'full_time', false)).toEqual([])
    expect(members[0].attention).toEqual([])
  })
  it('shows an empty state and preserves zero usage without claiming success', () => {
    const view = render(<MemberTable members={[]} />)
    expect(screen.getByText('No matching members')).toBeInTheDocument()
    view.rerender(<MemberTable members={[member()]} />)
    expect(screen.getByText('Review signals')).toBeInTheDocument()
    expect(screen.getByText('No recorded activity')).toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })
  it('shows client workspace, monetary quota values and a classification editor', () => {
    const active = member({
      quota: 700,
      used_quota: 300,
      assigned_quota: 1000,
      remaining_quota: 700,
      quota_utilization: 0.3,
    })
    const onEdit = vi.fn()
    render(<MemberTable members={[active]} onEdit={onEdit} />)
    expect(screen.getByText('Project A')).toBeInTheDocument()
    expect(screen.getByText(/Remaining quota/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit member type' })
    ).toBeInTheDocument()
  })
  it('converts internal quota units to money even when the global display is tokens', () => {
    const previous = useSystemConfigStore.getState().config
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...previous.currency,
        quotaDisplayType: 'TOKENS',
        quotaPerUnit: 500_000,
      },
    })
    try {
      const amount = formatQuotaAmount(150_000_000)
      expect(amount).not.toContain('150,000,000')
      expect(amount).toContain('$300')
    } finally {
      useSystemConfigStore.getState().setConfig({
        currency: previous.currency,
      })
    }
  })
  it('shows a stored Responses request as the member Chinese message', async () => {
    requestContentApi.getMemberRequestContents.mockResolvedValue([
      {
        id: 1,
        user_id: 1,
        username: 'researcher',
        request_id: 'request-1',
        created_at: 1_789_600_000,
        path: '/v1/responses',
        model: 'gpt-5.5',
        content: '{"role":"user","content":"请用中文总结今天的工作"}',
        content_hash: 'content-hash',
        bytes: 64,
        truncated: false,
      },
    ])
    requestContentApi.getMemberRequestContentAlerts.mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={client}>
        <RequestContents
          range={{ start: 1_789_500_000, end: 1_789_700_000 }}
          members={[]}
        />
      </QueryClientProvider>
    )

    await user.click(
      await screen.findByRole('button', { name: 'View request content' })
    )

    expect(
      await screen.findByText('请用中文总结今天的工作')
    ).toBeInTheDocument()
  })

  it('does not present an internal subagent report as the member message', async () => {
    requestContentApi.getMemberRequestContents.mockResolvedValue([
      {
        id: 2,
        user_id: 1,
        username: 'researcher',
        request_id: 'request-internal-report',
        created_at: 1_789_600_001,
        path: '/v1/responses',
        model: 'gpt-5.5',
        content:
          '{"role":"user","content":"Background subagent 6604a19b-7ac7-4bdf-857c-ec7483fdc005 finished and will do no further work unless you send it more.\\n\\nFindings sent to parent agent."}',
        content_hash: 'internal-content-hash',
        bytes: 220,
        truncated: false,
      },
    ])
    requestContentApi.getMemberRequestContentAlerts.mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={client}>
        <RequestContents
          range={{ start: 1_789_500_000, end: 1_789_700_000 }}
          members={[]}
        />
      </QueryClientProvider>
    )

    await user.click(
      await screen.findByRole('button', { name: 'View request content' })
    )

    expect(
      screen.queryByText(
        /Background subagent 6604a19b-7ac7-4bdf-857c-ec7483fdc005/
      )
    ).not.toBeInTheDocument()
    expect(
      await screen.findByText('Conversation content hidden')
    ).toBeInTheDocument()
  })

  it('does not present a forwarded agent message as the member message', async () => {
    requestContentApi.getMemberRequestContents.mockResolvedValue([
      {
        id: 3,
        user_id: 1,
        username: 'researcher',
        request_id: 'request-forwarded-agent',
        created_at: 1_789_600_002,
        path: '/v1/responses',
        model: 'gpt-5.6-luna',
        content:
          '{"role":"user","content":"Agent d47eb9f2-bcfd-4c5c-a803-979645a4f595 sent a message: 关键实践警告"}',
        content_hash: 'forwarded-agent-content-hash',
        bytes: 120,
        truncated: false,
      },
    ])
    requestContentApi.getMemberRequestContentAlerts.mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={client}>
        <RequestContents
          range={{ start: 1_789_500_000, end: 1_789_700_000 }}
          members={[]}
        />
      </QueryClientProvider>
    )

    await user.click(
      await screen.findByRole('button', { name: 'View request content' })
    )

    expect(
      screen.queryByText(/Agent d47eb9f2-bcfd-4c5c-a803/)
    ).not.toBeInTheDocument()
    expect(
      await screen.findByText('Conversation content hidden')
    ).toBeInTheDocument()
  })
})
