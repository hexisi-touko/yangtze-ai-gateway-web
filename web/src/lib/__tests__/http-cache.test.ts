import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'

import { api } from '../http-client'

describe('API browser cache policy', () => {
  it('revalidates GET requests instead of reusing a previously cached 404', async () => {
    let sentConfig: InternalAxiosRequestConfig | undefined
    await api.get('/api/member-usage/summary', {
      params: { start: 1, end: 2 },
      adapter: async (config) => {
        sentConfig = config
        return {
          data: { success: true, data: { members: [] } },
          status: 200,
          statusText: 'OK',
          headers: new AxiosHeaders(),
          config,
        }
      },
    })

    expect(sentConfig?.headers.get('Cache-Control')).toMatch(/\bno-cache\b/)
    expect(sentConfig?.headers.get('Cache-Control')).toMatch(/\bno-store\b/)
  })
})
