import { act, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { authKeys } from '@/features/auth/api'
import { useAuth, useCan } from '@/features/auth/use-auth'
import type { CurrentUser } from '@/features/auth/types'
import { createTestQueryClient } from '@/test/utils'

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: null,
  roles: [],
  permissions: ['storefront.view'],
  branches: [],
} as unknown as CurrentUser

function Probe() {
  const user = useAuth()
  const can = useCan()
  return (
    <p>
      {user.user.name} · {can('storefront.view') ? 'can view' : 'cannot view'}
    </p>
  )
}

describe('useAuth', () => {
  it('keeps the last user while the session is cleared during sign-out; permissions follow the live session', async () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.me, me)
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    expect(screen.getByText('Nadia Store · can view')).toBeInTheDocument()

    // What useLogoutMutation does: the account menu must not throw before RequireAuth unmounts it.
    act(() => client.setQueryData(authKeys.me, null))
    expect(await screen.findByText('Nadia Store · cannot view')).toBeInTheDocument()
  })

  it('still refuses to run without any session', () => {
    const client = createTestQueryClient()
    client.setQueryData(authKeys.me, null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    ).toThrow('useAuth() used outside an authenticated route')
  })
})
