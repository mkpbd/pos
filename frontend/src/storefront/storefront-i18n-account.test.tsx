import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, cartFixture, customerFixture, orderFixture, resetLocale } from './test-fixtures'
import type { AccountOrder, AccountOrderRow, Customer, StorefrontBootstrap } from './types'

/** E12b: the sign-in page, the order history and an order in Bangla. */

type Routes = Parameters<typeof mockApi>[0]

afterEach(() => {
  resetLocale()
  localStorage.clear()
})

function serve(routes: Routes = {}, me: Customer | null = customerFixture(), bootstrap: StorefrontBootstrap = bilingualBootstrap()) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(me),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
}

const PLACED = '2026-10-30T10:00:00+06:00'

/** What the page should print for a date in Bangla: Latin digits unless the store uses Bengali ones. */
const bnDateTime = (iso: string, digits: 'latn' | 'beng') => new Intl.DateTimeFormat('bn-BD', { dateStyle: 'medium', timeStyle: 'short', numberingSystem: digits }).format(new Date(iso))

function row(number: string, overrides: Partial<AccountOrderRow> = {}): AccountOrderRow {
  return {
    number,
    placed_at: PLACED,
    status: 'confirmed',
    status_label: 'নিশ্চিত',
    payment_status: 'unpaid',
    payment_method_label: 'ক্যাশ অন ডেলিভারি',
    item_count: 2,
    total: '960.00',
    currency: 'BDT',
    first_item: { name: 'Kids Tee', image_url: null },
    ...overrides,
  }
}

function returnableOrder(): AccountOrder {
  const base = orderFixture()
  const tee = base.lines[0]!
  return {
    ...base,
    number: 'WEB-000002',
    status: 'delivered',
    status_label: 'ডেলিভারি হয়েছে',
    payment_status: 'paid',
    can_cancel: false,
    returnable: true,
    return_deadline: '2026-11-05T23:59:59+06:00',
    returns: [],
    lines: [{ ...tee, id: 'ol-1', product_id: 'p-tee', review: null, reviewable: false, returnable_quantity: '2.000' }],
  }
}

describe('account pages in Bangla', () => {
  it('shows the sign-in page in Bangla with Bangla validation messages', async () => {
    serve({}, null)
    renderRoutes(storefrontRoutes, '/account/login?lang=bn')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'সাইন ইন' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('bn')
    const form = screen.getByRole('form', { name: 'সাইন ইন' })
    expect(within(form).getByLabelText('ই-মেইল')).toBeInTheDocument()
    expect(within(form).getByLabelText('পাসওয়ার্ড')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'পাসওয়ার্ড ভুলে গেছেন?' })).toHaveAttribute('href', '/account/forgot-password')
    expect(screen.getByRole('link', { name: 'অ্যাকাউন্ট খুলুন' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('সাইন ইন | Berry Kids'))

    await user.click(within(form).getByRole('button', { name: 'সাইন ইন' }))
    expect(await within(form).findByText('অনুগ্রহ করে আপনার ই-মেইল ঠিকানা লিখুন।')).toBeInTheDocument()
    expect(within(form).getByText('অনুগ্রহ করে আপনার পাসওয়ার্ড লিখুন।')).toBeInTheDocument()
  })

  it('translates a failed sign-in', async () => {
    serve({ 'POST /store/account/login': fail(422, 'INVALID_CREDENTIALS', 'These credentials do not match our records.') }, null)
    renderRoutes(storefrontRoutes, '/account/login?lang=bn')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'সাইন ইন' })
    await user.type(within(form).getByLabelText('ই-মেইল'), 'rina@example.com')
    await user.type(within(form).getByLabelText('পাসওয়ার্ড'), 'wrong-password')
    await user.click(within(form).getByRole('button', { name: 'সাইন ইন' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('ই-মেইল ঠিকানা অথবা পাসওয়ার্ড সঠিক নয়।')
  })

  it('lists orders in Bangla with Latin digits by default', async () => {
    serve({ 'GET /store/account/orders': ok([row('WEB-000010')], { pagination: { current_page: 1, per_page: 10, total: 1, last_page: 1 } }) })
    renderRoutes(storefrontRoutes, '/account/orders?lang=bn')

    expect(await screen.findByRole('heading', { level: 1, name: 'আমার অর্ডার' })).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'অর্ডারের অবস্থা' })
    expect(within(tabs).getByRole('link', { name: 'ডেলিভারি হয়েছে' })).toHaveAttribute('href', '/account/orders?status=delivered')
    expect(screen.getByRole('navigation', { name: 'অ্যাকাউন্ট' })).toBeInTheDocument()

    const [order] = await screen.findAllByTestId('order-row')
    expect(order).toHaveTextContent('2টি পণ্য')
    expect(order).toHaveTextContent('৳960.00')
    expect(order).toHaveTextContent(bnDateTime(PLACED, 'latn'))
  })

  it('uses Bengali digits for amounts, counts and dates when the store turns them on', async () => {
    serve(
      { 'GET /store/account/orders': ok([row('WEB-000010')], { pagination: { current_page: 1, per_page: 10, total: 1, last_page: 1 } }) },
      customerFixture(),
      bilingualBootstrap({ bangla_digits: true }),
    )
    renderRoutes(storefrontRoutes, '/account/orders?lang=bn')

    const [order] = await screen.findAllByTestId('order-row')
    expect(order).toHaveTextContent('২টি পণ্য')
    expect(order).toHaveTextContent('৳৯৬০.০০')
    expect(order).toHaveTextContent(bnDateTime(PLACED, 'beng'))
    // The order number is an identifier, never re-digited.
    expect(order).toHaveTextContent('WEB-000010')
  })

  it('shows an order in Bangla and explains a refused return in Bangla', async () => {
    serve({
      'GET /store/account/orders/WEB-000002': ok(returnableOrder()),
      'POST /store/account/orders/WEB-000002/returns': fail(422, 'RETURN_NOT_ALLOWED', 'Not allowed', { reason: 'window_closed' }),
    })
    renderRoutes(storefrontRoutes, '/account/orders/WEB-000002?lang=bn')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'অর্ডার WEB-000002' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ডেলিভারি ঠিকানা' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ডেলিভারি ও পেমেন্ট' })).toBeInTheDocument()
    expect(screen.getByTestId('order-payment')).toHaveTextContent('পরিশোধিত')
    expect(screen.getByRole('button', { name: 'আবার কিনুন' })).toBeInTheDocument()
    expect(screen.getByTestId('return-deadline')).toHaveTextContent('পর্যন্ত রিটার্ন গ্রহণ করা হবে')

    await user.click(screen.getByRole('button', { name: 'পণ্য রিটার্ন করুন' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/Kids Tee \(Red \/ M\) রিটার্ন করুন/))
    await user.selectOptions(within(dialog).getByLabelText('কারণ'), 'damaged')
    expect(within(dialog).getByRole('option', { name: 'ক্ষতিগ্রস্ত অবস্থায় পৌঁছেছে' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'রিটার্নের অনুরোধ করুন' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('এই অর্ডারের রিটার্নের সময়সীমা শেষ হয়ে গেছে।')
  })
})
