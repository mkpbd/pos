import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import {
  addressFixture,
  bootstrapFixture,
  cartFixture,
  cartLine,
  checkoutOptionsFixture,
  customerFixture,
  orderFixture,
  previewFixture,
  shippingMethodFixture,
} from './test-fixtures'
import type { Cart, CheckoutOptions, CheckoutPreview, Customer, CustomerAddress, ShippingMethod } from './types'

// Long form flows with a debounced, server-computed summary: generous limits for a loaded CI box.
vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

type Routes = Parameters<typeof mockApi>[0]
type Body = Record<string, unknown> & { address?: { district_id?: unknown }; shipping_address_id?: string; shipping_method_id?: string; payment_method?: string; expected_total?: string }

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Body
const headerOf = (init: RequestInit, name: string) => (init.headers as Record<string, string> | undefined)?.[name]

const home = shippingMethodFixture('sm-home')
const express = shippingMethodFixture('sm-express', { name: 'Express', description: null, fee: '150.00', free_over: null, cod_allowed: false, eta_min_days: 0, eta_max_days: 0 })
const courier = shippingMethodFixture('sm-courier', { name: 'Courier delivery', description: null, fee: '120.00', free_over: null, cod_fee: '20.00', eta_min_days: 3, eta_max_days: 5 })

const money = (n: number) => n.toFixed(2)

/** The server's preview: the cart (900.00, VAT included) + the chosen method's fee + the COD fee. */
function previewFor(body: Body, methodsFor: (district: string) => ShippingMethod[] = (d) => (d === '47' ? [home, express] : [courier])): CheckoutPreview {
  const district = body.shipping_address_id ? '47' : body.address?.district_id !== undefined ? String(body.address.district_id) : null
  if (!district) return previewFixture({ payment_method: (body.payment_method as 'cod') ?? null })
  const methods = methodsFor(district)
  const method = methods.find((m) => m.id === body.shipping_method_id) ?? methods[0]
  if (!method) return previewFixture({ shipping_methods: [] })
  const cod = body.payment_method === 'cod' ? Number(method.cod_fee) : 0
  return previewFixture({
    shipping_methods: methods,
    shipping_method_id: method.id,
    shipping_total: method.fee,
    cod_fee: money(cod),
    total: money(900 + Number(method.fee) + cod),
    payment_method: (body.payment_method as 'cod') ?? null,
  })
}

type ServeOptions = { me?: Customer | null; cart?: () => Cart; options?: CheckoutOptions; addresses?: CustomerAddress[]; routes?: Routes }

function serve({ me = null, cart = () => cartFixture([cartLine('l-1')]), options = checkoutOptionsFixture(), addresses = [], routes = {} }: ServeOptions = {}) {
  const previews: Body[] = []
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(me),
    'GET /store/cart': () => ok(cart()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/checkout/options': ok({ ...options, signed_in: me !== null }),
    'GET /store/account/addresses': ok(addresses),
    'GET /store/geo/divisions': ok([
      { id: 3, name: 'Dhaka', name_bn: null },
      { id: 7, name: 'Sylhet', name_bn: null },
    ]),
    'GET /store/geo/districts': (_init, url) =>
      ok(url.searchParams.get('division') === '3' ? [{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }] : [{ id: 58, division_id: 7, name: 'Moulvibazar', name_bn: null }]),
    'POST /store/checkout/preview': (init) => {
      const body = bodyOf(init)
      previews.push(body)
      return ok(previewFor(body))
    },
    ...routes,
  })
  return { fetchMock, previews }
}

async function fillGuestForm(user: ReturnType<typeof userEvent.setup>, district: { division: string; district: string } = { division: '3', district: '47' }) {
  await user.type(await screen.findByLabelText('Full name'), 'Karim Uddin')
  await user.type(screen.getByLabelText('E-mail'), 'karim@example.com')
  await user.type(screen.getByLabelText('Mobile number'), '01811-223344')
  await user.selectOptions(screen.getByLabelText('Division'), district.division)
  await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('District'), district.district)
  await user.type(screen.getByLabelText('Area / thana'), 'Mirpur')
  await user.type(screen.getByLabelText('Street address'), 'Road 3, House 9')
}

const placeButton = () => screen.getByRole('button', { name: /place order/i })
const waitForReady = () => waitFor(() => expect(placeButton()).toBeEnabled())

describe('checkout as a guest', () => {
  it('places a cash on delivery order with an Idempotency-Key and lands on the confirmation page with an empty cart', async () => {
    let placed = false
    const places: { body: Body; key: string | undefined }[] = []
    const { previews } = serve({
      cart: () => (placed ? cartFixture() : cartFixture([cartLine('l-1')])),
      routes: {
        'POST /store/checkout': (init) => {
          places.push({ body: bodyOf(init), key: headerOf(init, 'Idempotency-Key') })
          placed = true
          return { status: 201, body: { success: true, data: { order: orderFixture({ contact: { name: 'Karim Uddin', email: 'karim@example.com', phone: '01811223344' } }), access_token: 'guest-token-123' }, meta: { request_id: 't' } } }
        },
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Checkout | Berry Kids'))
    expect(screen.getByRole('link', { name: 'Sign in for faster checkout' })).toHaveAttribute('href', '/account/login?next=%2Fcheckout')
    const summary = screen.getByTestId('order-summary')
    expect(await within(summary).findByTestId('summary-total')).toHaveTextContent('৳900.00')
    expect(within(summary).getByTestId('summary-shipping')).toHaveTextContent('Choose an address')
    expect(screen.getByText('Choose a delivery address to see the delivery options.')).toBeInTheDocument()

    await fillGuestForm(user)
    // The recipient follows the contact details until edited.
    expect(screen.getByLabelText('Recipient name')).toHaveValue('Karim Uddin')
    expect(screen.queryByLabelText('Save this address to my account')).not.toBeInTheDocument()

    // The delivery methods of Dhaka; the first (server's choice) is selected and priced.
    const homeOption = await screen.findByRole('radio', { name: /Home delivery/ })
    await waitFor(() => expect(homeOption).toBeChecked())
    expect(screen.getByRole('radio', { name: /Express/ })).not.toBeChecked()
    expect(screen.getByRole('group', { name: 'Delivery method' })).toHaveTextContent('Delivery in 1–2 days · Free on orders of ৳2,000.00 or more')
    await waitFor(() => expect(within(summary).getByTestId('summary-total')).toHaveTextContent('৳960.00'))
    expect(within(summary).getByTestId('summary-shipping')).toHaveTextContent('৳60.00')
    expect(screen.getByTestId('summary-announcement')).toHaveTextContent('Order total ৳960.00')

    await user.click(screen.getByRole('radio', { name: /Cash on delivery/ }))
    await user.type(screen.getByLabelText('Notes for the delivery (optional)'), 'Call before coming')
    await waitForReady()
    await user.click(placeButton())

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/WEB-000001'))
    expect(places).toHaveLength(1)
    expect(places[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(places[0]!.body).toEqual({
      contact: { name: 'Karim Uddin', email: 'karim@example.com', phone: '01811223344' },
      address: { recipient_name: 'Karim Uddin', phone: '01811223344', division_id: 3, district_id: 47, area: 'Mirpur', address_line: 'Road 3, House 9' },
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
      notes: 'Call before coming',
      expected_total: '960.00',
    })
    expect(previews.at(-1)).toEqual({ address: { division_id: 3, district_id: 47 }, shipping_method_id: 'sm-home', payment_method: 'cod' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Thank you, Karim!' })).toBeInTheDocument()
    expect(screen.getByTestId('order-number')).toHaveTextContent('WEB-000001')
    expect(sessionStorage.getItem('sf:order-token:WEB-000001')).toBe('guest-token-123')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cart' })).toBeInTheDocument())
  })

  it('shows field errors and moves the focus to the first one', async () => {
    serve()
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await screen.findByLabelText('Full name')
    await waitForReady()
    await user.click(placeButton())

    expect(await screen.findByText('Please enter your name.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveFocus())
    expect(screen.getByText('Please choose a district.')).toBeInTheDocument()
    expect(screen.getByText('Please choose a payment method.')).toBeInTheDocument()
    expect(screen.getByText('Please choose a delivery method.')).toBeInTheDocument()
  })

  it('puts the server’s field errors on the fields and focuses the first', async () => {
    serve({ routes: { 'POST /store/checkout': fail(422, 'VALIDATION_FAILED', 'Invalid', { 'contact.email': ['This e-mail address is not valid.'], 'address.postcode': ['Unknown postcode.'] }) } })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await fillGuestForm(user)
    await user.click(await screen.findByRole('radio', { name: /Cash on delivery/ }))
    await waitForReady()
    await user.click(placeButton())

    expect(await screen.findByText('This e-mail address is not valid.')).toBeInTheDocument()
    expect(screen.getByText('Unknown postcode.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveFocus())
    expect(screen.getByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
  })

  it('asks guests to sign in when the store requires an account', async () => {
    serve({ options: checkoutOptionsFixture({ guest_checkout: false }) })
    renderRoutes(storefrontRoutes, '/checkout')
    expect(await screen.findByRole('heading', { name: 'Sign in to check out' })).toBeInTheDocument()
    const page = screen.getByTestId('checkout-page')
    expect(within(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?next=%2Fcheckout')
    expect(within(page).getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/account/register?next=%2Fcheckout')
    expect(screen.queryByRole('button', { name: /place order/i })).not.toBeInTheDocument()
  })

  it('shows the empty cart and an unavailable checkout', async () => {
    serve({ cart: () => cartFixture(), options: checkoutOptionsFixture({ available: false, reason: 'cart_empty' }) })
    const { unmount } = renderRoutes(storefrontRoutes, '/checkout')
    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start shopping' })).toHaveAttribute('href', '/shop')
    unmount()

    serve({ options: checkoutOptionsFixture({ available: false, reason: 'no_fulfilment_store' }) })
    renderRoutes(storefrontRoutes, '/checkout')
    expect(await screen.findByRole('heading', { name: 'Checkout is not available' })).toBeInTheDocument()
  })

  it('says when a district is not served, and when a delivery method does not take cash on delivery', async () => {
    serve({
      routes: {
        'POST /store/checkout/preview': (init) => {
          const body = bodyOf(init)
          return ok(previewFor(body, (district) => (district === '47' ? [express] : [])))
        },
      },
    })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await fillGuestForm(user, { division: '7', district: '58' })
    expect(await screen.findByTestId('shipping-unavailable')).toHaveTextContent('we do not deliver to this district')

    await user.selectOptions(screen.getByLabelText('Division'), '3')
    await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('District'), '47')
    // Only express: selected for the shopper; it does not take cash on delivery.
    await waitFor(() => expect(screen.getByRole('radio', { name: /Express/ })).toBeChecked())
    expect(screen.getByRole('radio', { name: /Cash on delivery/ })).toBeDisabled()
    expect(screen.getByText('Not available with Express.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Bank transfer/ })).toBeEnabled()
  })
})

describe('checkout as a customer', () => {
  it('uses the default saved address and contact details, pays by bank transfer', async () => {
    const places: Body[] = []
    const { previews } = serve({
      me: customerFixture(),
      addresses: [addressFixture('a-1', { label: 'Office', is_default_shipping: false }), addressFixture('a-2')],
      routes: {
        'POST /store/checkout': (init) => {
          places.push(bodyOf(init))
          return { status: 201, body: { success: true, data: { order: orderFixture({ status: 'pending_payment', status_label: 'Awaiting payment', payment_method: 'bank_transfer', payment_method_label: 'Bank transfer', payment_instructions: 'Demo Bank\nAccount 0000000000', expires_at: '2026-11-02T10:00:00+06:00' }), access_token: null }, meta: { request_id: 't' } } }
        },
      },
    })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()

    expect(await screen.findByLabelText('Full name')).toHaveValue('Rina Akter')
    expect(screen.getByLabelText('E-mail')).toHaveValue('rina@example.com')
    expect(screen.queryByRole('link', { name: 'Sign in for faster checkout' })).not.toBeInTheDocument()
    const book = screen.getByRole('group', { name: 'Delivery address' })
    const options = within(book).getAllByRole('radio')
    expect(options).toHaveLength(3)
    expect(within(book).getByRole('radio', { name: /^Home/ })).toBeChecked()
    expect(screen.queryByTestId('new-address')).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('radio', { name: /Home delivery/ })).toBeChecked())
    await user.click(screen.getByRole('radio', { name: /Bank transfer/ }))
    await waitForReady()
    await user.click(placeButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Thank you, Rina!' })).toBeInTheDocument()
    expect(places[0]).toEqual({
      contact: { name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' },
      shipping_address_id: 'a-2',
      shipping_method_id: 'sm-home',
      payment_method: 'bank_transfer',
      expected_total: '960.00',
    })
    expect(previews[0]).toEqual({ shipping_address_id: 'a-2' })
    const instructions = screen.getByTestId('payment-instructions')
    expect(instructions).toHaveTextContent('Demo Bank')
    expect(instructions).toHaveTextContent('Please transfer ৳960.00')
    expect(within(instructions).getByTestId('payment-deadline').querySelector('time')).toHaveAttribute('dateTime', '2026-11-02T10:00:00+06:00')
    expect(sessionStorage.length).toBe(0)
  })

  it('can deliver to a new address and save it', async () => {
    const places: Body[] = []
    serve({
      me: customerFixture(),
      addresses: [addressFixture('a-1')],
      routes: {
        'POST /store/checkout': (init) => {
          places.push(bodyOf(init))
          return { status: 201, body: { success: true, data: { order: orderFixture(), access_token: null }, meta: { request_id: 't' } } }
        },
      },
    })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Use a new address' }))
    expect(screen.getByLabelText('Save this address to my account')).toBeChecked()
    await user.selectOptions(screen.getByLabelText('Division'), '7')
    await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('District'), '58')
    await user.type(screen.getByLabelText('Area / thana'), 'Sreemangal')
    await user.type(screen.getByLabelText('Street address'), 'Tea Garden Road 4')
    await waitFor(() => expect(screen.getByRole('radio', { name: /Courier delivery/ })).toBeChecked())
    await user.click(screen.getByRole('radio', { name: /Cash on delivery/ }))
    expect(screen.getByText('A cash on delivery fee of ৳20.00 applies.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('summary-cod-fee')).toHaveTextContent('৳20.00'))
    expect(screen.getByTestId('summary-total')).toHaveTextContent('৳1,040.00')
    await waitForReady()
    await user.click(placeButton())

    await screen.findByRole('heading', { level: 1, name: /Thank you/ })
    expect(places[0]).toMatchObject({ address: { district_id: 58, area: 'Sreemangal', recipient_name: 'Rina Akter' }, save_address: true, expected_total: '1040.00' })
  })
})

describe('placement errors', () => {
  async function placeWith(routes: Routes, me: Customer | null = customerFixture()) {
    const result = serve({ me, addresses: [addressFixture('a-1')], routes })
    const rendered = renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByRole('radio', { name: /Home delivery/ })).toBeChecked())
    await user.click(screen.getByRole('radio', { name: /Cash on delivery/ }))
    await waitForReady()
    await user.click(placeButton())
    return { ...result, ...rendered, user }
  }

  it('re-confirms a changed total with a new key, then places the order', async () => {
    const places: { body: Body; key: string | undefined }[] = []
    const { router, user } = await placeWith({
      'POST /store/checkout': (init) => {
        const body = bodyOf(init)
        places.push({ body, key: headerOf(init, 'Idempotency-Key') })
        if (body.expected_total !== '1010.00') return fail(409, 'TOTAL_CHANGED', 'The total changed.', { preview: { ...previewFor(body), subtotal: '950.00', total: '1010.00' } })
        return { status: 201, body: { success: true, data: { order: orderFixture({ total: '1010.00' }), access_token: null }, meta: { request_id: 't' } } }
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The total of your order changed from ৳960.00 to ৳1,010.00')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.getByTestId('summary-total')).toHaveTextContent('৳1,010.00')
    expect(screen.getByTestId('summary-announcement')).toHaveTextContent('Order total ৳1,010.00')
    const confirm = screen.getByRole('button', { name: 'Confirm new total and place order' })
    await user.click(confirm)

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/WEB-000001'))
    expect(places.map((p) => p.body.expected_total)).toEqual(['960.00', '1010.00'])
    expect(places[1]!.key).not.toBe(places[0]!.key)
  })

  it('retries an interrupted attempt with the same key', async () => {
    const keys: (string | undefined)[] = []
    const { user } = await placeWith({
      'POST /store/checkout': (init) => {
        keys.push(headerOf(init, 'Idempotency-Key'))
        return keys.length === 1 ? fail(503, 'SERVICE_UNAVAILABLE', 'down') : { status: 201, body: { success: true, data: { order: orderFixture(), access_token: null }, meta: { request_id: 't' } } }
      },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('your order will not be placed twice')
    await user.click(placeButton())
    await screen.findByRole('heading', { level: 1, name: /Thank you/ })
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('sends the shopper back to the cart when it has issues', async () => {
    const flagged = cartFixture([cartLine('l-1', { exceeds_stock: true, max_quantity: '1.000' })], { issues: ['exceeds_stock'] })
    await placeWith({ 'POST /store/checkout': fail(422, 'CART_HAS_ISSUES', 'Cart has issues', { cart: flagged }) })
    const alert = await screen.findByTestId('checkout-problem')
    expect(alert).toHaveTextContent('Please review your cart before placing the order.')
    expect(within(alert).getByRole('link', { name: 'Review your cart' })).toHaveAttribute('href', '/cart')
    expect(screen.getByTestId('checkout-cart-issues')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    expect(placeButton()).toHaveAccessibleDescription('Please fix your cart before placing the order.')
  })

  it.each([
    ['INSUFFICIENT_STOCK', 'some items sold out', null],
    ['SHIPPING_UNAVAILABLE', 'We cannot deliver to this address', 'Home delivery'],
    ['PAYMENT_METHOD_UNAVAILABLE', 'The chosen payment method is not available', 'Cash on delivery'],
    ['CHECKOUT_UNAVAILABLE', 'Online ordering is not available right now', null],
  ])('explains %s', async (code, message, focused) => {
    await placeWith({ 'POST /store/checkout': fail(422, code, code) })
    const alert = await screen.findByTestId('checkout-problem')
    expect(alert).toHaveTextContent(message)
    if (focused) await waitFor(() => expect(screen.getByRole('radio', { name: new RegExp(focused) })).toHaveFocus())
    else await waitFor(() => expect(alert).toHaveFocus())
  })

  it('asks a guest to sign in when guest checkout was switched off meanwhile', async () => {
    serve({ routes: { 'POST /store/checkout': fail(422, 'GUEST_CHECKOUT_DISABLED', 'Sign in') } })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await fillGuestForm(user)
    await user.click(await screen.findByRole('radio', { name: /Cash on delivery/ }))
    await waitForReady()
    await user.click(placeButton())
    const alert = await screen.findByTestId('checkout-problem')
    expect(within(alert).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?next=%2Fcheckout')
  })
})

describe('cart checkout buttons', () => {
  it('leads from the cart and the mini-cart to checkout', async () => {
    serve({ routes: { 'GET /store/homepage': ok({ sections: [], preview: false }) } })
    const { router } = renderRoutes(storefrontRoutes, '/cart')
    const user = userEvent.setup()
    const page = await screen.findByTestId('cart-page')
    expect(await within(page).findByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout')

    await user.click(screen.getByRole('button', { name: /^Cart/ }))
    const drawer = await screen.findByRole('dialog', { name: /Your cart/ })
    await user.click(within(drawer).getByRole('link', { name: 'Checkout' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/checkout'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('order page', () => {
  it('takes the guest token from the link, keeps it for the tab and removes it from the address', async () => {
    const tokens: (string | null)[] = []
    serve({ routes: { 'GET /store/orders/WEB-000001': (_init, url) => (tokens.push(url.searchParams.get('token')), ok(orderFixture())) } })
    const { router, unmount } = renderRoutes(storefrontRoutes, '/order/WEB-000001?token=secret-token')

    expect(await screen.findByRole('heading', { level: 1, name: 'Order WEB-000001' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Order WEB-000001 | Berry Kids'))
    expect(tokens).toEqual(['secret-token'])
    expect(sessionStorage.getItem('sf:order-token:WEB-000001')).toBe('secret-token')
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByTestId('order-status')).toHaveTextContent('Confirmed')
    expect(screen.getByTestId('order-payment')).toHaveTextContent('Cash on delivery · Pay on delivery')
    expect(screen.getAllByTestId('order-line')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Kids Tee' })).toHaveAttribute('href', '/product/kids-tee')
    expect(screen.getByTestId('summary-shipping')).toHaveTextContent('৳60.00')
    expect(screen.getByTestId('summary-total')).toHaveTextContent('৳960.00')
    expect(screen.getByText('Home delivery — usually 1–2 days')).toBeInTheDocument()
    expect(within(screen.getByTestId('order-history')).getByText('Confirmed')).toBeInTheDocument()
    expect(screen.queryByTestId('payment-instructions')).not.toBeInTheDocument()
    unmount()

    // A reload (no token in the address any more) uses the kept token.
    serve({ routes: { 'GET /store/orders/WEB-000001': (_init, url) => (tokens.push(url.searchParams.get('token')), ok(orderFixture())) } })
    renderRoutes(storefrontRoutes, '/order/WEB-000001')
    await screen.findByRole('heading', { level: 1, name: 'Order WEB-000001' })
    expect(tokens).toEqual(['secret-token', 'secret-token'])
  })

  it('shows bank transfer instructions with the deadline and the courier', async () => {
    serve({
      routes: {
        'GET /store/orders/WEB-000002': ok(
          orderFixture({
            number: 'WEB-000002',
            status: 'pending_payment',
            status_label: 'Awaiting payment',
            payment_method: 'bank_transfer',
            payment_method_label: 'Bank transfer',
            payment_instructions: 'Demo Bank, account 0000000000 — demo only',
            expires_at: '2026-11-02T10:00:00Z',
            courier_name: 'Pathao',
            tracking_number: 'PX-1',
            prices_include_tax: false,
            tax_total: '135.00',
          }),
        ),
      },
    })
    renderRoutes(storefrontRoutes, '/order/WEB-000002')
    const instructions = await screen.findByTestId('payment-instructions')
    expect(within(instructions).getByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    expect(instructions).toHaveTextContent('Demo Bank, account 0000000000 — demo only')
    expect(instructions).toHaveTextContent('mention your order number WEB-000002')
    expect(screen.getByTestId('payment-deadline')).toHaveTextContent(/We keep your order until .*2026/)
    expect(screen.getByTestId('order-payment')).toHaveTextContent('Bank transfer · Awaiting payment')
    expect(screen.getByText('Pathao, tracking number PX-1')).toBeInTheDocument()
    expect(screen.getByTestId('summary-tax')).toHaveTextContent('৳135.00')
  })

  it('shows "not found" for a wrong or missing token', async () => {
    serve({ routes: { 'GET /store/orders/WEB-000009': fail(404, 'NOT_FOUND', 'Not found') } })
    renderRoutes(storefrontRoutes, '/order/WEB-000009?token=wrong')
    expect(await screen.findByRole('heading', { level: 1, name: 'We could not find this order' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Order not found | Berry Kids'))
    expect(within(screen.getByTestId('order-page')).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?next=%2Forder%2FWEB-000009')
  })
})
