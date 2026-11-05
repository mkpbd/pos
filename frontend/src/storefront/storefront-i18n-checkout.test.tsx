import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, cartFixture, cartLine, checkoutOptionsFixture, previewFixture, resetLocale } from './test-fixtures'

vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

afterEach(() => {
  resetLocale()
  localStorage.clear()
  sessionStorage.clear()
})

type Routes = Parameters<typeof mockApi>[0]

function serve(options: { banglaDigits?: boolean; routes?: Routes } = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(bilingualBootstrap({ bangla_digits: options.banglaDigits ?? false })),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
    'GET /store/checkout/options': ok(checkoutOptionsFixture()),
    'GET /store/geo/divisions': ok([{ id: 3, name: 'ঢাকা', name_bn: 'ঢাকা' }]),
    'POST /store/checkout/preview': ok(previewFixture()),
    ...options.routes,
  })
}

/** Every store API request asked for Bangla (ADR-011: the language travels in the URL). */
function expectAllInBangla(fetchMock: ReturnType<typeof mockApi>) {
  const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((url) => url.pathname.startsWith('/api/v1/store/'))
  expect(urls.length).toBeGreaterThan(0)
  for (const url of urls) expect(`${url.pathname} lang=${url.searchParams.get('lang')}`).toBe(`${url.pathname} lang=bn`)
}

describe('cart in Bangla', () => {
  it('shows the cart, its totals and a refused coupon in Bangla, asking the API in Bangla', async () => {
    const fetchMock = serve({ routes: { 'POST /store/cart/coupon': fail(422, 'COUPON_INVALID', 'Server says no.', { reason: 'expired' }) } })
    renderRoutes(storefrontRoutes, '/cart?lang=bn')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'আপনার কার্ট' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('কার্ট | Berry Kids'))
    const page = screen.getByTestId('cart-page')
    expect(within(page).getByText('2টি পণ্য')).toBeInTheDocument()
    expect(within(page).getByRole('heading', { name: 'কার্টের হিসাব' })).toBeInTheDocument()
    // Latin digits unless the store turned Bengali digits on; the taka sign first.
    expect(within(page).getByTestId('cart-subtotal')).toHaveTextContent('৳900.00')
    expect(within(page).getByText('সাবটোটাল')).toBeInTheDocument()
    expect(within(page).getByText('মোট')).toBeInTheDocument()
    expect(within(page).getByRole('link', { name: 'চেকআউট' })).toHaveAttribute('href', '/checkout')
    expect(within(page).getByRole('button', { name: 'কমান: Kids Tee (Red / M)-এর পরিমাণ' })).toBeInTheDocument()

    const input = within(page).getByRole('textbox', { name: 'কুপন কোড' })
    await user.type(input, 'save10{Enter}')
    expect(await within(page).findByTestId('coupon-error')).toHaveTextContent('এই কুপনের মেয়াদ শেষ হয়ে গেছে।')

    await user.clear(input)
    await user.click(within(page).getByRole('button', { name: 'প্রয়োগ করুন' }))
    expect(within(page).getByTestId('coupon-error')).toHaveTextContent('একটি কুপন কোড লিখুন।')

    expectAllInBangla(fetchMock)
  })

  it('writes amounts and counts with Bengali digits when the store uses them', async () => {
    serve({ banglaDigits: true })
    renderRoutes(storefrontRoutes, '/cart?lang=bn')

    const page = await screen.findByTestId('cart-page')
    expect(await within(page).findByText('২টি পণ্য')).toBeInTheDocument()
    expect(within(page).getByTestId('cart-subtotal')).toHaveTextContent('৳৯০০.০০')
    expect(within(page).getByTestId('cart-total')).toHaveTextContent('৳৯০০.০০')
    // The quantity input keeps Latin digits (it is typed into).
    expect(within(page).getByRole('textbox', { name: 'Kids Tee (Red / M)-এর পরিমাণ' })).toHaveValue('2')
  })
})

describe('checkout in Bangla', () => {
  it('labels the form and the summary in Bangla and shows the validation messages in Bangla', async () => {
    const fetchMock = serve()
    renderRoutes(storefrontRoutes, '/checkout?lang=bn')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'চেকআউট' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('চেকআউট | Berry Kids'))
    expect(screen.getByRole('heading', { name: 'যোগাযোগ' })).toBeInTheDocument()
    expect(screen.getByLabelText('পূর্ণ নাম')).toBeInTheDocument()
    expect(screen.getByLabelText('মোবাইল নম্বর')).toBeInTheDocument()
    expect(screen.getByLabelText('বিভাগ')).toBeInTheDocument()
    expect(screen.getByLabelText('জেলা')).toBeDisabled()
    expect(screen.getByRole('link', { name: 'দ্রুত চেকআউটের জন্য সাইন ইন করুন' })).toBeInTheDocument()
    // A division whose name is already Bangla is not repeated in brackets.
    expect(await screen.findByRole('option', { name: 'ঢাকা' })).toBeInTheDocument()

    const summary = screen.getByTestId('order-summary')
    expect(within(summary).getByRole('heading', { name: 'অর্ডারের সারসংক্ষেপ' })).toBeInTheDocument()
    expect(await within(summary).findByTestId('summary-total')).toHaveTextContent('৳900.00')
    expect(within(summary).getByTestId('summary-shipping')).toHaveTextContent('একটি ঠিকানা বেছে নিন')
    expect(screen.getByText('ডেলিভারির অপশন দেখতে একটি ডেলিভারি ঠিকানা বেছে নিন।')).toBeInTheDocument()

    const place = screen.getByRole('button', { name: 'অর্ডার নিশ্চিত করুন' })
    await waitFor(() => expect(place).toBeEnabled())
    await user.click(place)
    expect(await screen.findByText('অনুগ্রহ করে আপনার নাম লিখুন।')).toBeInTheDocument()
    expect(screen.getByText('অনুগ্রহ করে একটি বিভাগ বেছে নিন।')).toBeInTheDocument()
    expect(screen.getByText('অনুগ্রহ করে একটি পেমেন্ট পদ্ধতি বেছে নিন।')).toBeInTheDocument()

    expectAllInBangla(fetchMock)
  })
})
