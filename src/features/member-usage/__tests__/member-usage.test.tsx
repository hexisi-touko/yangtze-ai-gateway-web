import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MemberTable } from '../components/member-table'
import { filterUsageMembers, usageDateRange } from '../lib'
import type { UsageMember } from '../types'

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
    expect(screen.getByText('No recorded activity')).toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })
  it('opens the selected member editor and disables editing deleted members', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const active = member({
      profile: { ...member().profile, purpose: 'Long purpose '.repeat(35) },
    })
    render(
      <MemberTable
        members={[active, member({ user_id: 2, deleted: true })]}
        onEdit={onEdit}
      />
    )
    const buttons = screen.getAllByRole('button', {
      name: 'Edit member attribution',
    })
    await user.click(buttons[0])
    expect(onEdit).toHaveBeenCalledWith(active)
    expect(buttons[1]).toBeDisabled()
    expect(screen.getByText(active.profile.purpose.trim())).toBeInTheDocument()
  })
})
