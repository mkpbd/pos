import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage, OrderFormData } from './builder/types'
import { checkoutSchemaFor, emailModeOf, initialCheckoutValues, isAccountVerifiedPhone, needsPhoneCode, toPlaceInput, type CheckoutValues } from './checkout/schema'
import { placementProblem } from './checkout/placement-errors'
import { orderProblem } from './landing/order-form-logic'
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
  productDetail,
  shippingMethodFixture,
  tEn,
} from './test-fixtures'
import type { CheckoutOptions, CheckoutPreview, Customer, CustomerAddress, StorefrontBootstrap } from './types'
import { ApiError } from '@/lib/api/client'

/*
 * BD1a §8: the checkout's e-mail modes (required / optional / hidden) and the SMS-code check of
 * the mobile number (off / cash on delivery orders / all orders), on the cart checkout and on the
 * landing-page order form.
 */

vi.setConfig({ testTimeout: 25_000 })
configure({ asyncUtilTimeout: 4_000 })

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

type Routes = Parameters<typeof mockApi>[0]
type Body = Record<string, unknown> & { contact?: Record<string, unknown>; address?: { district_id?: unknown }; shipping_address_id?: string; shipping_method_id?: string; payment_method?: string }

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Body
const accepted = (data: unknown) => ({ status: 202, body: { success: true, data, meta: { request_id: 't' } } })
const created = (data: unknown) => ({ status: 201, body: { success: true, data, meta: { request_id: 't' } } })

const home = shippingMethodFixture('sm-home')

function previewFor(body: Body): CheckoutPreview {
  const district = body.shipping_address_id ? '47' : body.address?.district_id !== undefined ? String(body.address.district_id) : null
  if (!district) return previewFixture({ payment_method: (body.payment_method as 'cod') ?? null })
  return previewFixture({ shipping_methods: [home], shipping_method_id: 'sm-home', shipping_total: '60.00', total: '960.00', payment_method: (body.payment_method as 'cod') ?? null })
}

type ServeOptions = { me?: Customer | null; options?: Partial<CheckoutOptions>; addresses?: CustomerAddress[]; bootstrap?: StorefrontBootstrap; routes?: Routes }

function serve({ me = null, options = {}, addresses = [], bootstrap = bootstrapFixture(), routes = {} }: ServeOptions = {}) {
  const codes: { send: Body[]; verify: Body[] } = { send: [], verify: [] }
  const places: Body[] = []
  mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(me),
    'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/checkout/options': ok({ ...checkoutOptionsFixture(options), signed_in: me !== null }),
    'GET /store/account/addresses': ok(addresses),
    'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
    'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
    'POST /store/checkout/preview': (init) => ok(previewFor(bodyOf(init))),
    'POST /store/checkout/phone/send': (init) => {
      codes.send.push(bodyOf(init))
      return accepted({ resend_after: 60, expires_in: 300 })
    },
    'POST /store/checkout/phone/verify': (init) => {
      const body = bodyOf(init)
      codes.verify.push(body)
      return body.code === '123456' ? ok({ phone: body.phone, verified: true }) : fail(422, 'OTP_INVALID', 'Wrong code')
    },
    'POST /store/checkout': (init) => {
      places.push(bodyOf(init))
      return created({ order: orderFixture(), access_token: 'tok' })
    },
    ...routes,
  })
  return { codes, places }
}

async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Division'), '3')
  await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('District'), '47')
  await user.type(screen.getByLabelText('Area / thana'), 'Mirpur')
  await user.type(screen.getByLabelText('Street address'), 'Road 3, House 9')
}

const placeButton = () => screen.getByRole('button', { name: /place order/i })
const phoneField = () => screen.getByRole('textbox', { name: 'Mobile number' })

describe('checkout contact rules (pure)', () => {
  const values = (patch: Partial<CheckoutValues> = {}): CheckoutValues => ({
    ...initialCheckoutValues(null, undefined),
    name: 'Karim',
    phone: '01811-223344',
    recipient_name: 'Karim',
    address_phone: '01811223344',
    division_id: '3',
    district_id: '47',
    area: 'Mirpur',
    address_line: 'Road 3',
    shipping_method_id: 'sm-home',
    payment_method: 'cod',
    ...patch,
  })

  it('reads the e-mail mode and when a code is needed', () => {
    expect(emailModeOf(undefined, undefined)).toBe('required')
    expect(emailModeOf(undefined, 'hidden')).toBe('hidden')
    expect(emailModeOf('optional', 'hidden')).toBe('optional')
    expect(needsPhoneCode('off', 'cod')).toBe(false)
    expect(needsPhoneCode(undefined, 'cod')).toBe(false)
    expect(needsPhoneCode('cod', 'cod')).toBe(true)
    expect(needsPhoneCode('cod', 'bank_transfer')).toBe(false)
    expect(needsPhoneCode('all', 'bank_transfer')).toBe(true)
    expect(isAccountVerifiedPhone(customerFixture({ phone_verified: true }), '01712345678')).toBe(true)
    expect(isAccountVerifiedPhone(customerFixture({ phone_verified: true }), '01811223344')).toBe(false)
    expect(isAccountVerifiedPhone(customerFixture({ phone_verified: false }), '01712345678')).toBe(false)
    expect(isAccountVerifiedPhone(null, '01712345678')).toBe(false)
  })

  it('checks and sends the e-mail per mode', () => {
    expect(checkoutSchemaFor('required').safeParse(values({ email: '' })).success).toBe(false)
    expect(checkoutSchemaFor('optional').safeParse(values({ email: '' })).success).toBe(true)
    expect(checkoutSchemaFor('optional').safeParse(values({ email: 'nope' })).success).toBe(false)
    expect(checkoutSchemaFor('hidden').safeParse(values({ email: 'nope' })).success).toBe(true)

    const required = toPlaceInput(values({ email: ' a@b.test ' }), '960.00', { signedIn: false })
    expect(required.contact).toEqual({ name: 'Karim', email: 'a@b.test', phone: '01811223344' })
    expect(toPlaceInput(values({ email: '' }), '960.00', { signedIn: false, emailMode: 'optional' }).contact).toEqual({ name: 'Karim', phone: '01811223344' })
    expect(toPlaceInput(values({ email: 'a@b.test' }), '960.00', { signedIn: false, emailMode: 'optional' }).contact).toEqual({ name: 'Karim', email: 'a@b.test', phone: '01811223344' })
    expect(toPlaceInput(values({ email: 'a@b.test' }), '960.00', { signedIn: false, emailMode: 'hidden' }).contact).toEqual({ name: 'Karim', phone: '01811223344' })
  })

  it('puts PHONE_NOT_VERIFIED on the mobile number field', () => {
    const error = new ApiError(422, 'PHONE_NOT_VERIFIED', 'Not verified', { phone: '01811223344' })
    expect(placementProblem(error, tEn)).toEqual({ code: 'PHONE_NOT_VERIFIED', message: 'Please confirm your mobile number with an SMS code before placing the order.', field: 'phone' })
    expect(orderProblem(error, tEn, '/p/x')).toMatchObject({ code: 'PHONE_NOT_VERIFIED', field: 'phone' })
  })
})

describe('checkout e-mail and mobile number check', () => {
  it('lets a guest leave the optional e-mail out and confirm the number with a code for cash on delivery', async () => {
    const { codes, places } = serve({ options: { email_field: 'optional', phone_verification: 'cod' } })
    const { router } = renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Full name'), 'Karim Uddin')
    expect(screen.getByLabelText('E-mail (optional)')).toBeInTheDocument()
    await user.type(phoneField(), '01811-223344')
    await fillAddress(user)
    // Bank transfer: no code needed in "cash on delivery" mode.
    await user.click(await screen.findByRole('radio', { name: /Bank transfer/ }))
    expect(screen.queryByTestId('checkout-phone-check')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Cash on delivery/ }))
    const check = await screen.findByTestId('checkout-phone-check')
    expect(check).toHaveTextContent('We confirm your mobile number with a 6-digit code by SMS.')
    await waitFor(() => expect(placeButton()).toHaveAccessibleDescription('Confirm your mobile number with the SMS code to place the order.'))
    expect(placeButton()).toBeDisabled()

    await user.click(within(check).getByRole('button', { name: 'Send code' }))
    expect(await within(check).findByText('We sent a 6-digit code to 01811223344.')).toBeInTheDocument()
    expect(codes.send).toEqual([{ phone: '01811223344' }])
    const code = within(check).getByLabelText('Code from the SMS')
    // Enter checks the code; it never submits the order.
    await user.type(code, '999999{Enter}')
    expect(await within(check).findByRole('alert')).toHaveTextContent('This code is not correct.')
    expect(places).toEqual([])
    await user.clear(code)
    await user.type(code, '123456')
    await user.click(within(check).getByRole('button', { name: 'Verify' }))
    expect(await within(check).findByTestId('phone-verified')).toHaveTextContent('Mobile number verified ✓')
    expect(codes.verify.at(-1)).toEqual({ phone: '01811223344', code: '123456' })

    await waitFor(() => expect(placeButton()).toBeEnabled())
    await user.click(placeButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/order/WEB-000001'))
    expect(places).toHaveLength(1)
    expect(places[0]!.contact).toEqual({ name: 'Karim Uddin', phone: '01811223344' })
  })

  it('asks again for another number, and brings the check back when the server says the number is not confirmed', async () => {
    let placeReplies = 0
    const { codes } = serve({
      options: { phone_verification: 'all', email_field: 'hidden' },
      routes: {
        'POST /store/checkout': () => {
          placeReplies += 1
          return fail(422, 'PHONE_NOT_VERIFIED', 'Not verified', { phone: '01911223344' })
        },
      },
    })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Full name'), 'Karim Uddin')
    // Hidden: no e-mail field at all.
    expect(screen.queryByLabelText(/^E-mail/)).not.toBeInTheDocument()
    await user.type(phoneField(), '01811223344')
    await fillAddress(user)
    await user.click(await screen.findByRole('radio', { name: /Bank transfer/ }))
    const check = await screen.findByTestId('checkout-phone-check')
    await user.click(within(check).getByRole('button', { name: 'Send code' }))
    await user.type(await within(check).findByLabelText('Code from the SMS'), '123456')
    await user.click(within(check).getByRole('button', { name: 'Verify' }))
    expect(await within(check).findByTestId('phone-verified')).toBeInTheDocument()

    // Another number: confirm it too.
    await user.clear(phoneField())
    await user.type(phoneField(), '01911223344')
    expect(await within(screen.getByTestId('checkout-phone-check')).findByRole('button', { name: 'Send code' })).toBeEnabled()
    expect(placeButton()).toBeDisabled()
    // An incomplete number cannot get a code.
    await user.type(phoneField(), '9')
    expect(within(screen.getByTestId('checkout-phone-check')).getByRole('button', { name: 'Send code' })).toBeDisabled()
    await user.type(phoneField(), '{Backspace}')
    await user.click(within(screen.getByTestId('checkout-phone-check')).getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('Code from the SMS'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByTestId('phone-verified')).toBeInTheDocument()
    expect(codes.send).toEqual([{ phone: '01811223344' }, { phone: '01911223344' }])

    // The confirmation expired on the server: the field gets the error and the focus, the check comes back.
    await waitFor(() => expect(placeButton()).toBeEnabled())
    await user.click(placeButton())
    await waitFor(() => expect(phoneField()).toHaveFocus())
    expect(placeReplies).toBe(1)
    expect(phoneField()).toHaveAccessibleDescription('Please confirm your mobile number with an SMS code before placing the order.')
    expect(screen.getByTestId('checkout-problem')).toHaveAttribute('data-code', 'PHONE_NOT_VERIFIED')
    expect(within(screen.getByTestId('checkout-phone-check')).getByRole('button', { name: 'Send code' })).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
  })

  it('needs no code from a signed-in shopper whose verified number is the contact number', async () => {
    const me = customerFixture({ phone_verified: true })
    const { places, codes } = serve({ me, addresses: [addressFixture('a-1')], options: { phone_verification: 'all', email_field: 'optional' } })
    const { router } = renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()

    expect(await screen.findByLabelText('E-mail (optional)')).toHaveValue('rina@example.com')
    await user.click(await screen.findByRole('radio', { name: /Cash on delivery/ }))
    expect(screen.queryByTestId('checkout-phone-check')).not.toBeInTheDocument()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    // Another contact number needs the code.
    await user.clear(phoneField())
    await user.type(phoneField(), '01911223344')
    expect(await screen.findByTestId('checkout-phone-check')).toBeInTheDocument()
    await user.clear(phoneField())
    await user.type(phoneField(), '01712345678')
    await waitFor(() => expect(screen.queryByTestId('checkout-phone-check')).not.toBeInTheDocument())
    await waitFor(() => expect(placeButton()).toBeEnabled())
    await user.click(placeButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/order/WEB-000001'))
    expect(places[0]!.contact).toEqual({ name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' })
    expect(codes.send).toEqual([])
  })

  it('falls back to the bootstrap’s rules when the options do not say', async () => {
    serve({ bootstrap: bootstrapFixture({ checkout: { email: 'hidden', phone_verification: 'cod' } }) })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()
    await screen.findByLabelText('Full name')
    expect(screen.queryByLabelText(/^E-mail/)).not.toBeInTheDocument()
    await user.click(await screen.findByRole('radio', { name: /Cash on delivery/ }))
    expect(await screen.findByTestId('checkout-phone-check')).toBeInTheDocument()
  })
})

/* Landing-page order form ------------------------------------------------------------------------ */

const PRODUCT_ID = '0199a5c1-0000-7000-8000-00000000a001'

function orderData(): OrderFormData {
  return {
    product: productDetail({ id: PRODUCT_ID }),
    upsell: null,
    payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }],
    cod_enabled: true,
    guest_checkout: true,
    checkout_available: true,
    shipping: { methods: [home], districts: { '47': ['sm-home'] } },
  }
}

function landingPage(): BuilderPage {
  const doc = documentOf([elementNode('order_form', 'e_order', { product_id: PRODUCT_ID })])
  return payloadOf(doc, { key: 'landing:eid-sale', title: 'Eid sale', source: 'published', data: { e_order: orderData() } })
}

function serveLanding(bootstrap: StorefrontBootstrap, placeReply?: () => { status?: number; body?: unknown }) {
  const codes: Body[] = []
  const places: Body[] = []
  mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
    'GET /store/builder/pages/eid-sale': ok(landingPage()),
    'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
    'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
    'POST /store/checkout/direct/preview': (init) => {
      const body = bodyOf(init)
      const served = body.address !== undefined
      return ok(previewFixture({ lines: [cartLine('l-0', { variant_id: 'v-red-m', quantity: '1', unit_price: '450.00', line_total: '450.00' })], subtotal: '450.00', shipping_methods: served ? [home] : [], shipping_method_id: served ? 'sm-home' : null, shipping_total: served ? '60.00' : '0.00', total: served ? '510.00' : '450.00', payment_method: 'cod' }))
    },
    'POST /store/visits': ok({ recorded: true }),
    'POST /store/checkout/phone/send': (init) => {
      codes.push(bodyOf(init))
      return accepted({ resend_after: 60, expires_in: 300 })
    },
    'POST /store/checkout/phone/verify': (init) => ok({ phone: bodyOf(init).phone, verified: true }),
    'POST /store/checkout/direct': (init) => {
      places.push(bodyOf(init))
      return placeReply ? placeReply() : created({ order: orderFixture({ number: 'WEB-000777', total: '510.00' }), access_token: 'tok', order_url: '/order/WEB-000777?token=tok' })
    },
  })
  return { codes, places }
}

async function fillOrderForm(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  await user.type(within(form).getByRole('textbox', { name: /^Your name/ }), 'Karim Uddin')
  await user.type(within(form).getByRole('textbox', { name: /^Mobile number/ }), '০১৮১১-২২৩৩৪৪')
  await user.selectOptions(within(form).getByRole('combobox', { name: /^Division/ }), '3')
  await waitFor(() => expect(within(form).getByRole('combobox', { name: /^District/ })).toBeEnabled())
  await user.selectOptions(within(form).getByRole('combobox', { name: /^District/ }), '47')
  await user.type(within(form).getByRole('textbox', { name: /^Full address/ }), 'Road 3, House 9')
  await waitFor(() => expect(within(form).getByRole('radio', { name: /Home delivery/ })).toBeChecked())
}

describe('landing-page order form with the number check', () => {
  it('asks for the code before confirming, then places the order', async () => {
    const { codes, places } = serveLanding(bootstrapFixture({ checkout: { email: 'optional', phone_verification: 'cod' } }))
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Order now' })
    await fillOrderForm(user, form)
    const check = within(form).getByTestId('order-form-phone-check')
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    const summary = await screen.findByTestId('order-form-error-summary')
    expect(within(summary).getByRole('link', { name: 'Mobile number: Please confirm your mobile number with the code we send by SMS.' })).toBeInTheDocument()
    expect(places).toEqual([])

    await user.click(within(check).getByRole('button', { name: 'Send code' }))
    expect(codes).toEqual([{ phone: '01811223344' }])
    await user.type(await within(check).findByLabelText('Code from the SMS'), '123456')
    await user.click(within(check).getByRole('button', { name: 'Verify' }))
    expect(await within(form).findByTestId('phone-verified')).toHaveTextContent('Mobile number verified ✓')
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳510.00'))
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    expect(await screen.findByTestId('order-form-thanks')).toHaveTextContent('WEB-000777')
    expect(places[0]!.contact).toEqual({ name: 'Karim Uddin', phone: '01811223344' })
  })

  it('brings the check back when the server says the number is not confirmed', async () => {
    serveLanding(bootstrapFixture({ checkout: { email: 'optional', phone_verification: 'all' } }), () => fail(422, 'PHONE_NOT_VERIFIED', 'Not verified', { phone: '01811223344' }))
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const user = userEvent.setup()
    const form = await screen.findByRole('form', { name: 'Order now' })
    await fillOrderForm(user, form)
    const check = within(form).getByTestId('order-form-phone-check')
    await user.click(within(check).getByRole('button', { name: 'Send code' }))
    await user.type(await within(check).findByLabelText('Code from the SMS'), '123456')
    await user.click(within(check).getByRole('button', { name: 'Verify' }))
    await within(form).findByTestId('phone-verified')
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳510.00'))
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    const summary = await screen.findByTestId('order-form-error-summary')
    expect(within(summary).getByRole('link', { name: 'Mobile number: Please confirm your mobile number with an SMS code before placing the order.' })).toBeInTheDocument()
    expect(within(within(form).getByTestId('order-form-phone-check')).getByRole('button', { name: 'Send code' })).toBeInTheDocument()
  })

  it('shows no check when the store does not ask for one', async () => {
    serveLanding(bootstrapFixture())
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const form = await screen.findByRole('form', { name: 'Order now' })
    expect(within(form).queryByTestId('order-form-phone-check')).not.toBeInTheDocument()
  })
})
