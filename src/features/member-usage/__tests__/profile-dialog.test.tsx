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
}

const originalAdapter = api.defaults.adapter
afterEach(() => {
  api.defaults.adapter = originalAdapter
})

describe('member attribution editor', () => {
  it('saves project and purpose for a zero-usage member and refreshes the summary', async () => {
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
    await user.type(screen.getByLabelText('Current project'), 'Test project')
    await user.type(
      screen.getByLabelText('Declared purpose'),
      'Integration testing'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(request?.method).toBe('put')
    expect(request?.url).toBe('/api/member-usage/profiles/2')
    expect(JSON.parse(String(request?.data))).toEqual({
      member_type: 'intern',
      project: 'Test project',
      purpose: 'Integration testing',
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
    await user.type(screen.getByLabelText('Current project'), 'Test project')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Changes were not saved'
    )
    expect(screen.getByLabelText('Current project')).toHaveValue('Test project')
    expect(onClose).not.toHaveBeenCalled()
    client.clear()
  })
})
