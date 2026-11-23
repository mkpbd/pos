import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const emptyPage = ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } })
const challenge = ok({ two_factor_required: true })

async function signInWithPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('E-mail'), 'rahim@corner.test')
  await user.type(screen.getByLabelText('Password'), 'password1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return screen.findByLabelText('Authentication code')
}

const bodyOf = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path)).map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as unknown)

describe('LoginPage — two-factor step (G1a)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('asks for the authenticator code and signs in as soon as six digits are typed', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': challenge,
      'POST /auth/two-factor-challenge': ok(makeCurrentUser()),
      'GET /users': emptyPage,
      'GET /roles': ok([]),
    })
    const { router } = renderRoutes(routes, '/login?redirect=%2Fusers')

    const input = await signInWithPassword(user)
    expect(screen.getByRole('heading', { name: 'Two-factor sign-in' })).toBeInTheDocument()
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    await user.type(input, '123 456')

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/users')
    expect(bodyOf(fetchMock, '/auth/two-factor-challenge')).toEqual([{ code: '123456' }])
  })

  it('shows a wrong code inline and clears the input', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': challenge,
      'POST /auth/two-factor-challenge': fail(422, 'INVALID_TWO_FACTOR_CODE', 'That code is not right. Try again.'),
    })
    renderRoutes(routes, '/login')

    const input = await signInWithPassword(user)
    await user.type(input, '000000')

    expect(await screen.findByText('That code is not right. Try again.')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('validates the code length before calling the API', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED'), 'POST /auth/login': challenge })
    renderRoutes(routes, '/login')

    const input = await signInWithPassword(user)
    await user.type(input, '123')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('Enter the 6-digit code from your app.')).toBeInTheDocument()
    expect(bodyOf(fetchMock, '/auth/two-factor-challenge')).toEqual([])
  })

  it('accepts a recovery code instead', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': challenge,
      'POST /auth/two-factor-challenge': ok(makeCurrentUser()),
      'GET /branches': emptyPage,
    })
    renderRoutes(routes, '/login?redirect=%2Fbranches')

    await signInWithPassword(user)
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }))
    await user.type(screen.getByLabelText('Recovery code'), ' ABCDE-23456 ')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument()
    expect(bodyOf(fetchMock, '/auth/two-factor-challenge')).toEqual([{ recovery_code: 'abcde-23456' }])
  })

  it('goes back to the password step with a message when the challenge expired', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': challenge,
      'POST /auth/two-factor-challenge': fail(422, 'TWO_FACTOR_CHALLENGE_EXPIRED', 'Sign in again.'),
    })
    renderRoutes(routes, '/login')

    await user.type(await signInWithPassword(user), '123456')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again.')
    expect(screen.getByLabelText('E-mail')).toHaveValue('rahim@corner.test')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('shows the lockout message on the code step and on the password step', async () => {
    const user = userEvent.setup()
    const locked = 'Too many failed sign-ins. Try again in 15 minutes or ask your administrator.'
    let loginLocked = false
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /auth/login': () => (loginLocked ? fail(422, 'ACCOUNT_LOCKED', locked) : challenge),
      'POST /auth/two-factor-challenge': fail(422, 'ACCOUNT_LOCKED', locked),
    })
    renderRoutes(routes, '/login')

    await user.type(await signInWithPassword(user), '123456')
    expect(await screen.findByRole('alert')).toHaveTextContent(locked)

    loginLocked = true
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    await user.type(await screen.findByLabelText('Password'), 'password1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(locked)
  })

  it('“Back to sign in” returns to the password form', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED'), 'POST /auth/login': challenge })
    renderRoutes(routes, '/login')

    await signInWithPassword(user)
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
