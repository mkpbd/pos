import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const emptyPage = ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } })

describe('LoginPage', () => {
  it('validates input before calling the API', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED') })
    renderRoutes(routes, '/login')

    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter a valid e-mail address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/login'))).toBe(false)
  })

  it('shows the server message for rejected credentials', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': fail(422, 'INVALID_CREDENTIALS', 'These credentials do not match our records.'),
    })
    renderRoutes(routes, '/login')

    await user.type(await screen.findByLabelText('E-mail'), 'rahim@corner.test')
    await user.type(screen.getByLabelText('Password'), 'wrong-pass1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('These credentials do not match our records.')
  })

  it('signs in and returns to the requested page', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=t'
    const fetchMock = mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': ok(makeCurrentUser()),
      'GET /users': emptyPage,
      'GET /roles': ok([]),
    })
    const { router } = renderRoutes(routes, '/login?redirect=%2Fusers')

    await user.type(await screen.findByLabelText('E-mail'), 'rahim@corner.test')
    await user.type(screen.getByLabelText('Password'), 'password1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/users')
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login')) as unknown as [string, RequestInit]
    expect(JSON.parse(String(loginCall[1].body))).toEqual({ email: 'rahim@corner.test', password: 'password1', remember: false })
  })

  it('ignores external redirect targets', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=t'
    mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED'), 'POST /auth/login': ok(makeCurrentUser()), 'GET /branches': emptyPage })
    const { router } = renderRoutes(routes, '/login?redirect=%2F%2Fevil.example')

    await user.type(await screen.findByLabelText('E-mail'), 'rahim@corner.test')
    await user.type(screen.getByLabelText('Password'), 'password1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/branches')
  })
})
