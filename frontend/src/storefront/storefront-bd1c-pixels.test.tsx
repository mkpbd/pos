import { QueryClientProvider } from '@tanstack/react-query'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient, mockApi, ok, renderRoutes } from '@/test/utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { OrderFormData } from './builder/types'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, orderFixture, previewFixture, productDetail, shippingMethodFixture } from './test-fixtures'
import { resetPixelsForTests } from './tracking/pixels'
import { resetTrackingForTests } from './tracking/track'
import type { StorefrontBootstrap } from './types'

/* BD1c §6: the ad pixels on the real pages — page views, product views, adds, purchases; never in a preview. */

vi.setConfig({ testTimeout: 25_000 })
configure({ asyncUtilTimeout: 4_000 })

const TRACKING = { meta_pixel_id: '123456789012345', ga4_measurement_id: 'G-ABC1234XYZ', tiktok_pixel_id: 'C4ABCDEFGHIJ12345678' }

type Calls = unknown[][]
let fbq: Calls
let gtag: Calls
let ttq: Calls

beforeEach(() => {
  resetTrackingForTests()
  resetPixelsForTests()
  fbq = []
  gtag = []
  ttq = []
  window.fbq = (...args: unknown[]) => void fbq.push(args)
  window.gtag = (...args: unknown[]) => void gtag.push(args)
  window.ttq = Object.assign([], {
    page: (...args: unknown[]) => void ttq.push(['page', ...args]),
    track: (...args: unknown[]) => void ttq.push(['track', ...args]),
    load: (...args: unknown[]) => void ttq.push(['load', ...args]),
  })
})

afterEach(() => {
  delete window.fbq
  delete window.gtag
  delete window.ttq
  document.head.querySelectorAll('script[data-sf-pixel]').forEach((script) => script.remove())
  localStorage.clear()
  sessionStorage.clear()
})

const events = (calls: Calls, name: string) => calls.filter((call) => call[1] === name)

function serve(bootstrap: StorefrontBootstrap, routes: Record<string, unknown> = {}) {
  mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/products/kids-tee': ok(productDetail()),
    'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
    'GET /store/products/kids-tee/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
    'POST /store/cart/items': ok(cartFixture([cartLine('l-1', { variant_id: 'v-red-m', sku: 'TEE-RM', quantity: '1', unit_price: '450.00' })], { total: '450.00' })),
    'POST /store/visits': ok({ recorded: true }),
    ...(routes as Record<string, never>),
  })
}

describe('ad pixels on the storefront', () => {
  it('reports the page view, the product view and an add to cart to all three pixels', async () => {
    serve(bootstrapFixture({ tracking: TRACKING }))
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()
    await screen.findByTestId('product-page')

    await waitFor(() => expect(events(fbq, 'ViewContent')).toHaveLength(1))
    expect(fbq.slice(0, 2)).toEqual([
      ['init', TRACKING.meta_pixel_id],
      ['track', 'PageView'],
    ])
    expect(events(fbq, 'ViewContent')[0]![2]).toMatchObject({ content_ids: ['TEE-RM'], value: 450, currency: 'BDT', content_type: 'product' })
    expect(gtag).toContainEqual(['config', TRACKING.ga4_measurement_id, { send_page_view: false }])
    expect(events(gtag, 'view_item')).toHaveLength(1)
    expect(ttq).toContainEqual(['load', TRACKING.tiktok_pixel_id])
    expect(ttq).toContainEqual(['page'])
    expect(events(ttq, 'ViewContent')).toHaveLength(1)

    await user.click(within(screen.getByTestId('product-page')).getAllByRole('button', { name: /^Add to cart/ })[0]!)
    await waitFor(() => expect(events(fbq, 'AddToCart')).toHaveLength(1))
    expect(events(fbq, 'AddToCart')[0]![2]).toMatchObject({ content_ids: ['TEE-RM'], value: 450, contents: [{ id: 'TEE-RM', quantity: 1, item_price: 450 }] })
    expect(events(gtag, 'add_to_cart')).toHaveLength(1)
    expect(events(ttq, 'AddToCart')).toHaveLength(1)
    // The pixels' own scripts are not added over the stubs already on the page.
    expect(document.head.querySelector('script[data-sf-pixel]')).toBeNull()
  })

  it('loads nothing in a staff preview', async () => {
    serve(bootstrapFixture({ tracking: TRACKING, preview: true }))
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    await screen.findByTestId('product-page')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument())
    expect([...fbq, ...gtag, ...ttq]).toEqual([])
  })

  it('loads nothing on a draft preview URL', async () => {
    serve(bootstrapFixture({ tracking: TRACKING }))
    renderRoutes(storefrontRoutes, '/product/kids-tee?preview=draft')
    await screen.findByTestId('product-page')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument())
    expect([...fbq, ...gtag, ...ttq]).toEqual([])
  })

  it('loads nothing when the store has no pixel', async () => {
    delete window.fbq
    delete window.gtag
    delete window.ttq
    serve(bootstrapFixture({ tracking: null }))
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    await screen.findByTestId('product-page')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument())
    expect(window.fbq).toBeUndefined()
    expect(window.gtag).toBeUndefined()
    expect(window.ttq).toBeUndefined()
    expect(document.head.querySelector('script[data-sf-pixel]')).toBeNull()
  })

  it('reports the purchase on the thank-you page once per order, with the order number as the event id', async () => {
    serve(bootstrapFixture({ tracking: TRACKING }), { 'GET /store/orders/WEB-000555': ok(orderFixture({ number: 'WEB-000555' })) })
    const open = () => {
      const router = createMemoryRouter(storefrontRoutes, { initialEntries: [{ pathname: '/order/WEB-000555', state: { placed: true } }] })
      return render(
        <QueryClientProvider client={createTestQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
    }
    const first = open()
    expect(await screen.findByTestId('order-number')).toHaveTextContent('WEB-000555')
    await waitFor(() => expect(events(fbq, 'Purchase')).toHaveLength(1))
    expect(events(fbq, 'Purchase')[0]).toEqual(['track', 'Purchase', expect.objectContaining({ value: 960, currency: 'BDT', content_ids: ['TEE-RM'] }), { eventID: 'WEB-000555' }])
    expect(events(gtag, 'purchase')[0]![2]).toMatchObject({ transaction_id: 'WEB-000555', value: 960 })
    expect(events(ttq, 'CompletePayment')[0]![3]).toEqual({ event_id: 'WEB-000555' })

    // The thank-you view again in this tab (a reload, or back): not counted twice.
    first.unmount()
    resetTrackingForTests()
    open()
    expect(await screen.findByTestId('order-number')).toHaveTextContent('WEB-000555')
    await waitFor(() => expect(events(fbq, 'PageView').length).toBeGreaterThanOrEqual(2))
    expect(events(fbq, 'Purchase')).toHaveLength(1)
  })

  it('reports no purchase on a later status view of the order', async () => {
    serve(bootstrapFixture({ tracking: TRACKING }), { 'GET /store/orders/WEB-000556': ok(orderFixture({ number: 'WEB-000556' })) })
    renderRoutes(storefrontRoutes, '/order/WEB-000556')
    expect(await screen.findByTestId('order-number')).toHaveTextContent('WEB-000556')
    await waitFor(() => expect(events(fbq, 'PageView')).toHaveLength(1))
    expect(events(fbq, 'Purchase')).toEqual([])
  })

  it('reports the landing-page order form: begin checkout on the first touch, purchase once placed', async () => {
    const PRODUCT_ID = '0199a5c1-0000-7000-8000-00000000a001'
    const home = shippingMethodFixture('sm-home')
    const data: OrderFormData = {
      product: productDetail({ id: PRODUCT_ID }),
      upsell: null,
      payment_methods: [{ code: 'cod', display_name: 'Cash on delivery' }],
      cod_enabled: true,
      guest_checkout: true,
      checkout_available: true,
      shipping: { methods: [home], districts: { '47': ['sm-home'] } },
    }
    const page = payloadOf(documentOf([elementNode('order_form', 'e_order', { product_id: PRODUCT_ID })]), { key: 'landing:eid-sale', title: 'Eid sale', source: 'published', data: { e_order: data } })
    serve(bootstrapFixture({ tracking: TRACKING }), {
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/builder/pages/eid-sale': ok(page),
      'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
      'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
      'POST /store/checkout/direct/preview': (init: RequestInit) => {
        const served = (JSON.parse(String(init.body)) as { address?: unknown }).address !== undefined
        return ok(previewFixture({ lines: [cartLine('l-0', { variant_id: 'v-red-m', quantity: '1', line_total: '450.00' })], subtotal: '450.00', shipping_methods: served ? [home] : [], shipping_method_id: served ? 'sm-home' : null, shipping_total: served ? '60.00' : '0.00', total: served ? '510.00' : '450.00', payment_method: 'cod' }))
      },
      'GET /store/orders/WEB-000777': ok(orderFixture({ number: 'WEB-000777', total: '510.00' })),
      'POST /store/checkout/direct': { status: 201, body: { success: true, data: { order: orderFixture({ number: 'WEB-000777', total: '510.00' }), access_token: 'tok', order_url: '/order/WEB-000777?token=tok' }, meta: { request_id: 't' } } },
    })
    renderRoutes(storefrontRoutes, '/p/eid-sale')
    const user = userEvent.setup()
    const form = await screen.findByRole('form', { name: 'Order now' })
    expect(events(fbq, 'InitiateCheckout')).toEqual([])
    await user.type(within(form).getByRole('textbox', { name: /^Your name/ }), 'Karim Uddin')
    await user.type(within(form).getByRole('textbox', { name: /^Mobile number/ }), '01811223344')
    expect(events(fbq, 'InitiateCheckout')).toEqual([['track', 'InitiateCheckout', expect.objectContaining({ content_ids: ['TEE-RM'], value: 450, num_items: 1 })]])
    expect(events(gtag, 'begin_checkout')).toHaveLength(1)
    expect(events(ttq, 'InitiateCheckout')).toHaveLength(1)
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Division/ }), '3')
    await waitFor(() => expect(within(form).getByRole('combobox', { name: /^District/ })).toBeEnabled())
    await user.selectOptions(within(form).getByRole('combobox', { name: /^District/ }), '47')
    await user.type(within(form).getByRole('textbox', { name: /^Full address/ }), 'Road 3, House 9')
    await waitFor(() => expect(within(form).getByTestId('summary-total')).toHaveTextContent('৳510.00'))
    await user.click(within(form).getByRole('button', { name: 'Confirm order' }))
    expect(await screen.findByTestId('order-form-thanks')).toHaveTextContent('WEB-000777')
    expect(events(fbq, 'InitiateCheckout')).toHaveLength(1)
    expect(events(fbq, 'Purchase')).toEqual([['track', 'Purchase', expect.objectContaining({ value: 510 }), { eventID: 'WEB-000777' }]])
    // Opening the order page from the thanks does not count it again.
    await user.click(screen.getByRole('link', { name: 'View your order' }))
    expect(await screen.findByTestId('order-number')).toHaveTextContent('WEB-000777')
    await waitFor(() => expect(events(fbq, 'PageView').length).toBeGreaterThanOrEqual(2))
    expect(events(fbq, 'Purchase')).toHaveLength(1)
  })
})
