import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { addressFixture, bootstrapFixture, cartFixture, cartLine, customerFixture } from './test-fixtures'
import type { Customer, CustomerAddress } from './types'
import { LOCAL_WISHLIST_KEY } from './wishlist/local-wishlist'

// The sign-in notice when the merged guest cart was capped to the stock (account.notice.capped).
const CAPPED_NOTICE = 'Some items from your earlier cart were reduced to the quantity in stock. Please check your cart.'

afterEach(() => localStorage.clear())

type Routes = Parameters<typeof mockApi>[0]

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

/** Bootstrap, an empty homepage, the customer (`me` is read through a getter so sign-in can change it) and a cart. */
function serve(me: () => Customer | null, routes: Routes = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/account/me': () => ok(me()),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
}

describe('sign-in', () => {
  it('sends guests from account pages to sign in, then back, merging the guest wishlist and cart', async () => {
    localStorage.setItem(LOCAL_WISHLIST_KEY, JSON.stringify([{ product_id: 'p-1', slug: 'kids-tee', variant_id: null }, { product_id: 'p-2', slug: 'kids-cap', variant_id: 'v-9' }]))
    let me: Customer | null = null
    let cartReads = 0
    const calls: string[] = []
    serve(() => me, {
      'POST /store/account/login': (init) => {
        calls.push(`login ${JSON.stringify(bodyOf(init))}`)
        me = customerFixture()
        return ok({ customer: me, merge: { merged_lines: 2, capped_lines: 1 } })
      },
      'POST /store/wishlist/merge': (init) => {
        calls.push(`merge ${JSON.stringify(bodyOf(init))}`)
        return ok({ items: [] })
      },
      'GET /store/cart': () => {
        cartReads += 1
        return ok(me ? cartFixture([cartLine('l-1')], { item_count: '2' }) : cartFixture())
      },
      'GET /store/account/addresses': ok([addressFixture('a-1')]),
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/addresses')
    const user = userEvent.setup()

    await waitFor(() => expect(router.state.location.pathname).toBe('/account/login'))
    expect(router.state.location.search).toBe('?next=%2Faccount%2Faddresses')
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Sign in | Berry Kids'))
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/account/register?next=%2Faccount%2Faddresses')

    await user.type(screen.getByLabelText('E-mail'), 'rina@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret-pass')
    await user.click(screen.getByLabelText('Keep me signed in'))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/account/addresses'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Addresses' })).toBeInTheDocument()
    expect(calls).toEqual([
      'login {"email":"rina@example.com","password":"secret-pass","remember":true}',
      'merge {"items":[{"product_id":"p-1"},{"product_id":"p-2","variant_id":"v-9"}]}',
    ])
    expect(localStorage.getItem(LOCAL_WISHLIST_KEY)).toBeNull()
    expect(await screen.findByText(CAPPED_NOTICE)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cart, 2 items' })).toBeInTheDocument()
    expect(cartReads).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'My account' })).toBeInTheDocument()
  })

  it('validates, shows wrong credentials without saying which, and keeps the e-mail', async () => {
    serve(() => null, { 'POST /store/account/login': fail(422, 'INVALID_CREDENTIALS', 'These credentials do not match our records.') })
    renderRoutes(storefrontRoutes, '/account/login')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('E-mail')).toHaveAccessibleDescription('Please enter your e-mail address.')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Please enter your password.')

    await user.type(screen.getByLabelText('E-mail'), 'rina@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The e-mail address or password is incorrect.')
    expect(screen.getByLabelText('E-mail')).toHaveValue('rina@example.com')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('never follows an off-site ?next=, and sends signed-in customers on from guest pages', async () => {
    let me: Customer | null = null
    serve(() => me, {
      'POST /store/account/login': () => {
        me = customerFixture()
        return ok({ customer: me, merge: null })
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/login?next=%2F%2Fevil.test%2Fphish')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-mail'), 'rina@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
    expect(await screen.findByRole('heading', { level: 1, name: 'My account' })).toBeInTheDocument()

    await router.navigate('/account/register')
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
  })
})

describe('registration', () => {
  it('maps server field errors, then signs in and shows the verification banner with resend', async () => {
    let me: Customer | null = null
    let attempts = 0
    const resends: number[] = []
    serve(() => me, {
      'POST /store/account/register': (init) => {
        attempts += 1
        const body = bodyOf(init)
        if (attempts === 1) return fail(422, 'VALIDATION_FAILED', 'Invalid', { email: ['This e-mail address is already registered.'] })
        expect(body).toEqual({ name: 'Rina Akter', email: 'rina2@example.com', phone: '01712345678', password: 'long-enough', password_confirmation: 'long-enough' })
        me = customerFixture({ email: 'rina2@example.com', email_verified: false })
        return { status: 201, body: { success: true, data: { customer: me, merge: { merged_lines: 0, capped_lines: 0 } }, meta: { request_id: 't' } } }
      },
      'POST /store/account/verification-notification': () => {
        resends.push(1)
        return ok({ message: 'Sent' })
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/register')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Full name'), 'Rina Akter')
    await user.type(screen.getByLabelText('E-mail'), 'rina@example.com')
    await user.type(screen.getByLabelText('Mobile number (optional)'), '+88 017-1234-5678')
    await user.type(screen.getByLabelText('Password'), 'long-enough')
    await user.type(screen.getByLabelText('Confirm password'), 'different')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription('The passwords do not match.')
    expect(attempts).toBe(0)

    await user.clear(screen.getByLabelText('Confirm password'))
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveAccessibleDescription('This e-mail address is already registered.'))
    expect(screen.getByLabelText('E-mail')).toHaveFocus()

    await user.clear(screen.getByLabelText('E-mail'))
    await user.type(screen.getByLabelText('E-mail'), 'rina2@example.com')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
    const banner = await screen.findByTestId('verification-banner')
    expect(banner).toHaveTextContent('We sent a link to rina2@example.com')
    expect(screen.queryByText(CAPPED_NOTICE)).not.toBeInTheDocument()
    await user.click(within(banner).getByRole('button', { name: 'Resend verification e-mail' }))
    expect(await within(banner).findByRole('status')).toHaveTextContent('A new verification e-mail is on its way.')
    expect(resends).toHaveLength(1)
  })
})

describe('password reset and e-mail verification', () => {
  it('answers a reset request the same way whatever the e-mail', async () => {
    const bodies: unknown[] = []
    serve(() => null, {
      'POST /store/account/forgot-password': (init) => {
        bodies.push(bodyOf(init))
        return ok({ message: 'ok' })
      },
    })
    renderRoutes(storefrontRoutes, '/account/forgot-password')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-mail'), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText(/If an account exists for this e-mail address/)).toBeInTheDocument()
    expect(bodies).toEqual([{ email: 'nobody@example.com' }])
  })

  it('resets the password from the e-mail link and signs the customer in', async () => {
    let me: Customer | null = null
    const bodies: unknown[] = []
    serve(() => me, {
      'POST /store/account/reset-password': (init) => {
        bodies.push(bodyOf(init))
        if (bodies.length === 1) return fail(422, 'VALIDATION_FAILED', 'Invalid', { token: ['This password reset link is invalid or has expired.'] })
        me = customerFixture()
        return ok({ customer: me, merge: null })
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/account/reset-password?token=tok-1&email=rina%40example.com')
    const user = userEvent.setup()

    expect(await screen.findByLabelText('E-mail')).toHaveValue('rina@example.com')
    await user.type(screen.getByLabelText('New password'), 'new-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password')
    await user.click(screen.getByRole('button', { name: 'Save password and sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This password reset link is invalid or has expired.')

    await user.click(screen.getByRole('button', { name: 'Save password and sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
    expect(bodies[1]).toEqual({ email: 'rina@example.com', token: 'tok-1', password: 'new-password', password_confirmation: 'new-password' })
  })

  it('explains an incomplete reset link', async () => {
    serve(() => null)
    renderRoutes(storefrontRoutes, '/account/reset-password')
    expect(await screen.findByText(/This link is incomplete/)).toBeInTheDocument()
  })

  it('verifies the e-mail address once on arrival', async () => {
    const bodies: unknown[] = []
    serve(() => customerFixture({ email_verified: false }), {
      'POST /store/account/verify-email': (init) => {
        bodies.push(bodyOf(init))
        return ok({ message: 'Verified' })
      },
    })
    renderRoutes(storefrontRoutes, '/account/verify-email?token=abc')

    expect(await screen.findByText('Thank you — your e-mail address is verified.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to my account' })).toHaveAttribute('href', '/account')
    expect(bodies).toEqual([{ token: 'abc' }])
  })

  it('reports an expired verification link and offers a new one', async () => {
    serve(() => customerFixture({ email_verified: false }), {
      'POST /store/account/verify-email': fail(422, 'TOKEN_INVALID', 'This verification link is invalid or has expired.'),
      'POST /store/account/verification-notification': ok({ message: 'Sent' }),
    })
    renderRoutes(storefrontRoutes, '/account/verify-email?token=old')
    const user = userEvent.setup()

    expect(await screen.findByRole('alert')).toHaveTextContent('This verification link is invalid or has expired.')
    await user.click(screen.getByRole('button', { name: 'Send a new verification e-mail' }))
    expect(await screen.findByText('A new verification e-mail is on its way.')).toBeInTheDocument()
  })
})

describe('profile', () => {
  it('saves details and maps a wrong current password onto its field', async () => {
    const puts: unknown[] = []
    serve(() => customerFixture(), {
      'GET /store/account/profile': ok(customerFixture()),
      'PUT /store/account/profile': (init) => {
        puts.push(bodyOf(init))
        return ok(customerFixture({ name: 'Rina A.', phone: null }))
      },
      'PUT /store/account/password': fail(422, 'VALIDATION_FAILED', 'Invalid', { current_password: ['The current password is incorrect.'] }),
    })
    renderRoutes(storefrontRoutes, '/account/profile')
    const user = userEvent.setup()

    const details = await screen.findByRole('form', { name: 'Your details' })
    await waitFor(() => expect(document.title).toBe('Profile | Berry Kids'))
    expect(within(details).getByLabelText('E-mail')).toHaveValue('rina@example.com')
    const name = within(details).getByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'Rina A.')
    await user.clear(within(details).getByLabelText('Mobile number (optional)'))
    await user.click(within(details).getByRole('button', { name: 'Save details' }))
    expect(await within(details).findByRole('status')).toHaveTextContent('Your details were saved.')
    expect(puts).toEqual([{ name: 'Rina A.', phone: null }])

    const password = screen.getByRole('form', { name: 'Change password' })
    await user.type(within(password).getByLabelText('Current password'), 'nope')
    await user.type(within(password).getByLabelText('New password'), 'another-pass')
    await user.type(within(password).getByLabelText('Confirm new password'), 'another-pass')
    await user.click(within(password).getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(within(password).getByLabelText('Current password')).toHaveAccessibleDescription('The current password is incorrect.'))
  })
})

describe('addresses', () => {
  const divisions = [
    { id: 3, name: 'Dhaka', name_bn: 'ঢাকা' },
    { id: 6, name: 'Sylhet', name_bn: 'সিলেট' },
  ]
  const districts: Record<string, unknown[]> = {
    '3': [{ id: 47, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }, { id: 48, division_id: 3, name: 'Gazipur', name_bn: 'গাজীপুর' }],
    '6': [{ id: 60, division_id: 6, name: 'Sylhet', name_bn: 'সিলেট' }],
  }

  function serveAddresses(initial: CustomerAddress[]) {
    let list = initial
    const calls: string[] = []
    serve(() => customerFixture(), {
      'GET /store/account/addresses': () => ok(list),
      'GET /store/geo/divisions': ok(divisions),
      'GET /store/geo/districts': (_init, url) => ok(districts[url.searchParams.get('division') ?? ''] ?? []),
      'POST /store/account/addresses': (init) => {
        const body = bodyOf(init)
        calls.push(`create ${JSON.stringify(body)}`)
        if (calls.length === 1) return fail(422, 'VALIDATION_FAILED', 'Invalid', { phone: ['The phone must be a Bangladeshi mobile number.'] })
        list = [...list, addressFixture('a-2', { label: 'Office', division: { id: 6, name: 'Sylhet' }, district: { id: 60, name: 'Sylhet' }, is_default_shipping: false, is_default_billing: false })]
        return { status: 201, body: { success: true, data: list[list.length - 1], meta: { request_id: 't' } } }
      },
      'PATCH /store/account/addresses/a-2': (init) => {
        calls.push(`patch ${JSON.stringify(bodyOf(init))}`)
        list = list.map((a) => ({ ...a, is_default_shipping: a.id === 'a-2' }))
        return ok(list.find((a) => a.id === 'a-2'))
      },
      'DELETE /store/account/addresses/a-1': () => {
        calls.push('delete a-1')
        list = list.filter((a) => a.id !== 'a-1')
        return { status: 204 }
      },
    })
    return calls
  }

  it('adds an address with division and district, makes it the default and deletes another after confirming', async () => {
    const calls = serveAddresses([addressFixture('a-1')])
    renderRoutes(storefrontRoutes, '/account/addresses')
    const user = userEvent.setup()

    const list = await screen.findByRole('list', { name: 'Saved addresses' })
    expect(within(list).getAllByTestId('address-card')).toHaveLength(1)
    expect(within(list).getByText('Default')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add address' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an address' })
    const district = within(dialog).getByLabelText('District')
    expect(within(district).getByRole('option', { name: 'Choose a division first' })).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByLabelText('Division')).toBeEnabled())
    await user.selectOptions(within(dialog).getByLabelText('Division'), '6')
    await waitFor(() => expect(within(dialog).getByLabelText('District')).toBeEnabled())
    await user.selectOptions(within(dialog).getByLabelText('District'), '60')
    await user.type(within(dialog).getByLabelText('Label (optional)'), 'Office')
    await user.type(within(dialog).getByLabelText('Recipient name'), 'Rina Akter')
    await user.type(within(dialog).getByLabelText('Mobile number'), '123')
    await user.type(within(dialog).getByLabelText('Area / thana'), 'Zindabazar')
    await user.type(within(dialog).getByLabelText('Street address'), 'Road 3, House 9')
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }))
    expect(within(dialog).getByLabelText('Mobile number')).toHaveAccessibleDescription('Please enter a Bangladeshi mobile number, e.g. 01712345678.')
    expect(calls).toEqual([])

    await user.clear(within(dialog).getByLabelText('Mobile number'))
    await user.type(within(dialog).getByLabelText('Mobile number'), '+8801812345678')
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }))
    await waitFor(() => expect(within(dialog).getByLabelText('Mobile number')).toHaveAccessibleDescription('The phone must be a Bangladeshi mobile number.'))
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const expected = {
      label: 'Office',
      recipient_name: 'Rina Akter',
      phone: '01812345678',
      division_id: 6,
      district_id: 60,
      area: 'Zindabazar',
      address_line: 'Road 3, House 9',
      postcode: null,
      is_default_shipping: false,
      is_default_billing: false,
    }
    expect(calls[1]).toBe(`create ${JSON.stringify(expected)}`)
    await waitFor(() => expect(screen.getAllByTestId('address-card')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Make Office the default address' }))
    await waitFor(() => expect(calls).toContain('patch {"is_default_shipping":true}'))

    await user.click(screen.getByRole('button', { name: 'Delete Home' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this address?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete address' }))
    await waitFor(() => expect(screen.getAllByTestId('address-card')).toHaveLength(1))
    expect(calls.at(-1)).toBe('delete a-1')
  })

  it('edits an address with its saved division and district', async () => {
    serveAddresses([addressFixture('a-1')])
    renderRoutes(storefrontRoutes, '/account/addresses')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit Home' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit address' })
    await waitFor(() => expect(within(dialog).getByLabelText('District')).toHaveValue('47'))
    expect(within(dialog).getByLabelText('Division')).toHaveValue('3')
    expect(within(dialog).getByText(/This is your default delivery address/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('account overview', () => {
  it('greets the customer, links the account sections and signs out to the home page', async () => {
    serve(() => customerFixture(), { 'POST /store/account/logout': { status: 204 } })
    const { router } = renderRoutes(storefrontRoutes, '/account')
    const user = userEvent.setup()

    expect(await screen.findByText('Rina Akter', { selector: 'strong' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('My account | Berry Kids'))
    expect(screen.queryByTestId('verification-banner')).not.toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Account' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Addresses' })).toHaveAttribute('href', '/account/addresses')

    await user.click(within(nav).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })
})
