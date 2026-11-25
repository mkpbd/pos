import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useCartStore } from '@/features/pos/cart-store'
import { useTillLockStore } from '@/features/pos/till-lock'
import { useSessionStore } from '@/stores/session-store'
import { posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const terminal = {
  id: 't-1', name: 'Till 1', store: { id: 's-1', name: 'Shop floor', branch_id: 'b-1' },
  users: [{ id: 'u-4', name: 'Pos Cashier' }, { id: 'u-5', name: 'Rina Akter' }],
}

describe('TillSignInPage', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'XSRF-TOKEN=t'
    useCartStore.setState({ carts: {} })
    useSessionStore.setState({ activeBranchId: null })
    useTillLockStore.setState({ lockedUserId: null })
  })

  it('signs a cashier in with a tile and the PIN, then opens the POS on the till’s branch and store', async () => {
    const user = userEvent.setup()
    let me: unknown = null
    let body: unknown
    mockApi({
      'GET /auth/me': () => (me ? ok(me) : fail(401, 'UNAUTHENTICATED')),
      'GET /pos/terminal': ok(terminal),
      'POST /auth/pin': (init) => {
        body = JSON.parse(String(init.body))
        me = { ...posCashier(), pin_set: true }
        return ok(me)
      },
    })
    const { router } = renderRoutes(routes, '/pos/sign-in')

    expect(await screen.findByRole('heading', { name: 'Who is selling?' })).toBeInTheDocument()
    expect(screen.getByText('Till 1 · Shop floor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pos Cashier' }))
    await user.keyboard('2468{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/pos'))
    expect(body).toEqual({ user_id: 'u-4', pin: '2468' })
    expect(useSessionStore.getState().activeBranchId).toBe('b-1')
    expect(useCartStore.getState().carts['b-1']?.storeId).toBe('s-1')
  })

  it('shows attempts left, then the lockout countdown with the pad disabled', async () => {
    const user = userEvent.setup()
    let calls = 0
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'GET /pos/terminal': ok(terminal),
      'POST /auth/pin': () => (++calls === 1
        ? fail(422, 'PIN_INVALID', 'The PIN is not right.', { attempts_left: 1 })
        : fail(423, 'PIN_LOCKED', 'Too many tries.', { retry_after: 900 })),
    })
    renderRoutes(routes, '/pos/sign-in')

    await user.click(await screen.findByRole('button', { name: 'Rina Akter' }))
    await user.keyboard('1357{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong PIN. 1 attempt left.')

    await user.keyboard('1358{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong PINs. Try again in 15:00.'))
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
  })

  it('sends accounts with two-factor sign-in to the password sign-in', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'GET /pos/terminal': ok(terminal),
      'POST /auth/pin': fail(422, 'PIN_NOT_ALLOWED', 'Sign in with your password and code.'),
    })
    renderRoutes(routes, '/pos/sign-in')

    await user.click(await screen.findByRole('button', { name: 'Rina Akter' }))
    await user.keyboard('135790')
    expect(await screen.findByRole('alert')).toHaveTextContent('This account uses two-factor sign-in.')
    expect(screen.getByRole('link', { name: 'Sign in with password and code' })).toHaveAttribute('href', '/login?method=password&redirect=%2Fpos')
  })

  it('is the password sign-in on a device that is not a till', async () => {
    mockApi({
      'GET /auth/me': fail(401, 'UNAUTHENTICATED'),
      'GET /pos/terminal': fail(404, 'TERMINAL_NOT_FOUND', 'This device is not set up as a till.'),
    })
    const { router } = renderRoutes(routes, '/pos/sign-in')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByRole('link', { name: 'Use till PIN' })).not.toBeInTheDocument()
  })
})

describe('LoginPage on a till', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('offers the till PIN, and opens it straight away on the way to the POS', async () => {
    mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED'), 'GET /pos/terminal': ok(terminal) })
    const first = renderRoutes(routes, '/login')
    expect(await screen.findByRole('link', { name: 'Use till PIN' })).toHaveAttribute('href', '/pos/sign-in')
    first.unmount()

    const { router } = renderRoutes(routes, '/login?redirect=%2Fpos')
    await waitFor(() => expect(router.state.location.pathname).toBe('/pos/sign-in'))
    expect(await screen.findByRole('button', { name: 'Rina Akter' })).toBeInTheDocument()
  })

  it('keeps the password sign-in when it was asked for', async () => {
    mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED'), 'GET /pos/terminal': ok(terminal) })
    const { router } = renderRoutes(routes, '/login?method=password&redirect=%2Fpos')

    expect(await screen.findByRole('link', { name: 'Use till PIN' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
