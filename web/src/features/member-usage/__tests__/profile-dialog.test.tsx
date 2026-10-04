import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ProfileDialog } from '../components/profile-dialog'
import type { UsageMember } from '../types'

const member: UsageMember = {
  user_id: 2,
  username: 'idle-member',
  display_name: 'Idle Member',
  profile: {
    user_id: 2,
    member_type: 'unspecified',
    project: '',
    purpose: '',
    updated_at: 0,
    updated_by: 0,
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
  workspace_project: '',
  workspace_branch: '',
  workspace_source: '',
  workspace_last_seen: 0,
}

const originalAdapter = api.defaults.adapter
afterEach(() => {
  api.defaults.adapter = originalAdapter
})

describe('member attribution editor', () => {
  it('offers classification choices without legacy project or purpose fields', () => {
    const client = new QueryClient()
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <ProfileDialog member={member} onClose={onClose} />
      </QueryClientProvider>
    )
    expect(
      screen.getByRole('option', { name: 'usage_type_other' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Current project')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Declared purpose')).not.toBeInTheDocument()
    client.clear()
  })

  it('saves only the member classification and refreshes the summary', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['member-usage', 1, 2], { members: [member] })
    const onClose = vi.fn()
    let request: InternalAxiosRequestConfig | undefined
    api.defaults.adapter = async (config) => {
      request = config
      return {
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
        data: { success: true, data: member.profile },
      }
    }
    render(
      <QueryClientProvider client={client}>
        <ProfileDialog member={member} onClose={onClose} />
      </QueryClientProvider>
    )

    await user.selectOptions(screen.getByLabelText('Member type'), 'intern')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(request?.method).toBe('put')
    expect(request?.url).toBe('/api/member-usage/profiles/2')
    expect(JSON.parse(String(request?.data))).toEqual({
      member_type: 'intern',
    })
    expect(client.getQueryState(['member-usage', 1, 2])?.isInvalidated).toBe(
      true
    )
    client.clear()
  })

  it('keeps entered values visible when the server fails to save', async () => {
    const user = userEvent.setup()
    const client = new QueryClient()
    const onClose = vi.fn()
    api.defaults.adapter = async (config) => {
      throw new AxiosError(
        'Request failed',
        'ERR_BAD_RESPONSE',
        config,
        undefined,
        {
          status: 500,
          statusText: 'Error',
          headers: new AxiosHeaders(),
          config,
          data: { success: false },
        }
      )
    }
    render(
      <QueryClientProvider client={client}>
        <ProfileDialog member={member} onClose={onClose} />
      </QueryClientProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Changes were not saved'
    )
    expect(onClose).not.toHaveBeenCalled()
    client.clear()
  })
})
