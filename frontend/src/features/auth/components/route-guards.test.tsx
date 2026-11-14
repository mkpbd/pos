import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authKeys } from '@/features/auth/api'
import { RequireAuth } from '@/features/auth/components/route-guards'
import type { CurrentUser } from '@/features/auth/types'
import { api } from '@/lib/api/client'
import { createTestQueryClient } from '@/test/utils'

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: null,
  roles: [],
  permissions: ['products.manage'],
  branches: [],
} as unknown as CurrentUser

function app(client: ReturnType<typeof createTestQueryClient>) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/products/new']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/products/new" element={<input aria-label="Product name" />} />
          </Route>
          <Route path="/login" element={<p>Sign in</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RequireAuth', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the page (and what was typed) when a background refresh of the session fails', async () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.me, me)
    app(client)
    const name = screen.getByLabelText('Product name')
    await userEvent.type(name, 'Organic honey 500 g')

    // An overloaded or slow server: the refresh of /auth/me fails, the last good session stays.
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Request timed out'))
    await act(async () => {
      await client.refetchQueries({ queryKey: authKeys.me })
    })

    expect(client.getQueryState(authKeys.me)?.status).toBe('error')
    // Let the query cache's batched notification reach the guard before checking what it shows.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.queryByText('Could not load your session')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Product name')).toBe(name)
    expect(name).toHaveValue('Organic honey 500 g')
  })

  it('still shows the error when there is no session at all', async () => {
    const client = createTestQueryClient()
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Request timed out'))
    app(client)
    expect(await screen.findByText('Could not load your session')).toBeInTheDocument()
  })
})
