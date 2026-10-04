/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { api } from '@/lib/api'

import type { ManagedMemberKey } from '../../types'
import { AdminMemberKeyCell } from '../admin-member-key-cell'

type PostMethod = (url: string) => Promise<{ data: unknown }>
const apiClient = api as unknown as { post: PostMethod }
const originalPost = apiClient.post

const memberKey: ManagedMemberKey = {
  id: 12,
  user_id: 34,
  name: 'member approved access key',
  key: 'abcd**********wxyz',
  status: 1,
  remain_quota: 9000,
  used_quota: 1000,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 1_788_310_000,
  accessed_time: 1_788_320_000,
  username: 'member01',
  display_name: 'Member 01',
  email: 'member01@example.com',
  user_status: 1,
  user_quota: 9000,
  user_used_quota: 1000,
  user_request_count: 42,
}

afterEach(() => {
  apiClient.post = originalPost
})

describe('AdminMemberKeyCell', () => {
  test('keeps the key masked until the administrator requests it', async () => {
    const requestedUrls: string[] = []
    apiClient.post = async (url) => {
      requestedUrls.push(url)
      return {
        data: {
          success: true,
          data: { key: 'full-member-secret', username: 'member01' },
        },
      }
    }

    render(<AdminMemberKeyCell apiKey={memberKey} />)

    expect(screen.getByText('sk-abcd**********wxyz')).toBeInTheDocument()
    expect(requestedUrls).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'View full API key' }))

    await waitFor(() => {
      expect(requestedUrls).toEqual(['/api/token/admin/members/12/key'])
    })
    expect(screen.getByDisplayValue('sk-full-member-secret')).toBeVisible()
  })
})
