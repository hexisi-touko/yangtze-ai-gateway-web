import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { ClientReleases } from '../index'
import type { ClientRelease } from '../types'

const release: ClientRelease = {
  id: 17,
  version: '1.2.3',
  platform: 'windows-x64',
  channel: 'stable',
  release_notes: 'Fix startup and update checks',
  download_url: 'https://downloads.example.test/client.exe',
  file_name: 'client.exe',
  file_size: 1024,
  sha256: '',
  mandatory: false,
  published: false,
  created_by: 1,
  published_at: 0,
  created_at: 100,
  updated_at: 100,
}

const originalAdapter = api.defaults.adapter
afterEach(() => {
  api.defaults.adapter = originalAdapter
})

describe('client release publishing', () => {
  it('publishes a draft and updates the visible release status', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let published = false
    let publishRequest: InternalAxiosRequestConfig | undefined
    api.defaults.adapter = async (config) => {
      if (config.method === 'post') {
        publishRequest = config
        published = true
      }
      const data =
        config.method === 'post'
          ? { success: true, data: { ...release, published } }
          : { success: true, data: [{ ...release, published }] }
      return {
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
        data,
      }
    }

    render(
      <QueryClientProvider client={client}>
        <ClientReleases />
      </QueryClientProvider>
    )

    expect(await screen.findByText('Draft')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Published')).toBeInTheDocument()
    expect(publishRequest?.url).toBe('/api/client-releases/17/publish')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument()
    )
    client.clear()
  })

  it('opens the release form with an installer picker', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    api.defaults.adapter = async (config) => ({
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
      data: { success: true, data: [] },
    })

    render(
      <QueryClientProvider client={client}>
        <ClientReleases />
      </QueryClientProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'New client release' }))
    expect(await screen.findByRole('heading', { name: 'New client release' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Installer package (.exe)')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    client.clear()
  })
})
