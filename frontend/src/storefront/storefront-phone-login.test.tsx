import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { CODE_PATTERN, cleanCode, clock, otpErrorMessage, retryAfter } from './account/otp'
import { bdPhoneFrom } from './account/schemas'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, customerFixture, resetLocale, tEn } from './test-fixtures'
import type { Customer } from './types'

/*
 * BD1a §8: sign-in with a code sent to the mobile number, the new-shopper profile step, and the
 * profile's phone verification, "Add e-mail" and first password.
 */

vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

afterEach(() => localStorage.clear())

type Routes = Parameters<typeof mockApi>[0]
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>
const accepted = (data: unknown) => ({ status: 202, body: { success: true, data, meta: { request_id: 't' } } })

function serve(me: () => Customer | null, routes: Routes = {}, phoneLogin = true) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture(phoneLogin ? { account: { phone_login: true } } : {})),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/account/me': () => ok(me()),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
}

describe('SMS code helpers', () => {
  it('reads codes typed with Bengali digits, formats the countdown and names every code error', () => {
    expect(cleanCode('১২৩ ৪৫৬৭')).toBe('123456')
    expect(cleanCode('12-34')).toBe('1234')
    expect(CODE_PATTERN.test('012345')).toBe(true)
    expect(clock(45)).toBe('0:45')
    expect(clock(60)).toBe('1:00')
    expect(bdPhoneFrom(' +880 ১৭১১-২২৩৩৪৪ ')).toBe('01711223344')

    const tooSoon = new ApiError(429, 'OTP_TOO_SOON', 'Too soon', { retry_after: 37 })
    expect(retryAfter(tooSoon)).toBe(37)
    expect(retryAfter(new ApiError(429, 'OTP_LIMIT', 'Limit'))).toBeNull()
    expect(otpErrorMessage(tooSoon, tEn)).toBe('Please wait 37 seconds before asking for a new code.')
    const messages = ['SMS_UNAVAILABLE', 'OTP_LIMIT', 'OTP_INVALID', 'OTP_EXPIRED', 'OTP_TOO_MANY_ATTEMPTS', 'OTP_SESSION_EXPIRED', 'PHONE_IN_USE'].map((code) => otpErrorMessage(new ApiError(422, code, code), tEn))
    expect(messages).toEqual([
      'Text messages cannot be sent right now. Please try again later.',
      'Too many codes were asked for. Please try again later.',
      'This code is not correct. Please check the SMS and try again.',
      'This code has expired. Please ask for a new one.',
      'Too many wrong codes. Please ask for a new code.',
      'This took too long. Please enter your mobile number again.',
      'This mobile number belongs to another account.',
    ])
    expect(otpErrorMessage(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { phone: ['The phone is invalid.'] }), tEn)).toBe('The phone is invalid.')
    expect(otpErrorMessage(new Error('x'), tEn)).toBe('Something went wrong. Please try again.')
  })
})

describe('sign-in with a mobile number', () => {
  it('sends a code, explains a wrong one, then signs in and moves on to ?next=', async () => {
    let me: Customer | null = null
    const sends: unknown[] = []
    const logins: unknown[] = []
    serve(() => me, {
      'POST /store/account/otp/send': (init) => {
        sends.push(bodyOf(init))
        return accepted({ resend_after: 45, expires_in: 300 })
      },
      'POST /store/account/otp/login': (init) => {
        const body = bodyOf(init)
        logins.push(body)
        if (body.code !== '123456') return fail(422, 'OTP_INVALID', 'Wrong code')
        me = customerFixture({ phone_verified: true })
        return ok({ status: 'signed_in', customer: me })
      },
      'GET /store/account/addresses': ok([]),
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/login?next=%2Faccount%2Faddresses')
    const user = userEvent.setup()

    const phoneTab = await screen.findByRole('tab', { name: 'Mobile number' })
    expect(phoneTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'E-mail & password' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Mobile number')
    expect(screen.getByRole('link', { name: 'Track an order without signing in' })).toHaveAttribute('href', '/track-order')

    // Checked in the browser first.
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(screen.getByRole('textbox', { name: 'Mobile number' })).toHaveAccessibleDescription('Please enter a mobile number.')
    await user.type(screen.getByRole('textbox', { name: 'Mobile number' }), '+880 1711-223344')
    await user.click(screen.getByLabelText('Keep me signed in'))
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    expect(await screen.findByText('We sent a 6-digit code to 01711223344.')).toBeInTheDocument()
    expect(sends).toEqual([{ phone: '01711223344', purpose: 'login' }])
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent(/You can ask for a new code in 0:4\d\./)
    const code = screen.getByLabelText('Code from the SMS')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    await waitFor(() => expect(code).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter the 6-digit code from the SMS.')
    await user.type(code, '111111')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This code is not correct. Please check the SMS and try again.')
    expect(code).toHaveValue('')

    await user.type(code, '১২৩৪৫৬')
    expect(code).toHaveValue('123456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/account/addresses'))
    expect(logins.at(-1)).toEqual({ phone: '01711223344', code: '123456', remember: true })
    expect(await screen.findByRole('heading', { level: 1, name: 'Addresses' })).toBeInTheDocument()
  })

  it('creates the account of a new number with a name and an optional e-mail', async () => {
    let me: Customer | null = null
    const registers: unknown[] = []
    serve(() => me, {
      'POST /store/account/otp/send': accepted({ resend_after: 60, expires_in: 300 }),
      'POST /store/account/otp/login': ok({ status: 'needs_profile', phone: '01811223344' }),
      'POST /store/account/otp/register': (init) => {
        const body = bodyOf(init)
        registers.push(body)
        if (registers.length === 1) return fail(422, 'VALIDATION_FAILED', 'Invalid', { email: ['This e-mail address is already registered.'] })
        me = customerFixture({ name: 'Karim Uddin', email: null, phone: '01811223344', email_verified: false, phone_verified: true, has_password: false })
        return { status: 201, body: { success: true, data: me, meta: { request_id: 't' } } }
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/login')
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: 'Mobile number' }), '01811223344')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('Code from the SMS'), '654321')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const profile = await screen.findByRole('form', { name: 'Almost done' })
    expect(profile).toHaveTextContent('Your mobile number 01811223344 is confirmed.')
    await user.click(within(profile).getByRole('button', { name: 'Create account' }))
    expect(within(profile).getByLabelText('Full name')).toHaveAccessibleDescription('Please enter your name.')
    await user.type(within(profile).getByLabelText('Full name'), 'Karim Uddin')
    await user.type(within(profile).getByLabelText('E-mail (optional)'), 'not-an-email')
    await user.click(within(profile).getByRole('button', { name: 'Create account' }))
    expect(within(profile).getByLabelText('E-mail (optional)')).toHaveAccessibleDescription('Please enter a valid e-mail address.')
    await user.clear(within(profile).getByLabelText('E-mail (optional)'))
    await user.type(within(profile).getByLabelText('E-mail (optional)'), 'karim@example.com')
    await user.click(within(profile).getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(within(profile).getByLabelText('E-mail (optional)')).toHaveAccessibleDescription('This e-mail address is already registered.'))

    // Without an e-mail the account has only the number.
    await user.clear(within(profile).getByLabelText('E-mail (optional)'))
    await user.click(within(profile).getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
    expect(registers).toEqual([{ name: 'Karim Uddin', email: 'karim@example.com' }, { name: 'Karim Uddin' }])
    expect(await screen.findByText('Signed in as 01811223344')).toBeInTheDocument()
    // No e-mail to verify yet.
    expect(screen.queryByTestId('verification-banner')).not.toBeInTheDocument()
  })

  it('explains a missing gateway, waits out a resend and starts over when the sign-up took too long', async () => {
    let sends = 0
    serve(() => null, {
      'POST /store/account/otp/send': () => {
        sends += 1
        if (sends === 1) return fail(422, 'SMS_UNAVAILABLE', 'No SMS')
        if (sends === 2) return fail(429, 'OTP_TOO_SOON', 'Too soon', { retry_after: 30 })
        return accepted({ resend_after: 1, expires_in: 300 })
      },
      'POST /store/account/otp/login': ok({ status: 'needs_profile', phone: '01911223344' }),
      'POST /store/account/otp/register': fail(422, 'OTP_SESSION_EXPIRED', 'Expired'),
    })
    renderRoutes(storefrontRoutes, '/account/login')
    const user = userEvent.setup()

    await user.type(await screen.findByRole('textbox', { name: 'Mobile number' }), '01911223344')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mobile number' })).toHaveAccessibleDescription('Text messages cannot be sent right now. Please try again later.'))

    // A code sent a moment ago: it can be typed while the countdown runs.
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait 30 seconds before asking for a new code.')
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent(/0:(30|29)/)
    await user.click(screen.getByRole('button', { name: 'Change number' }))
    expect(await screen.findByRole('textbox', { name: 'Mobile number' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Mobile number' }), '01911223344')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    // resend_after 1: the new-code link comes back.
    await user.click(await screen.findByRole('button', { name: 'Send a new code' }, { timeout: 4_000 }))
    await waitFor(() => expect(sends).toBe(4))
    await user.type(screen.getByLabelText('Code from the SMS'), '222222')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(await screen.findByLabelText('Full name'), 'Mina')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    // Back to the number, with the reason.
    expect(await screen.findByRole('alert')).toHaveTextContent('This took too long. Please enter your mobile number again.')
    expect(screen.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('')
  })

  it('keeps e-mail and password sign-in on its tab, and offers the mobile number on the registration page', async () => {
    let me: Customer | null = null
    const logins: unknown[] = []
    serve(() => me, {
      'POST /store/account/login': (init) => {
        logins.push(bodyOf(init))
        me = customerFixture()
        return ok({ customer: me, merge: null })
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/register?next=%2Fwishlist')
    const user = userEvent.setup()

    const phoneLink = await screen.findByRole('link', { name: 'Sign up with your mobile number' })
    expect(phoneLink).toHaveAttribute('href', '/account/login?next=%2Fwishlist')
    await user.click(phoneLink)
    const emailTab = await screen.findByRole('tab', { name: 'E-mail & password' })
    // Arrow keys move between the tabs.
    screen.getByRole('tab', { name: 'Mobile number' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(emailTab).toHaveAttribute('aria-selected', 'true')
    expect(emailTab).toHaveFocus()
    await user.type(screen.getByLabelText('E-mail'), 'rina@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/wishlist'))
    expect(logins).toEqual([{ email: 'rina@example.com', password: 'secret-pass', remember: false }])
  })

  it('shows only e-mail and password when the store cannot send codes', async () => {
    serve(() => null, {}, false)
    renderRoutes(storefrontRoutes, '/account/login')
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Track an order without signing in' })).toBeInTheDocument()
  })
})

describe('profile of a phone-only account', () => {
  it('verifies the mobile number, adds an e-mail once and sets the first password', async () => {
    let profile = customerFixture({ email: null, email_verified: false, phone: '01711223344', phone_verified: false, has_password: false })
    const calls: string[] = []
    serve(() => profile, {
      'GET /store/account/profile': () => ok(profile),
      'POST /store/account/otp/send': (init) => {
        calls.push(`send ${JSON.stringify(bodyOf(init))}`)
        return accepted({ resend_after: 60, expires_in: 300 })
      },
      'POST /store/account/profile/phone': (init) => {
        const body = bodyOf(init)
        calls.push(`verify ${JSON.stringify(body)}`)
        if (body.code !== '246810') return fail(422, 'OTP_EXPIRED', 'Expired')
        profile = { ...profile, phone_verified: true }
        return ok(profile)
      },
      'PUT /store/account/profile': (init) => {
        const body = bodyOf(init)
        calls.push(`profile ${JSON.stringify(body)}`)
        profile = { ...profile, name: String(body.name), email: (body.email as string | undefined) ?? profile.email }
        return ok(profile)
      },
      'PUT /store/account/password': (init) => {
        calls.push(`password ${JSON.stringify(bodyOf(init))}`)
        profile = { ...profile, has_password: true }
        return ok({ message: 'Saved' })
      },
    })
    renderRoutes(storefrontRoutes, '/account/profile')
    const user = userEvent.setup()

    const details = await screen.findByRole('form', { name: 'Your details' })
    const phoneState = screen.getByRole('region', { name: 'Verify your mobile number' })
    expect(phoneState).toHaveTextContent('01711223344')
    expect(phoneState).toHaveTextContent('Not verified')
    await user.click(within(phoneState).getByRole('button', { name: 'Verify' }))
    await user.click(within(phoneState).getByRole('button', { name: 'Send code' }))
    const code = await within(phoneState).findByLabelText('Code from the SMS')
    await user.type(code, '111111{Enter}')
    expect(await within(phoneState).findByRole('alert')).toHaveTextContent('This code has expired. Please ask for a new one.')
    await user.clear(code)
    await user.type(code, '246810')
    await user.click(within(phoneState).getByRole('button', { name: 'Verify' }))
    expect(await within(phoneState).findByTestId('phone-verified')).toHaveTextContent('Verified')
    expect(calls.slice(0, 3)).toEqual([
      'send {"phone":"01711223344","purpose":"verify_phone"}',
      'verify {"phone":"01711223344","code":"111111"}',
      'verify {"phone":"01711223344","code":"246810"}',
    ])

    // The e-mail can be added (once).
    const email = within(details).getByLabelText('E-mail (optional)')
    expect(email).toBeEnabled()
    await user.type(email, 'rina@example.com')
    await user.click(within(details).getByRole('button', { name: 'Save details' }))
    expect(await within(details).findByRole('status')).toHaveTextContent('Your details were saved.')
    expect(calls).toContain('profile {"name":"Rina Akter","phone":"01711223344","email":"rina@example.com"}')
    await waitFor(() => expect(within(details).getByLabelText('E-mail')).toHaveValue('rina@example.com'))
    expect(within(details).getByLabelText('E-mail')).toBeDisabled()

    // No current password to give.
    const password = screen.getByRole('form', { name: 'Set a password' })
    expect(within(password).queryByLabelText('Current password')).not.toBeInTheDocument()
    await user.type(within(password).getByLabelText('New password'), 'first-pass-1')
    await user.type(within(password).getByLabelText('Confirm new password'), 'first-pass-1')
    await user.click(within(password).getByRole('button', { name: 'Set password' }))
    expect(await within(password).findByRole('status')).toHaveTextContent('Your password was set.')
    expect(calls).toContain('password {"password":"first-pass-1","password_confirmation":"first-pass-1"}')
    expect(within(password).queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('shows a verified number as verified and asks again when another number is typed', async () => {
    serve(() => customerFixture({ phone_verified: true }), {
      'GET /store/account/profile': ok(customerFixture({ phone_verified: true })),
    })
    renderRoutes(storefrontRoutes, '/account/profile')
    const user = userEvent.setup()

    const phoneState = await screen.findByRole('region', { name: 'Verify your mobile number' })
    expect(within(phoneState).getByTestId('phone-verified')).toHaveTextContent('Verified')
    const details = screen.getByRole('form', { name: 'Your details' })
    expect(within(details).getByLabelText('E-mail')).toBeDisabled()
    await user.clear(within(details).getByLabelText('Mobile number (optional)'))
    // No state while the number is incomplete.
    expect(screen.queryByRole('region', { name: 'Verify your mobile number' })).not.toBeInTheDocument()
    await user.type(within(details).getByLabelText('Mobile number (optional)'), '01999888777')
    const typed = screen.getByRole('region', { name: 'Verify your mobile number' })
    expect(typed).toHaveTextContent('01999888777')
    expect(typed).toHaveTextContent('Not verified')
    expect(within(typed).getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })
})

describe('phone sign-in in Bangla', () => {
  afterEach(() => resetLocale())

  it('asks for the number and translates the code errors', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap({}, { account: { phone_login: true } })),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'POST /store/account/otp/send': fail(429, 'OTP_LIMIT', 'Too many'),
    })
    renderRoutes(storefrontRoutes, '/account/login?lang=bn')
    const user = userEvent.setup()

    expect(await screen.findByRole('tab', { name: 'মোবাইল নম্বর' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'ই-মেইল ও পাসওয়ার্ড' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'সাইন ইন না করেই অর্ডার ট্র্যাক করুন' })).toHaveAttribute('href', '/track-order')
    await user.click(screen.getByRole('button', { name: 'কোড পাঠান' }))
    expect(screen.getByRole('textbox', { name: 'মোবাইল নম্বর' })).toHaveAccessibleDescription('অনুগ্রহ করে একটি মোবাইল নম্বর লিখুন।')
    await user.type(screen.getByRole('textbox', { name: 'মোবাইল নম্বর' }), '০১৭১১২২৩৩৪৪')
    await user.click(screen.getByRole('button', { name: 'কোড পাঠান' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'মোবাইল নম্বর' })).toHaveAccessibleDescription('অনেকবার কোড চাওয়া হয়েছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।'))
  })
})
