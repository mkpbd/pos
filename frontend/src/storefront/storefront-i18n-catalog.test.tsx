import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, listingBody, productCard, productDetail, resetLocale } from './test-fixtures'

afterEach(() => {
  resetLocale()
  localStorage.clear()
})

const cards = [
  productCard('mango-juice', { price: '120.00', price_max: '150.00', variant_count: 2, is_new: true }),
  productCard('apple-juice', { in_stock: false }),
]

function serveShop(bangla_digits: boolean) {
  return mockApi({
    'GET /store/bootstrap': ok(bilingualBootstrap({ bangla_digits })),
    'GET /store/products': { body: listingBody(cards, { total: 57 }) },
  })
}

describe('catalog in Bangla', () => {
  it('shows the shop listing with Bangla labels and Latin digits by default', async () => {
    const fetchMock = serveShop(false)
    renderRoutes(storefrontRoutes, '/shop?lang=bn')

    expect(await screen.findByRole('heading', { level: 1, name: 'শপ' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('result-count')).toHaveTextContent('57টি পণ্যের মধ্যে 1–24 দেখানো হচ্ছে'))
    expect(document.documentElement.lang).toBe('bn')
    expect(screen.getByLabelText('সাজান')).toHaveDisplayValue('বাছাইকৃত')
    expect(screen.getByRole('navigation', { name: 'ব্রেডক্রাম্ব' })).toHaveTextContent('হোম')

    const [mango, apple] = screen.getAllByTestId('product-card')
    expect(within(mango!).getByTestId('price')).toHaveTextContent('৳120.00 – ৳150.00')
    expect(within(mango!).getByText('নতুন')).toBeInTheDocument()
    expect(within(within(apple!).getByRole('list', { name: 'পণ্যের লেবেল' })).getByText('স্টকে নেই')).toBeInTheDocument()
    expect(within(mango!).getByRole('button', { name: 'Mango Juice উইশলিস্টে যোগ করুন' })).toBeInTheDocument()

    const filters = within(screen.getAllByTestId('filter-panel')[0]!)
    expect(filters.getByRole('button', { name: 'ব্র্যান্ড' })).toBeInTheDocument()
    expect(filters.getByRole('checkbox', { name: /স্টকে আছে/ })).toBeInTheDocument()

    // The catalog was asked in Bangla.
    const productCalls = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost')).filter((url) => url.pathname === '/api/v1/store/products')
    expect(productCalls.at(-1)?.searchParams.get('lang')).toBe('bn')
  })

  it('uses Bengali digits for prices and counts when the store turned them on', async () => {
    serveShop(true)
    renderRoutes(storefrontRoutes, '/shop?lang=bn')

    await waitFor(() => expect(screen.getByTestId('result-count')).toHaveTextContent('৫৭টি পণ্যের মধ্যে ১–২৪ দেখানো হচ্ছে'))
    const [mango] = screen.getAllByTestId('product-card')
    expect(within(mango!).getByTestId('price')).toHaveTextContent('৳১২০.০০ – ৳১৫০.০০')
    // The page-size options read in Bengali digits, their values stay machine-readable.
    const perPage = screen.getByLabelText('দেখান') as HTMLSelectElement
    expect(perPage).toHaveDisplayValue('২৪')
    expect(perPage.value).toBe('24')
  })

  it('shows the product page in Bangla', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap()),
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok({ related: [productCard('kids-shorts')], frequently_bought: [] }),
      'GET /store/products': { body: listingBody([], { facets: null }) },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee?lang=bn')

    expect(await screen.findByRole('heading', { level: 1, name: 'Kids Tee' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('availability')).toHaveTextContent('স্টকে আছে'))
    expect(screen.getByText('ব্র্যান্ড:', { exact: false })).toBeInTheDocument()
    const tablist = screen.getByRole('tablist', { name: 'পণ্যের তথ্য' })
    expect(within(tablist).getByRole('tab', { name: 'বিবরণ' })).toHaveAttribute('aria-selected', 'true')
    expect(within(tablist).getByRole('tab', { name: 'স্পেসিফিকেশন' })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: 'রিভিউ' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'সম্পর্কিত পণ্য' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'উইশলিস্টে যোগ করুন' })).toHaveAttribute('aria-pressed', 'false')
  })
})
