import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { OTPAUTH_URI, RECOVERY_CODES, SECRET } from '@/features/auth/two-factor-test-data'
import { TwoFactorCard } from '@/features/profile/components/two-factor-card'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes, renderWithQuery } from '@/test/utils'

type Status = { enabled: boolean; confirmed_at: string | null; required: boolean; recovery_codes_left: number | null; pending_setup: boolean }
const off: Status = { enabled: false, confirmed_at: null, required: false, recovery_codes_left: null, pending_setup: false }
const on: Status = { enabled: true, confirmed_at: '2026-11-20T10:00:00Z', required: false, recovery_codes_left: 8, pending_setup: false }
const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

describe('TwoFactorCard (G1a)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('sets up two-factor in a dialog: password, QR and key, code, recovery codes', async () => {
    const user = userEvent.setup()
    let current = off
    mockApi({
      'GET /auth/two-factor': () => ok(current),
      'POST /auth/two-factor/setup': ok({ secret: SECRET, otpauth_uri: OTPAUTH_URI }),
      'POST /auth/two-factor/confirm': () => {
        current = { ...on, recovery_codes_left: 10 }
        return ok({ recovery_codes: RECOVERY_CODES })
      },
    })
    renderWithQuery(<TwoFactorCard />)

    expect(await screen.findByText('Off')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set up' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set up two-factor sign-in' })
    await user.type(within(dialog).getByLabelText('Password'), 'password1')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

    expect(await within(dialog).findByTestId('two-factor-qr')).toBeInTheDocument()
    expect(within(dialog).getByText('Can’t scan? Enter this key')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('2. Enter the 6-digit code from the app'), '123456')
    await user.click(within(dialog).getByRole('button', { name: 'Turn on two-factor' }))

    expect(await within(dialog).findByText('abcde-23456')).toBeInTheDocument()
    // The card behind already shows the new state; the dialog keeps the codes until they are saved.
    expect(await screen.findByText('On')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'I’ve saved these codes' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('10 recovery codes left.')).toBeInTheDocument()
  })

  it('makes new recovery codes after the password', async () => {
    const user = userEvent.setup()
    let sent: unknown
    mockApi({
      'GET /auth/two-factor': ok({ ...on, recovery_codes_left: 2 }),
      'POST /auth/two-factor/recovery-codes': (init) => {
        sent = body(init)
        return body(init).password === 'password1' ? ok({ recovery_codes: RECOVERY_CODES }) : fail(422, 'INVALID_PASSWORD', 'The password is incorrect.')
      },
    })
    renderWithQuery(<TwoFactorCard />)

    expect(await screen.findByText(/2 recovery codes left\. Make new ones soon\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New recovery codes' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recovery codes' })
    await user.type(within(dialog).getByLabelText('Password'), 'nope')
    await user.click(within(dialog).getByRole('button', { name: 'Make new codes' }))
    expect(await within(dialog).findByText('The password is incorrect.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Password'))
    await user.type(within(dialog).getByLabelText('Password'), 'password1')
    await user.click(within(dialog).getByRole('button', { name: 'Make new codes' }))
    expect(await within(dialog).findByRole('list', { name: 'Recovery codes' })).toBeInTheDocument()
    expect(sent).toEqual({ password: 'password1' })
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeDisabled()
  })

  it('turns two-factor off with the password and a code', async () => {
    const user = userEvent.setup()
    let current = on
    let sent: unknown
    mockApi({
      'GET /auth/two-factor': () => ok(current),
      'DELETE /auth/two-factor': (init) => {
        sent = body(init)
        if (body(init).code !== '654321') return fail(422, 'INVALID_TWO_FACTOR_CODE', 'That code is not right. Try again.')
        current = off
        return { status: 204 }
      },
      'GET /auth/me': ok(makeCurrentUser()),
    })
    renderWithQuery(<TwoFactorCard />)

    await user.click(await screen.findByRole('button', { name: 'Turn off' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn off two-factor sign-in?' })
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(within(dialog).getByText('Enter your password.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Password'), 'password1')
    await user.type(within(dialog).getByLabelText('Authentication or recovery code'), '111111')
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(await within(dialog).findByText('That code is not right. Try again.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Authentication or recovery code'))
    await user.type(within(dialog).getByLabelText('Authentication or recovery code'), '654321')
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toEqual({ password: 'password1', code: '654321' })
    expect(await screen.findByText('Off')).toBeInTheDocument()
  })

  it('hides “Turn off” when the organization requires two-factor', async () => {
    mockApi({ 'GET /auth/two-factor': ok({ ...on, required: true }) })
    renderWithQuery(<TwoFactorCard />)

    expect(await screen.findByText('Your organization requires two-factor sign-in, so it can’t be turned off.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New recovery codes' })).toBeInTheDocument()
  })

  it('appears on the profile page', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /auth/two-factor': ok(off),
      'GET /auth/tokens': ok([]),
      'GET /auth/login-activity': ok(
        [{ id: 'la-1', channel: 'session', succeeded: false, failure_reason: 'invalid_two_factor', ip_address: null, user_agent: null, created_at: '2026-11-20T10:00:00Z' }],
        { pagination: { current_page: 1, per_page: 10, total: 1, last_page: 1 } },
      ),
    })
    renderRoutes(routes, '/profile')

    expect(await screen.findByText('Two-factor sign-in')).toBeInTheDocument()
    expect(await screen.findByText('Wrong two-factor code')).toBeInTheDocument()
  })
})
