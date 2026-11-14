import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { elementMeta, isAllowedIn, isTranslatableKey } from './builder/registry'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage, OrderFormData } from './builder/types'
import { elementPropProblems, orderFormPropProblems } from './builder/validate'
import { ATTRIBUTION_KEY, captureTouch, readAttribution, touchFromUrl } from './landing/attribution'
import { entryPathOf, landingSlugOf } from './landing/entry-path'
import {
  EMPTY_VALUES,
  latinDigits,
  maxQuantity,
  normalizePhone,
  orderFormErrors,
  orderFormFieldFor,
  orderLines,
  orderLink,
  orderProblem,
  toDirectOrderInput,
  toDirectPreviewInput,
  upsellVariant,
} from './landing/order-form-logic'
import { orderFormsOf } from './landing/order-now-shared'
import { isLandingPath, markVisitSent, resetVisitMemory, visitFor } from './landing/visits'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, checkoutOptionsFixture, orderFixture, previewFixture, productDetail, shippingMethodFixture, tEn } from './test-fixtures'
import type { CartLine, CheckoutPreview, ProductDetail, ProductVariant, StorefrontBootstrap } from './types'

// Long form flows with a debounced, server-computed summary: generous limits for a loaded CI box.
vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetVisitMemory()
})

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.style.removeProperty('--sf-quick-buy-space')
})

type Body = Record<string, unknown>
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Body
const headerOf = (init: RequestInit, name: string) => (init.headers as Record<string, string> | undefined)?.[name]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d1'
const PRODUCT_ID = '0199a5c1-0000-7000-8000-00000000a001'
const UPSELL_ID = '0199a5c1-0000-7000-8000-00000000a002'

const socksVariant: ProductVariant = {
  id: 'v-socks',
  sku: 'SOCKS',
  name: 'Socks',
  option_values: {},
  price: '150.00',
  compare_at_price: null,
  on_sale: false,
  discount_percent: null,
  in_stock: true,
  low_stock: false,
  image_id: null,
  promo_price: null,
}
const socks: ProductDetail = productDetail({
  id: UPSELL_ID,
  slug: 'socks',
  name: 'Socks',
  options: [],
  variants: [socksVariant],
  default_variant_id: 'v-socks',
  images: [],
})

const home = shippingMethodFixture('sm-home', { free_over: null })
const courier = shippingMethodFixture('sm-courier', {
  name: 'Courier',
  fee: '120.00',
  free_over: null,
  cod_fee: '20.00',
  eta_min_days: 3,
  eta_max_days: 5,
})

function orderData(patch: Partial<OrderFormData> = {}): OrderFormData {
  return {
    product: productDetail({ id: PRODUCT_ID }),
    upsell: socks,
    payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }],
    cod_enabled: true,
    guest_checkout: true,
    checkout_available: true,
    shipping: { methods: [home, courier], districts: { '47': ['sm-home'] } },
    ...patch,
  }
}

function landingPage({ props = {}, data = orderData(), source = 'published' as 'published' | 'draft' } = {}): BuilderPage {
  const doc = documentOf([
    elementNode('heading', 'e_title', { text: 'Eid sale', level: 1 }),
    elementNode('text', 'e_text', {
      html: `<p>${'Soft cotton tees for Eid. '.repeat(10)}</p>`,
    }),
    elementNode('order_form', 'e_order', {
      product_id: PRODUCT_ID,
      upsell: { product_id: UPSELL_ID, label: 'Add a pair of socks' },
      ...props,
    }),
  ])
  return payloadOf(doc, {
    key: 'landing:eid-sale',
    title: 'Eid sale',
    source,
    data: data ? { e_order: data } : {},
  })
}

const PRICES: Record<string, number> = {
  'v-red-m': 45000,
  'v-blue-l': 48000,
  'v-socks': 15000,
}
const money = (cents: number) => (cents / 100).toFixed(2)

/** The server's direct preview: the lines priced + delivery for Dhaka (47); Moulvibazar (58) is not served. */
function directPreviewFor(body: Body, totalOverride?: string): CheckoutPreview {
  const lines = (body.lines as { variant_id: string; quantity: number }[]).map((line, i): CartLine =>
    cartLine(`l-${i}`, {
      variant_id: line.variant_id,
      product: {
        slug: line.variant_id === 'v-socks' ? 'socks' : 'kids-tee',
        name: line.variant_id === 'v-socks' ? 'Socks' : 'Kids Tee',
        url: '/product/x',
        image: null,
      },
      variant_name: line.variant_id === 'v-socks' ? null : line.variant_id,
      quantity: String(line.quantity),
      unit_price: money(PRICES[line.variant_id]!),
      line_total: money(PRICES[line.variant_id]! * line.quantity),
    }),
  )
  const subtotal = (body.lines as { variant_id: string; quantity: number }[]).reduce((sum, line) => sum + PRICES[line.variant_id]! * line.quantity, 0)
  const district = (body.address as { district_id?: unknown } | undefined)?.district_id
  const methods = district === undefined ? [] : String(district) === '47' ? [home] : []
  const method = methods[0]
  const shipping = method ? Number(method.fee) * 100 : 0
  return previewFixture({
    lines,
    subtotal: money(subtotal),
    shipping_total: money(shipping),
    total: totalOverride ?? money(subtotal + shipping),
    shipping_methods: methods,
    shipping_method_id: method?.id ?? null,
    payment_method: (body.payment_method as 'cod') ?? null,
  })
}

type Routes = Parameters<typeof mockApi>[0]

function serve({
  page = landingPage(),
  bootstrap = bootstrapFixture(),
  routes = {},
}: {
  page?: BuilderPage | null
  bootstrap?: StorefrontBootstrap
  routes?: Routes
} = {}) {
  const previews: Body[] = []
  const visits: Body[] = []
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/builder/pages/eid-sale': page ? ok(page) : fail(404, 'NOT_FOUND'),
    'GET /store/geo/divisions': ok([
      { id: 3, name: 'Dhaka', name_bn: null },
      { id: 7, name: 'Sylhet', name_bn: null },
    ]),
    'GET /store/geo/districts': (_init, url) =>
      ok(url.searchParams.get('division') === '3' ? [{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }] : [{ id: 58, division_id: 7, name: 'Moulvibazar', name_bn: null }]),
    'POST /store/checkout/direct/preview': (init) => {
      const body = bodyOf(init)
      previews.push(body)
      return ok(directPreviewFor(body))
    },
    'POST /store/visits': (init) => {
      visits.push(bodyOf(init))
      return ok({ recorded: true })
    },
    ...routes,
  })
  return { fetchMock, previews, visits }
}

const placed = (number = 'WEB-000123') => ({
  status: 201,
  body: {
    success: true,
    data: {
      order: orderFixture({ number, total: '1170.00' }),
      access_token: 'tok-1',
      order_url: `/order/${number}?token=tok-1`,
    },
    meta: { request_id: 't' },
  },
})

async function fillForm(user: ReturnType<typeof userEvent.setup>, form: HTMLElement, district = { division: '3', district: '47' }) {
  await user.type(within(form).getByRole('textbox', { name: /^Your name/ }), 'Karim Uddin')
  await user.type(within(form).getByRole('textbox', { name: /^Mobile number/ }), '০১৮১১-২২৩৩৪৪')
  await user.selectOptions(within(form).getByRole('combobox', { name: /^Division/ }), district.division)
  await waitFor(() => expect(within(form).getByRole('combobox', { name: /^District/ })).toBeEnabled())
  await user.selectOptions(within(form).getByRole('combobox', { name: /^District/ }), district.district)
  await user.type(within(form).getByRole('textbox', { name: /^Full address/ }), 'Road 3, House 9')
}

/* ---------------------------------------------------------------------------------------------
 * Registry, validator and pure logic
 * ------------------------------------------------------------------------------------------- */

describe('order form element: registry and props', () => {
  it('is a commerce element of pages, CMS pages and zones with translatable texts', () => {
    const meta = elementMeta('order_form')!
    expect(meta.group).toBe('commerce')
    expect(['page', 'cms', 'zone'].every((context) => isAllowedIn('order_form', context as 'page'))).toBe(true)
    expect(isAllowedIn('order_form', 'popup') || isAllowedIn('order_form', 'header')).toBe(false)
    expect(isTranslatableKey('order_form', 'upsell.label')).toBe(true)
    expect(isTranslatableKey('order_form', 'button_label')).toBe(true)
    expect(isTranslatableKey('order_form', 'product_id')).toBe(false)
    // Invalid until the product is chosen; otherwise the defaults are valid.
    expect(orderFormPropProblems(meta.props)).toEqual([{ path: 'product_id', code: 'required' }])
    expect(
      elementPropProblems('order_form', {
        ...meta.props,
        product_id: PRODUCT_ID,
      }),
    ).toEqual([])
  })

  it('checks quantities, fields, texts and the add-on like the server', () => {
    const props = {
      ...elementMeta('order_form')!.props,
      product_id: PRODUCT_ID,
    }
    expect(orderFormPropProblems({ ...props, quantity: { default: 5, max: 3 } })).toEqual([{ path: 'quantity.max', code: 'out_of_range' }])
    expect(orderFormPropProblems({ ...props, quantity: { default: 11, max: 21 } })).toEqual([
      { path: 'quantity.default', code: 'out_of_range' },
      { path: 'quantity.max', code: 'out_of_range' },
    ])
    expect(
      orderFormPropProblems({
        ...props,
        fields: { email: 'maybe', note: 'required' },
        payment: 'card',
        layout: 'grid',
      }),
    ).toEqual([
      { path: 'fields.email', code: 'invalid' },
      { path: 'fields.note', code: 'invalid' },
      { path: 'payment', code: 'invalid' },
      { path: 'layout', code: 'invalid' },
    ])
    expect(
      orderFormPropProblems({
        ...props,
        button_label: ' ',
        title: 'x'.repeat(121),
      }),
    ).toEqual([
      { path: 'title', code: 'too_long' },
      { path: 'button_label', code: 'required' },
    ])
    expect(
      orderFormPropProblems({
        ...props,
        upsell: { product_id: PRODUCT_ID, label: '' },
      }),
    ).toEqual([
      { path: 'upsell.product_id', code: 'duplicate' },
      { path: 'upsell.label', code: 'required' },
    ])
  })
})

describe('order form logic', () => {
  const product = productDetail()
  const rules = { email: 'optional' as const, note: 'optional' as const }

  it('checks the answers (Bangla digits in the mobile number are fine)', () => {
    expect(latinDigits('০১৭১১')).toBe('01711')
    expect(normalizePhone(' +880 ১৭১১-২২৩৩৪৪ ')).toBe('01711223344')
    const variant = product.variants[0]!
    expect(orderFormErrors(EMPTY_VALUES, rules, variant)).toEqual({
      name: 'checkout.validation.name',
      phone: 'checkout.validation.phoneRequired',
      division_id: 'checkout.validation.division',
      district_id: 'checkout.validation.district',
      address_line: 'landing.orderForm.errorAddress',
      payment_method: 'checkout.validation.paymentMethod',
    })
    const ok = {
      ...EMPTY_VALUES,
      name: 'Rina',
      phone: '০১৭১১২২৩৩৪৪',
      division_id: '3',
      district_id: '47',
      address_line: 'Road 1',
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
    }
    expect(orderFormErrors(ok, rules, variant)).toEqual({})
    expect(orderFormErrors({ ...ok, phone: '12345', email: 'nope', shipping_method_id: '' }, rules, variant)).toEqual({
      phone: 'checkout.validation.phoneInvalid',
      email: 'checkout.validation.emailInvalid',
      shipping_method_id: 'checkout.validation.shippingMethod',
    })
    expect(orderFormErrors(ok, { email: 'required', note: 'hidden' }, variant)).toEqual({ email: 'checkout.validation.emailRequired' })
    expect(orderFormErrors(ok, rules, product.variants[1]!)).toEqual({
      variant: 'landing.orderForm.errorSoldOut',
    })
    expect(orderFormErrors(ok, rules, null)).toEqual({
      variant: 'landing.orderForm.errorVariant',
    })
  })

  it('builds the preview and order bodies (the add-on is always one)', () => {
    const lines = orderLines(product.variants[0]!, 3, upsellVariant(socks))
    expect(lines).toEqual([
      { variant_id: 'v-red-m', quantity: 3 },
      { variant_id: 'v-socks', quantity: 1 },
    ])
    expect(orderLines(null, 3, null)).toEqual([])
    expect(maxQuantity(10, { ...product.variants[0]!, stock_left: 4 })).toBe(4)
    expect(maxQuantity(25, null)).toBe(20)
    const base = { documentId: DOC_ID, elementId: 'e_order', lines }
    const geo = (kind: 'division' | 'district', value: string) => (kind === 'district' ? Number(value) : value)
    expect(toDirectPreviewInput(base, { district_id: '', shipping_method_id: '', payment_method: '' }, geo)).toEqual({ document_id: DOC_ID, element_id: 'e_order', lines })
    expect(
      toDirectPreviewInput(
        base,
        {
          district_id: '47',
          shipping_method_id: 'sm-home',
          payment_method: 'cod',
        },
        geo,
      ),
    ).toEqual({
      document_id: DOC_ID,
      element_id: 'e_order',
      lines,
      address: { district_id: 47 },
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
    })
    const values = {
      ...EMPTY_VALUES,
      name: ' Rina ',
      phone: '+8801711223344',
      email: ' ',
      division_id: '3',
      district_id: '47',
      area: ' Mirpur ',
      address_line: 'Road 1 ',
      note: 'Call first',
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
    }
    const attribution = {
      utm_source: 'facebook',
      first_seen_at: '2026-11-01T00:00:00.000Z',
    }
    expect(toDirectOrderInput(base, values, { email: 'optional', note: 'hidden' }, '1500.00', geo, attribution)).toEqual({
      document_id: DOC_ID,
      element_id: 'e_order',
      lines,
      contact: { name: 'Rina', phone: '01711223344' },
      address: {
        district_id: 47,
        division_id: '3',
        area: 'Mirpur',
        address_line: 'Road 1',
      },
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
      expected_total: '1500.00',
      attribution,
    })
  })

  it('maps server errors to fields and friendly messages', () => {
    expect(orderFormFieldFor('contact.phone')).toBe('phone')
    expect(orderFormFieldFor('lines.0.quantity')).toBe('quantity')
    expect(orderFormFieldFor('lines.0.variant_id')).toBe('variant')
    expect(orderFormFieldFor('lines.1.variant_id')).toBeNull()
    expect(orderFormFieldFor('address.address_line')).toBe('address_line')
    expect(orderFormFieldFor('expected_total')).toBeNull()
    const problem = (code: string, status = 422) => orderProblem(new ApiError(status, code, code, {}), tEn, '/p/eid-sale')
    expect(problem('ORDER_FORM_UNAVAILABLE').message).toBe('This offer is no longer available. Please reload the page.')
    expect(problem('INSUFFICIENT_STOCK').field).toBe('quantity')
    expect(problem('GUEST_CHECKOUT_DISABLED', 403).link).toEqual({
      to: '/account/login?next=%2Fp%2Feid-sale',
      label: 'Sign in',
    })
    expect(problem('SERVER_ERROR', 500).code).toBe('RETRY')
    expect(orderProblem(new TypeError('Failed to fetch'), tEn, '/').code).toBe('RETRY')
    expect(
      orderLink({
        order: orderFixture(),
        access_token: 't',
        order_url: '/order/WEB-000001?token=abc',
      }),
    ).toBe('/order/WEB-000001?token=abc')
    expect(
      orderLink({
        order: orderFixture(),
        access_token: null,
        order_url: 'https://evil.example/x',
      }),
    ).toBe('/order/WEB-000001')
  })
})

/* ---------------------------------------------------------------------------------------------
 * Attribution, visits and the entry page
 * ------------------------------------------------------------------------------------------- */

describe('campaign attribution', () => {
  const at = (search: string, pathname = '/p/eid-sale') => ({
    pathname,
    search,
    host: 'shop.example.com',
  })

  it('remembers the last campaign touch for 30 days; direct visits change nothing', () => {
    const t0 = new Date('2026-11-01T10:00:00Z')
    expect(captureTouch(at(''), '', t0)).toBeNull()
    expect(localStorage.getItem(ATTRIBUTION_KEY)).toBeNull()

    captureTouch(at('?utm_source=Facebook&utm_medium=paid&utm_campaign=eid&sl=EID-FB&x=1'), 'https://m.facebook.com/story', t0)
    expect(readAttribution(t0)).toEqual({
      utm_source: 'Facebook',
      utm_medium: 'paid',
      utm_campaign: 'eid',
      short_link: 'eid-fb',
      landing_path: '/p/eid-sale',
      referrer_host: 'm.facebook.com',
      first_seen_at: '2026-11-01T10:00:00.000Z',
    })
    // A direct visit later keeps the touch; a new campaign replaces it.
    captureTouch(at('', '/shop'), '', new Date('2026-11-05T10:00:00Z'))
    expect(readAttribution(new Date('2026-11-05T10:00:00Z'))?.utm_campaign).toBe('eid')
    captureTouch(at('?utm_source=google&utm_campaign=search', '/product/kids-tee'), 'https://shop.example.com/', new Date('2026-11-06T10:00:00Z'))
    const latest = readAttribution(new Date('2026-11-06T10:00:00Z'))!
    expect(latest).toEqual({
      utm_source: 'google',
      utm_campaign: 'search',
      landing_path: '/product/kids-tee',
      first_seen_at: '2026-11-06T10:00:00.000Z',
    })
    // 30 days later it is gone.
    expect(readAttribution(new Date('2026-12-07T10:00:00Z'))).toBeNull()
    expect(localStorage.getItem(ATTRIBUTION_KEY)).toBeNull()
  })

  it('trims values, ignores a malformed short link and a corrupt record, and survives blocked storage', () => {
    expect(touchFromUrl(at('?sl=a!'), '')).toBeNull()
    expect(touchFromUrl(at(`?utm_campaign=${'x'.repeat(150)}`), '')!.utm_campaign).toHaveLength(100)
    localStorage.setItem(ATTRIBUTION_KEY, '{nope')
    expect(readAttribution()).toBeNull()
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ utm_source: '<b>x</b>', first_seen_at: 'never' }))
    expect(readAttribution()).toBeNull()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => captureTouch(at('?utm_source=fb'), '')).not.toThrow()
    spy.mockRestore()
  })

  it('counts a campaign or landing page visit once per session', () => {
    expect(isLandingPath('/p/eid-sale')).toBe(true)
    expect(visitFor('/shop', null)).toBeNull()
    expect(visitFor('/p/eid-sale', null)).toEqual({ path: '/p/eid-sale' })
    const touch = touchFromUrl(at('?utm_source=fb&sl=eid-fb', '/shop'), 'https://l.facebook.com/')!
    expect(visitFor('/shop', touch)).toEqual({
      path: '/shop',
      utm_source: 'fb',
      code: 'eid-fb',
      referrer_host: 'l.facebook.com',
    })
    expect(markVisitSent({ path: '/p/eid-sale' })).toBe(false)
    expect(markVisitSent({ path: '/p/eid-sale' })).toBe(true)
  })

  it('reads the host’s entry page from the bootstrap', () => {
    expect(entryPathOf({ entry_path: '/p/eid-sale' })).toBe('/p/eid-sale')
    expect(entryPathOf({ entry_path: '/' })).toBeNull()
    expect(entryPathOf({ entry_path: '//evil.example' })).toBeNull()
    expect(entryPathOf({ entry_path: 'https://evil.example' })).toBeNull()
    expect(entryPathOf({})).toBeNull()
    expect(landingSlugOf('/p/eid-sale')).toBe('eid-sale')
    expect(landingSlugOf('/shop')).toBeNull()
  })
})

/* ---------------------------------------------------------------------------------------------
 * The order form on a landing page
 * ------------------------------------------------------------------------------------------- */

describe('order form on a landing page', () => {
  it('places a cash on delivery order with the campaign, never touching the cart, and thanks the shopper', async () => {
    const places: { body: Body; key: string | undefined }[] = []
    const { fetchMock, previews, visits } = serve({
      routes: {
        'POST /store/checkout/direct': (init) => {
          places.push({
            body: bodyOf(init),
            key: headerOf(init, 'Idempotency-Key'),
          })
          return placed()
        },
      },
    })
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/p/eid-sale?utm_source=facebook&utm_medium=paid&utm_campaign=eid&sl=eid-fb')

    const form = await screen.findByRole('form', { name: 'Order now' })
    // The visit is counted once, with its campaign.
    await waitFor(() =>
      expect(visits).toEqual([
        {
          path: '/p/eid-sale',
          utm_source: 'facebook',
          utm_medium: 'paid',
          utm_campaign: 'eid',
          code: 'eid-fb',
        },
      ]),
    )

    // The product, its option and quantity, the add-on.
    expect(within(form).getAllByText('Kids Tee')[0]).toBeInTheDocument()
    await user.click(within(form).getByRole('radio', { name: /Blue/ }))
    await user.click(
      within(form).getByRole('button', {
        name: 'Increase: Quantity of Kids Tee',
      }),
    )
    await user.click(within(form).getByRole('checkbox', { name: /Add a pair of socks/ }))
    const phone = within(form).getByRole('textbox', { name: /^Mobile number/ })
    expect(phone).toHaveAccessibleDescription('We will call this number to confirm your order.')
    expect(phone).toHaveAttribute('type', 'tel')
    // Districts the store does not deliver to are marked.
    await fillForm(user, form)
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Division/ }), '7')
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Moulvibazar — no delivery' })).toBeInTheDocument())
    await user.selectOptions(within(form).getByRole('combobox', { name: /^District/ }), '58')
    expect(await within(form).findByTestId('order-form-not-served')).toHaveTextContent('we do not deliver to this district yet')
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Division/ }), '3')
    await waitFor(() => expect(within(form).getByRole('combobox', { name: /^District/ })).toBeEnabled())
    await user.selectOptions(within(form).getByRole('combobox', { name: /^District/ }), '47')

    // The delivery method the server picked; the summary as it computed it.
    await waitFor(() => expect(within(form).getByRole('radio', { name: /Home delivery/ })).toBeChecked())
    expect(within(form).getByRole('radio', { name: /Cash on delivery/ })).toBeChecked()
    const summary = within(form).getByTestId('order-form-summary')
    await waitFor(() => expect(within(summary).getByTestId('summary-total')).toHaveTextContent('৳1,170.00'))
    expect(within(summary).getAllByTestId('order-form-line')).toHaveLength(2)
    await waitFor(() =>
      expect(previews.at(-1)).toEqual({
        document_id: DOC_ID,
        element_id: 'e_order',
        lines: [
          { variant_id: 'v-blue-l', quantity: 2 },
          { variant_id: 'v-socks', quantity: 1 },
        ],
        address: { district_id: 47 },
        shipping_method_id: 'sm-home',
        payment_method: 'cod',
      }),
    )
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    const thanks = await screen.findByTestId('order-form-thanks')
    expect(thanks).toHaveFocus()
    expect(thanks).toHaveTextContent('Thank you, Karim Uddin! Your order is placed.')
    expect(within(thanks).getByTestId('order-form-number')).toHaveTextContent('WEB-000123')
    expect(within(thanks).getByRole('link', { name: 'View your order' })).toHaveAttribute('href', '/order/WEB-000123?token=tok-1')
    expect(sessionStorage.getItem('sf:order-token:WEB-000123')).toBe('tok-1')

    expect(places).toHaveLength(1)
    expect(places[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(places[0]!.body).toEqual({
      document_id: DOC_ID,
      element_id: 'e_order',
      lines: [
        { variant_id: 'v-blue-l', quantity: 2 },
        { variant_id: 'v-socks', quantity: 1 },
      ],
      contact: { name: 'Karim Uddin', phone: '01811223344' },
      address: {
        district_id: 47,
        division_id: 3,
        address_line: 'Road 3, House 9',
      },
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
      expected_total: '1170.00',
      attribution: {
        utm_source: 'facebook',
        utm_medium: 'paid',
        utm_campaign: 'eid',
        short_link: 'eid-fb',
        landing_path: '/p/eid-sale',
        first_seen_at: expect.any(String),
      },
    })
    // The cart was never written to, nor the cart checkout used.
    const writes = fetchMock.mock.calls.filter(([input, init]) => (init?.method ?? 'GET') !== 'GET' && /\/store\/(cart|checkout)(\?|$)/.test(new URL(String(input), 'http://localhost').pathname))
    expect(writes).toEqual([])
    // The sticky "Order now" is gone after the order.
    await waitFor(() => expect(screen.getByTestId('order-now-bar')).toHaveAttribute('data-state', 'closed'))
  })

  it('lists every problem in a focused summary, and shows the server’s field errors', async () => {
    const { fetchMock } = serve({
      routes: {
        'POST /store/checkout/direct': fail(422, 'VALIDATION_FAILED', 'Invalid', { 'contact.phone': ['This mobile number is blocked.'] }),
      },
    })
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const form = await screen.findByRole('form', { name: 'Order now' })
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    const summary = await screen.findByTestId('order-form-error-summary')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Your name: Please enter your name.',
      'Mobile number: Please enter your mobile number.',
      'Division: Please choose a division.',
      'District: Please choose a district.',
      'Full address: Please enter your full address (house, road, village or area).',
    ])
    const name = within(form).getByRole('textbox', { name: /^Your name/ })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Please enter your name.')
    await user.click(within(summary).getByRole('link', { name: /^Your name/ }))
    expect(name).toHaveFocus()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/store/checkout/direct?') || String(input).endsWith('/store/checkout/direct'))).toBe(false)

    await fillForm(user, form)
    await waitFor(() => expect(within(form).getByRole('radio', { name: /Home delivery/ })).toBeChecked())
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳510.00'))
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    const again = await screen.findByTestId('order-form-error-summary')
    expect(
      within(again).getByRole('link', {
        name: 'Mobile number: This mobile number is blocked.',
      }),
    ).toBeInTheDocument()
    expect(within(form).getByRole('textbox', { name: /^Mobile number/ })).toHaveAttribute('aria-invalid', 'true')
  })

  it('retries with the same key after a lost connection, and asks to confirm a changed total', async () => {
    const keys: (string | undefined)[] = []
    const totals: unknown[] = []
    let reply = 0
    serve({
      routes: {
        'POST /store/checkout/direct': (init) => {
          keys.push(headerOf(init, 'Idempotency-Key'))
          totals.push(bodyOf(init).expected_total)
          reply += 1
          if (reply === 1) return fail(503, 'SERVICE_UNAVAILABLE')
          if (reply === 2)
            return fail(409, 'TOTAL_CHANGED', 'Changed', {
              preview: directPreviewFor(bodyOf(init), '530.00'),
              total: '530.00',
            })
          return placed()
        },
      },
    })
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const form = await screen.findByRole('form', { name: 'Order now' })
    await fillForm(user, form)
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳510.00'))

    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    const problem = await screen.findByTestId('order-form-problem')
    expect(problem).toHaveTextContent('Press the button again — your order will not be placed twice.')
    await waitFor(() => expect(problem).toHaveFocus())

    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    await waitFor(() => expect(screen.getByTestId('order-form-problem')).toHaveAttribute('data-code', 'TOTAL_CHANGED'))
    expect(screen.getByTestId('order-form-problem')).toHaveTextContent('from ৳510.00 to ৳530.00')
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳530.00'))

    await user.click(within(form).getByRole('button', { name: 'Confirm the new total' }))
    expect(await screen.findByTestId('order-form-thanks')).toBeInTheDocument()
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
    expect(totals).toEqual(['510.00', '510.00', '530.00'])
  })

  it('shows a draft order form that places nothing, and nothing when the product is not on sale', async () => {
    serve({ page: landingPage({ source: 'draft' }) })
    renderRoutes(storefrontRoutes, '/p/eid-sale?preview=draft')
    const form = await screen.findByRole('form', { name: 'Order now' })
    expect(within(form).getByRole('button', { name: 'Confirm order' })).toBeDisabled()
    expect(within(form).getByTestId('order-form-draft-note')).toHaveTextContent('This preview does not place orders.')
  })

  it('draws nothing for visitors without data, and tells them when ordering is closed', async () => {
    serve({ page: landingPage({ data: null as unknown as OrderFormData }) })
    const first = renderRoutes(storefrontRoutes, '/p/eid-sale')
    expect(await screen.findByRole('heading', { name: 'Eid sale' })).toBeInTheDocument()
    expect(screen.queryByTestId('order-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('order-now-bar')).not.toBeInTheDocument()
    first.unmount()

    serve({
      page: landingPage({ data: orderData({ checkout_available: false }) }),
    })
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const form = await screen.findByRole('form', { name: 'Order now' })
    expect(within(form).getByTestId('order-form-unavailable')).toHaveTextContent('Ordering is not available right now.')
    expect(within(form).getByRole('button', { name: 'Confirm order' })).toBeDisabled()
  })

  it('asks guests to sign in when the store requires an account', async () => {
    serve({ page: landingPage({ data: orderData({ guest_checkout: false }) }) })
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const form = await screen.findByRole('form', { name: 'Order now' })
    expect(await within(form).findByText('Please sign in to place your order.')).toBeInTheDocument()
    expect(within(form).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?next=%2Fp%2Feid-sale')
  })

  it('has a sticky “Order now” that takes the shopper to the form', async () => {
    serve()
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const bar = await screen.findByRole('region', { name: 'Quick order' })
    expect(bar).toHaveAttribute('data-state', 'open')
    await user.click(within(bar).getByRole('button', { name: /Order now/ }))
    expect(screen.getByTestId('order-form')).toHaveFocus()
    expect(orderFormsOf(landingPage())).toEqual(['e_order'])
  })

  it('is in Bangla when the store is', async () => {
    serve({
      bootstrap: bootstrapFixture({
        store: {
          ...bootstrapFixture().store,
          locales: ['en', 'bn'],
          default_locale: 'bn',
        },
        locale: 'bn',
      }),
    })
    renderRoutes(storefrontRoutes, '/p/eid-sale?lang=bn')
    const form = await screen.findByRole('form', { name: 'Order now' })
    expect(await within(form).findByRole('textbox', { name: /^মোবাইল নম্বর/ })).toBeInTheDocument()
    expect(within(form).getByText('কোনো অগ্রিম পেমেন্ট নেই — পণ্য হাতে পেয়ে টাকা দিন।')).toBeInTheDocument()
  })
})

describe('entry page and the cart checkout', () => {
  it('opens the host’s entry page at “/”, falling back to the front page', async () => {
    serve({ bootstrap: bootstrapFixture({ entry_path: '/p/eid-sale' }) })
    const first = renderRoutes(storefrontRoutes, '/')
    expect(await screen.findByRole('form', { name: 'Order now' })).toBeInTheDocument()
    expect(first.router.state.location.pathname).toBe('/')
    first.unmount()

    serve({
      page: null,
      bootstrap: bootstrapFixture({ entry_path: '/p/eid-sale' }),
    })
    const second = renderRoutes(storefrontRoutes, '/')
    expect(await screen.findByText('Clothes and toys for little ones')).toBeInTheDocument()
    second.unmount()

    serve({
      bootstrap: bootstrapFixture({ entry_path: '/shop' }),
      routes: {
        'GET /store/products': ok([], {
          current_page: 1,
          per_page: 24,
          total: 0,
          last_page: 1,
        }),
      },
    })
    const third = renderRoutes(storefrontRoutes, '/?utm_source=fb')
    await waitFor(() => expect(third.router.state.location.pathname).toBe('/shop'))
    expect(third.router.state.location.search).toBe('?utm_source=fb')
  })

  it('sends the campaign with a cart checkout too', async () => {
    captureTouch(
      {
        pathname: '/p/eid-sale',
        search: '?utm_source=facebook&utm_campaign=eid',
        host: 'localhost',
      },
      '',
    )
    const places: Body[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/checkout/options': ok(checkoutOptionsFixture()),
      'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
      'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
      'POST /store/checkout/preview': (init) => {
        const body = bodyOf(init) as { address?: unknown }
        return ok(
          body.address
            ? previewFixture({
                shipping_methods: [home],
                shipping_method_id: 'sm-home',
                shipping_total: '60.00',
                total: '960.00',
              })
            : previewFixture(),
        )
      },
      'POST /store/checkout': (init) => {
        places.push(bodyOf(init))
        return {
          status: 201,
          body: {
            success: true,
            data: { order: orderFixture(), access_token: 'x' },
            meta: { request_id: 't' },
          },
        }
      },
      'GET /store/orders/WEB-000001': ok(orderFixture()),
    })
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/checkout')
    await user.type(await screen.findByLabelText('Full name'), 'Karim Uddin')
    await user.type(screen.getByLabelText('E-mail'), 'karim@example.com')
    await user.type(screen.getByLabelText('Mobile number'), '01811223344')
    await user.selectOptions(screen.getByLabelText('Division'), '3')
    await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('District'), '47')
    await user.type(screen.getByLabelText('Area / thana'), 'Mirpur')
    await user.type(screen.getByLabelText('Street address'), 'Road 3, House 9')
    await user.click(await screen.findByRole('radio', { name: /Cash on delivery/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /place order/i }))
    await waitFor(() => expect(places).toHaveLength(1))
    expect(places[0]!.attribution).toEqual({
      utm_source: 'facebook',
      utm_campaign: 'eid',
      landing_path: '/p/eid-sale',
      first_seen_at: expect.any(String),
    })
  })
})
