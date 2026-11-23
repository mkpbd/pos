import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const signedOut = { 'GET /auth/me': fail(401, 'UNAUTHENTICATED') }

describe('Public sign-up flag (Q1 §5)', () => {
  it('offers "Create an account" on the login page only when sign-up is on', async () => {
    mockApi({ ...signedOut, 'GET /auth/options': ok({ registration_enabled: true }) })
    renderRoutes(routes, '/login')

    expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
  })

  it('hides "Create an account" when sign-up is off', async () => {
    const fetchMock = mockApi({ ...signedOut, 'GET /auth/options': ok({ registration_enabled: false }) })
    renderRoutes(routes, '/login')

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/options'))).toBe(true))
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
  })

  it('shows a closed page instead of the sign-up form when sign-up is off', async () => {
    mockApi({ ...signedOut, 'GET /auth/options': ok({ registration_enabled: false }) })
    renderRoutes(routes, '/register')

    expect(await screen.findByRole('heading', { name: 'Sign-up is closed' })).toBeInTheDocument()
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('shows the sign-up form when sign-up is on', async () => {
    mockApi({ ...signedOut, 'GET /auth/options': ok({ registration_enabled: true }) })
    renderRoutes(routes, '/register')

    expect(await screen.findByLabelText('Business name')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create your business account' })).toBeInTheDocument()
  })
})
