import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { OTPAUTH_URI, RECOVERY_CODES, SECRET } from '@/features/auth/two-factor-test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const URI = OTPAUTH_URI
const CODES = RECOVERY_CODES

const emptyPage = ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } })
const mustSetUp = () => makeCurrentUser({ two_factor: { enabled: false, required: true, setup_required: true } })
const status = (enabled: boolean) => ok({ enabled, confirmed_at: enabled ? '2026-11-20T10:00:00Z' : null, required: true, recovery_codes_left: enabled ? 10 : null, pending_setup: false })

describe('Two-factor setup required (G1a)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('sends a user who must set it up to the full-screen setup, and walks the whole flow', async () => {
    const user = userEvent.setup()
    let enabled = false
    let me = mustSetUp()
    const fetchMock = mockApi({
      'GET /auth/me': () => ok(me),
      'GET /auth/two-factor': () => status(enabled),
      'POST /auth/two-factor/setup': (init) =>
        JSON.parse(String(init.body)).password === 'password1' ? ok({ secret: SECRET, otpauth_uri: URI }) : fail(422, 'INVALID_PASSWORD', 'The password is incorrect.'),
      'POST /auth/two-factor/confirm': (init) => {
        if (JSON.parse(String(init.body)).code !== '654321') return fail(422, 'INVALID_TWO_FACTOR_CODE', 'That code is not right. Try again.')
        enabled = true
        me = makeCurrentUser({ two_factor: { enabled: true, required: true, setup_required: false } })
        return ok({ recovery_codes: CODES })
      },
      'GET /users': emptyPage,
      'GET /roles': ok([]),
    })
    const { router } = renderRoutes(routes, '/users')

    expect(await screen.findByRole('heading', { name: 'Set up two-factor sign-in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/two-factor/setup')
    expect(router.state.location.search).toBe('?redirect=%2Fusers')
    expect(screen.getByText('Corner Shop requires two-factor sign-in for your account. Set it up to continue.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    // Outside the admin shell: no navigation.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    await user.type(await screen.findByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('The password is incorrect.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'password1')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('img', { name: 'QR code to scan with your authenticator app' })).toBeInTheDocument()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
    const codeInput = screen.getByLabelText('2. Enter the 6-digit code from the app')
    await user.type(codeInput, '111111')
    await user.click(screen.getByRole('button', { name: 'Turn on two-factor' }))
    expect(await screen.findByText('That code is not right. Try again.')).toBeInTheDocument()

    await user.type(codeInput, '654321')
    await user.click(screen.getByRole('button', { name: 'Turn on two-factor' }))

    const list = await screen.findByRole('list', { name: 'Recovery codes' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    const download = screen.getByRole('link', { name: 'Download .txt' })
    expect(download).toHaveAttribute('download', 'recovery-codes.txt')
    expect(decodeURIComponent(download.getAttribute('href') ?? '')).toContain('abcde-23456\nfghjk-34567')
    const continueButton = screen.getByRole('button', { name: 'Continue to the app' })
    expect(continueButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'I’ve saved these codes' }))
    await user.click(continueButton)

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/users')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/two-factor/confirm'))).toBe(true)
  })

  it('copies the key and the recovery codes', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    mockApi({
      'GET /auth/me': ok(mustSetUp()),
      'GET /auth/two-factor': status(false),
      'POST /auth/two-factor/setup': ok({ secret: SECRET, otpauth_uri: URI }),
      'POST /auth/two-factor/confirm': ok({ recovery_codes: CODES }),
    })
    renderRoutes(routes, '/two-factor/setup')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await user.type(await screen.findByLabelText('Password'), 'password1')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Copy key' }))
    expect(writeText).toHaveBeenLastCalledWith(SECRET)

    await user.type(screen.getByLabelText('2. Enter the 6-digit code from the app'), '123456')
    await user.click(screen.getByRole('button', { name: 'Turn on two-factor' }))
    await user.click(await screen.findByRole('button', { name: 'Copy codes' }))
    expect(writeText).toHaveBeenLastCalledWith(CODES.join('\n'))
  })

  it('sends the user to setup when any API call answers 403 TWO_FACTOR_SETUP_REQUIRED', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /users': fail(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Set up two-factor sign-in to continue.'),
      'GET /roles': ok([]),
      'GET /auth/two-factor': status(false),
    })
    const { router } = renderRoutes(routes, '/users')

    expect(await screen.findByRole('heading', { name: 'Set up two-factor sign-in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/two-factor/setup')
  })

  it('signs out from the setup screen', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(mustSetUp()),
      'GET /auth/two-factor': status(false),
      'POST /auth/logout': { status: 204 },
      'GET /auth/options': ok({ registration_enabled: false }),
    })
    const { router } = renderRoutes(routes, '/two-factor/setup')

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('offers to continue when two-factor is already on', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ two_factor: { enabled: true, required: true, setup_required: false } })),
      'GET /auth/two-factor': status(true),
      'GET /branches': emptyPage,
    })
    const { router } = renderRoutes(routes, '/two-factor/setup?redirect=%2Fbranches')

    expect(await screen.findByText('Two-factor sign-in is on for your account.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to the app' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/branches'))
  })
})
