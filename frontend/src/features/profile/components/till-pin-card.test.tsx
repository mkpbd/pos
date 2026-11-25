import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { TillPinCard } from '@/features/profile/components/till-pin-card'
import { hasPin, pinError } from '@/features/profile/pin'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes, renderWithQuery } from '@/test/utils'

const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

describe('till PIN rules (POS1a)', () => {
  it('accepts 4–6 digits that are not repeated or a straight run', () => {
    expect(pinError('2580')).toBeNull()
    expect(pinError('104729')).toBeNull()
    expect(pinError('')).toBe('Enter a PIN.')
    expect(pinError('12a4')).toBe('Digits only.')
    expect(pinError('123')).toBe('4 to 6 digits.')
    expect(pinError('1234567')).toBe('4 to 6 digits.')
    expect(pinError('7777')).toMatch(/same digit/)
    expect(pinError('1234')).toMatch(/run/)
    expect(pinError('4321')).toMatch(/run/)
    expect(pinError('012345')).toMatch(/run/)
  })

  it('reads pin_set from the top level or the user object', () => {
    expect(hasPin(makeCurrentUser())).toBe(false)
    expect(hasPin(makeCurrentUser({ pin_set: true }))).toBe(true)
    expect(hasPin({ ...makeCurrentUser(), user: { ...makeCurrentUser().user, pin_set: true } })).toBe(true)
  })
})

describe('TillPinCard (POS1a)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('sets a PIN after the password, checking the rules and the confirmation first', async () => {
    const user = userEvent.setup()
    let pinSet = false
    const sent: unknown[] = []
    mockApi({
      'GET /auth/me': () => ok(makeCurrentUser({ pin_set: pinSet })),
      'PUT /profile/pin': (init) => {
        sent.push(body(init))
        if (body(init).current_password !== 'password1') return fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { current_password: ['The password is incorrect.'] })
        pinSet = true
        return { status: 204 }
      },
    })
    renderWithQuery(<TillPinCard />)

    expect(await screen.findByText('Not set')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set PIN' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set a till PIN' })
    await user.type(within(dialog).getByLabelText('Current password'), 'nope')
    await user.type(within(dialog).getByLabelText('New PIN'), '1111')
    await user.click(within(dialog).getByRole('button', { name: 'Set PIN' }))
    expect(within(dialog).getByText(/same digit/)).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('New PIN'))
    await user.type(within(dialog).getByLabelText('New PIN'), '25x80')
    expect(within(dialog).getByLabelText('New PIN')).toHaveValue('2580')
    await user.type(within(dialog).getByLabelText('Confirm new PIN'), '2581')
    await user.click(within(dialog).getByRole('button', { name: 'Set PIN' }))
    expect(within(dialog).getByText('The PINs do not match.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Confirm new PIN'))
    await user.type(within(dialog).getByLabelText('Confirm new PIN'), '2580')
    await user.click(within(dialog).getByRole('button', { name: 'Set PIN' }))
    expect(await within(dialog).findByText('The password is incorrect.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Current password'))
    await user.type(within(dialog).getByLabelText('Current password'), 'password1')
    await user.click(within(dialog).getByRole('button', { name: 'Set PIN' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toEqual([{ current_password: 'nope', pin: '2580' }, { current_password: 'password1', pin: '2580' }])
    expect(await screen.findByText('Set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change PIN' })).toBeInTheDocument()
  })

  it('removes the PIN with the password', async () => {
    const user = userEvent.setup()
    let pinSet = true
    let sent: unknown
    mockApi({
      'GET /auth/me': () => ok(makeCurrentUser({ pin_set: pinSet })),
      'DELETE /profile/pin': (init) => {
        sent = body(init)
        pinSet = false
        return { status: 204 }
      },
    })
    renderWithQuery(<TillPinCard />)

    await user.click(await screen.findByRole('button', { name: 'Remove PIN' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove your till PIN?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove PIN' }))
    expect(within(dialog).getByText('Enter your password.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Current password'), 'password1')
    await user.click(within(dialog).getByRole('button', { name: 'Remove PIN' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toEqual({ current_password: 'password1' })
    expect(await screen.findByText('Not set')).toBeInTheDocument()
  })

  it('appears on the profile page and notes two-factor accounts', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ two_factor: { enabled: true, required: false, setup_required: false } })),
      'GET /auth/two-factor': ok({ enabled: true, confirmed_at: null, required: false, recovery_codes_left: 8, pending_setup: false }),
      'GET /auth/tokens': ok([]),
      'GET /auth/login-activity': ok([], { pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }),
    })
    renderRoutes(routes, '/profile')

    expect(await screen.findByText('Till PIN')).toBeInTheDocument()
    expect(screen.getByText(/the till asks for your password and code/)).toBeInTheDocument()
  })
})
