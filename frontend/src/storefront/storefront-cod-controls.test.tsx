import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { codUnavailable, previewPhone, withCheckoutPhones, withContactPhone } from './checkout/cod-availability'
import { placementProblem } from './checkout/placement-errors'
import { bn } from './i18n/bn'
import { en } from './i18n/en'
import { createTranslator } from './i18n/translate'
import { orderProblem } from './landing/order-form-logic'
import type { TrackedOrder } from './orders/track-api'
import type { CheckoutPreviewInput } from './types'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, cartLine, checkoutOptionsFixture, orderFixture, previewFixture, resetLocale, shippingMethodFixture } from './test-fixtures'

/* BD1b §7 (storefront): orders awaiting a confirmation call, and cash on delivery refused for a blocked number. */

vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

afterEach(() => {
  resetLocale()
  localStorage.clear()
  sessionStorage.clear()
})

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

describe('cash on delivery availability (pure)', () => {
  it('sends a number only once it is a valid mobile', () => {
    expect(previewPhone('01811-223344')).toBe('01811223344')
    expect(previewPhone('০১৮১১২২৩৩৪৪')).toBe('01811223344')
    expect(previewPhone('0181')).toBeNull()
    expect(previewPhone('')).toBeNull()
    const body: CheckoutPreviewInput = { payment_method: 'cod' }
    expect(withContactPhone(body, '+8801811223344')).toEqual({ payment_method: 'cod', contact: { phone: '01811223344' } })
    expect(withContactPhone(body, '0181')).toEqual({ payment_method: 'cod' })
    expect(withCheckoutPhones({ address: { division_id: 3, district_id: 47 } }, '01811223344', '01711000000')).toEqual({
      contact: { phone: '01811223344' },
      address: { division_id: 3, district_id: 47, phone: '01711000000' },
    })
    // No address in the body yet: the delivery number waits (an address-less preview stays address-less).
    expect(withCheckoutPhones({}, '01811223344', '01711000000')).toEqual({ contact: { phone: '01811223344' } })
    expect(codUnavailable({ cod_available: false })).toBe(true)
    expect(codUnavailable({ cod_available: true })).toBe(false)
    expect(codUnavailable({})).toBe(false)
    expect(codUnavailable(null)).toBe(false)
  })

  it('explains COD_NOT_AVAILABLE in English and Bangla, at the payment method', () => {
    const error = new ApiError(422, 'COD_NOT_AVAILABLE', 'Cash on delivery is not available for this order.')
    const t = createTranslator(en, { locale: 'en', banglaDigits: false })
    const tBn = createTranslator(bn, { locale: 'bn', banglaDigits: false })
    expect(placementProblem(error, t)).toEqual({ code: 'COD_NOT_AVAILABLE', message: 'Cash on delivery is not available for this order. Please choose another payment method.', field: 'payment_method' })
    expect(placementProblem(error, tBn).message).toBe('এই অর্ডারের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়। অনুগ্রহ করে অন্য একটি পেমেন্ট পদ্ধতি বেছে নিন।')
    expect(orderProblem(error, t, '/p/eid')).toEqual({ code: 'COD_NOT_AVAILABLE', message: 'Cash on delivery is not available for this order. Please choose another payment method.', field: 'payment_method' })
    expect(tBn('checkout.payment.codUnavailable')).toBe('এই নম্বরের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়।')
    expect(t('orders.status.pendingConfirmation')).toBe('Awaiting confirmation')
    expect(tBn('orders.status.pendingConfirmation')).toBe('নিশ্চিতকরণের অপেক্ষায়')
    expect(tBn('orders.page.willCall')).toBe('অর্ডার নিশ্চিত করতে আমরা আপনাকে কল করব।')
  })
})

const held = () => orderFixture({ status: 'pending_confirmation', status_label: 'Awaiting confirmation', history: [{ status: 'pending_confirmation', label: 'Awaiting confirmation', at: '2026-10-30T10:00:00+06:00' }] })

describe('an order awaiting a confirmation call', () => {
  it('says the shop will call on the order page', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/orders/WEB-000001': ok(held()),
    })
    renderRoutes(storefrontRoutes, '/order/WEB-000001?token=secret-token')
    expect(await screen.findByRole('heading', { level: 1, name: 'Order WEB-000001' })).toBeInTheDocument()
    expect(screen.getByTestId('order-status')).toHaveTextContent('Awaiting confirmation')
    expect(screen.getByTestId('awaiting-confirmation')).toHaveTextContent('We will call you to confirm your order.')
    expect(within(screen.getByTestId('order-history')).getByText('Awaiting confirmation')).toBeInTheDocument()
  })

  it('says it in Bangla', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/orders/WEB-000001': ok({ ...held(), status_label: 'Awaiting confirmation' }),
    })
    renderRoutes(storefrontRoutes, '/order/WEB-000001?token=secret-token&lang=bn')
    expect(await screen.findByTestId('awaiting-confirmation')).toHaveTextContent('অর্ডার নিশ্চিত করতে আমরা আপনাকে কল করব।')
    expect(screen.getByTestId('order-status')).toHaveTextContent('নিশ্চিতকরণের অপেক্ষায়')
  })

  it('has no note once confirmed', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/orders/WEB-000001': ok(orderFixture()),
    })
    renderRoutes(storefrontRoutes, '/order/WEB-000001?token=secret-token')
    expect(await screen.findByTestId('order-status')).toHaveTextContent('Confirmed')
    expect(screen.queryByTestId('awaiting-confirmation')).not.toBeInTheDocument()
  })

  it('shows the status and the note on the track page', async () => {
    const tracked: TrackedOrder = {
      number: 'WEB-000123',
      status: 'pending_confirmation',
      payment_method: 'cod',
      payment_status: 'unpaid',
      placed_at: '2026-11-20T10:00:00+06:00',
      total: '1250.00',
      item_count: 3,
      history: [{ status: 'pending_confirmation', at: '2026-11-20T10:00:00+06:00' }],
      shipment: null,
    }
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/orders/track': ok(tracked),
    })
    renderRoutes(storefrontRoutes, '/track-order?number=WEB-000123')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '01711223344')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    const card = await screen.findByTestId('tracked-order')
    expect(within(card).getByTestId('order-status')).toHaveTextContent('Awaiting confirmation')
    expect(within(card).getByTestId('awaiting-confirmation')).toHaveTextContent('We will call you to confirm your order.')
  })
})

describe('checkout with a blocked number', () => {
  it('disables cash on delivery for the number and maps a refused order', async () => {
    const home = shippingMethodFixture('sm-home')
    const previews: Record<string, unknown>[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/checkout/options': ok(checkoutOptionsFixture()),
      'GET /store/geo/divisions': ok([{ id: 3, name: 'Dhaka', name_bn: null }]),
      'GET /store/geo/districts': ok([{ id: 47, division_id: 3, name: 'Dhaka', name_bn: null }]),
      'POST /store/checkout/preview': (init) => {
        const body = bodyOf(init)
        previews.push(body)
        const blocked = (body.contact as { phone?: string } | undefined)?.phone === '01811223344'
        const delivery = body.address ? { shipping_methods: [home], shipping_method_id: 'sm-home', shipping_total: '60.00', total: '960.00' } : {}
        return ok(previewFixture({ ...delivery, payment_method: blocked ? null : ((body.payment_method as 'cod') ?? null), cod_available: !blocked }))
      },
      'POST /store/checkout': fail(422, 'COD_NOT_AVAILABLE', 'Cash on delivery is not available for this order.'),
    })
    renderRoutes(storefrontRoutes, '/checkout')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Full name'), 'Karim Uddin')
    await user.type(screen.getByLabelText('E-mail'), 'karim@example.com')
    await user.selectOptions(screen.getByLabelText('Division'), '3')
    await waitFor(() => expect(screen.getByLabelText('District')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('District'), '47')
    await user.type(screen.getByLabelText('Area / thana'), 'Mirpur')
    await user.type(screen.getByLabelText('Street address'), 'Road 3, House 9')
    const cod = screen.getByRole('radio', { name: /Cash on delivery/ })
    await user.click(cod)
    expect(cod).toBeChecked()

    await user.type(screen.getByLabelText('Mobile number'), '01811-223344')
    await waitFor(() => expect(cod).toBeDisabled())
    expect(cod).not.toBeChecked()
    expect(screen.getByTestId('cod-unavailable')).toHaveTextContent('Cash on delivery is not available for this number.')
    expect(previews.at(-1)).toMatchObject({ contact: { phone: '01811223344' }, address: { phone: '01811223344' } })

    // Bank transfer is still possible; a refusal from the server is explained at the payment method.
    await user.click(screen.getByRole('radio', { name: /Bank transfer/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /place order/i }))
    const problem = await screen.findByTestId('checkout-problem')
    expect(problem).toHaveAttribute('data-code', 'COD_NOT_AVAILABLE')
    expect(problem).toHaveTextContent('Cash on delivery is not available for this order. Please choose another payment method.')
  })
})
