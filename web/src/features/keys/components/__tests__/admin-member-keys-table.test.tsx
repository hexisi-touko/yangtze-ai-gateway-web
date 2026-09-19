import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'

import { api } from '@/lib/api'

import { AdminMemberKeysTable } from '../admin-member-keys-table'

const originalAdapter = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  api.defaults.adapter = originalAdapter
  clients.splice(0).forEach((client) => client.clear())
  localStorage.clear()
})

function renderMemberKeys() {
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const keys = createRoute({
    getParentRoute: () => authenticated,
    path: 'keys/',
    component: AdminMemberKeysTable,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([keys])]),
    history: createMemoryHistory({ initialEntries: ['/keys'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('member key list failures', () => {
  it('shows a retryable error instead of claiming no keys exist on HTTP 404', async () => {
    let failing = true
    api.defaults.adapter = async (config) => {
      const response = {
        status: failing ? 404 : 200,
        statusText: failing ? 'Not Found' : 'OK',
        config,
        headers: new AxiosHeaders(),
        data: { success: true, data: { items: [], total: 0 } },
      }
      if (failing) {
        throw new AxiosError(
          'Request failed',
          'ERR_BAD_RESPONSE',
          config,
          undefined,
          response
        )
      }
      return response
    }
    renderMemberKeys()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load member API keys'
    )
    expect(screen.queryByText('No member keys found')).not.toBeInTheDocument()
    failing = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No member keys found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not turn a business error into an empty successful result', async () => {
    api.defaults.adapter = async (config) => ({
      status: 200,
      statusText: 'OK',
      config,
      headers: new AxiosHeaders(),
      data: { success: false, message: 'Database unavailable' },
    })
    renderMemberKeys()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load member API keys'
    )
    expect(screen.queryByText('No member keys found')).not.toBeInTheDocument()
  })
})
