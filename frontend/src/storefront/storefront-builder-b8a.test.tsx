import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { B8A_TYPES } from './builder/elements/b8a-types'
import { displayOrder, formatTime, hoursOf, openStatus, weekdayName, zonedNow } from './builder/elements/store-hours'
import { elementMeta, isAllowedIn, isTranslatableKey } from './builder/registry'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderData, BuilderDocument, BuilderMedia, BuilderPage, Element } from './builder/types'
import { b6PropProblems, b8aPropProblems, chartProblems, elementPropProblems, isMoneyString, teamLinkUrl } from './builder/validate'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, productCard, productDetail, resetLocale } from './test-fixtures'
import type { StorePage } from './types'
import b8aJson from './builder/__fixtures__/sample-b8a-elements.v1.json'

const b8aFixture = b8aJson as unknown as BuilderDocument

afterEach(() => {
  resetLocale()
  vi.useRealTimers()
  window.localStorage.clear()
})

/* ---------------------------------------------------------------------------------------------
 * Pages
 * ------------------------------------------------------------------------------------------- */

const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const MEDIA = { before: uuid(0xb8a01), after: uuid(0xb8a02), rina: uuid(0xb8a03), tea: uuid(0xb8a04), front: uuid(0xb8a05), mugs: uuid(0xb8a06) }
const KETTLE = uuid(0xb8b01)
const SMART = uuid(0xb8b02)
const TEA = uuid(0xb8b03)
const CUP = uuid(0xb8b04)
const POT = uuid(0xb8b05)

const media: Record<string, BuilderMedia> = Object.fromEntries(
  Object.entries(MEDIA).map(([name, id]) => [id, { url: `/storage/media/o/${name}.jpg`, srcset: '', width: 1200, height: 900, alt: null }]),
)

function page(builder: BuilderPage): StorePage {
  return { slug: 'about', title: 'About us', template: 'default', body_html: '<p>Classic</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
}

type Routes = Record<string, { body?: unknown; status?: number } | ((init: RequestInit) => { body?: unknown; status?: number })>

function renderPayload(builder: BuilderPage, routes: Routes = {}, { bootstrap = bootstrapFixture(), path = '/pages/about' } = {}) {
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/pages/about': ok(page(builder)),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
  return { fetchMock, ...renderRoutes(storefrontRoutes, path) }
}

function renderElements(elements: Element[], options: { data?: Record<string, BuilderData>; source?: 'published' | 'draft'; routes?: Routes } = {}) {
  const builder = payloadOf(documentOf(elements), { key: 'cms:x', data: options.data, source: options.source, media })
  return renderPayload(builder, options.routes)
}

/** Every element node of a document (inner rows walked, sections skipped). */
function elementsOf(doc: BuilderDocument): { id: string; type: string; props: Record<string, unknown>; translations?: Record<string, Record<string, string>> }[] {
  const walk = (nodes: unknown[]): ReturnType<typeof elementsOf> =>
    (nodes as { type: string; columns?: { elements: unknown[] }[] }[]).flatMap((node) => [
      ...(node.type === 'section' || node.type === 'inner_row' ? [] : [node as ReturnType<typeof elementsOf>[number]]),
      ...(node.columns ?? []).flatMap((column) => walk(column.elements)),
    ])
  return walk(doc.sections)
}

const PLANS = [
  {
    id: 'p1',
    name: 'Starter',
    price: null,
    price_text: 'Free',
    period: '',
    description: 'Try it once.',
    features: [
      { id: 'f1', text: 'Delivery inside Dhaka', included: true },
      { id: 'f2', text: 'Gift wrapping', included: false },
    ],
    button: { label: 'Start free', url: '/shop' },
    highlighted: false,
    badge: '',
  },
  {
    id: 'p2',
    name: 'Monthly',
    price: '499.00',
    price_text: '',
    period: '/month',
    description: '',
    features: [{ id: 'f1', text: 'Free delivery everywhere', included: true }],
    button: { label: 'Subscribe', url: '/shop' },
    highlighted: true,
    badge: 'Popular',
  },
]

const WEEK_HOURS = [
  { day: 'mon', closed: false, open: '10:00', close: '21:00' },
  { day: 'tue', closed: false, open: '10:00', close: '21:00' },
  { day: 'wed', closed: false, open: '10:00', close: '21:00' },
  { day: 'thu', closed: false, open: '10:00', close: '21:00' },
  { day: 'fri', closed: true, open: '10:00', close: '21:00' },
  { day: 'sat', closed: false, open: '18:00', close: '02:00' },
  { day: 'sun', closed: false, open: '12:00', close: '20:00' },
]

/* ============================================================================================= */

describe('B8a shared metadata and validators', () => {
  it('registers every B8a type with its group, contexts and nested translatable fields', () => {
    for (const type of B8A_TYPES) expect(elementMeta(type), type).toBeDefined()
    expect(elementMeta('pricing_table')?.group).toBe('commerce')
    expect(elementMeta('photo_grid')?.group).toBe('media')
    expect(elementMeta('review_wall')?.group).toBe('marketing')
    expect(isAllowedIn('store_hours', 'footer')).toBe(true)
    expect(isAllowedIn('bundle', 'footer')).toBe(false)
    expect(isAllowedIn('team', 'header')).toBe(false)
    expect(isTranslatableKey('pricing_table', 'plans.p1.features.f2.text')).toBe(true)
    expect(isTranslatableKey('pricing_table', 'plans.p1.button.label')).toBe(true)
    expect(isTranslatableKey('pricing_table', 'plans.p1.price')).toBe(false)
    expect(isTranslatableKey('comparison_table', 'rows.r2.cells.c1.text')).toBe(true)
    expect(isTranslatableKey('team', 'members.m1.name')).toBe(false)
    expect(isTranslatableKey('team', 'members.m1.bio')).toBe(true)
    expect(isTranslatableKey('flash_sale_bar', 'button.label')).toBe(true)
  })

  it('accepts every element of the shared B8a fixture, with all keys present and translatable keys only', () => {
    const elements = elementsOf(b8aFixture)
    expect(new Set(elements.map((node) => node.type))).toEqual(new Set([...B8A_TYPES, 'chart']))
    expect(elements.filter((node) => node.type === 'chart').map((node) => node.props.kind)).toEqual(expect.arrayContaining(['stacked-column', 'stacked-bar']))
    for (const node of elements) {
      expect(Object.keys(node.props).sort(), node.id).toEqual(Object.keys(elementMeta(node.type)!.props).sort())
      expect(elementPropProblems(node.type, node.props), node.id).toEqual([])
      for (const key of Object.keys(node.translations?.bn ?? {})) expect(isTranslatableKey(node.type, key), `${node.id} ${key}`).toBe(true)
    }
  })

  it('refuses invalid money, links, cells, days, values and chart combinations', () => {
    expect(isMoneyString('499.00')).toBe(true)
    expect(isMoneyString('12.345')).toBe(false)
    expect(isMoneyString('-5')).toBe(false)
    expect(isMoneyString(499)).toBe(false)
    expect(b8aPropProblems('pricing_table', { plans: [{ ...PLANS[0], price: '1.234' }] })).toContainEqual({ path: 'plans.0.price', code: 'invalid' })
    expect(b8aPropProblems('pricing_table', { plans: [] })).toContainEqual({ path: 'plans', code: 'too_few' })

    expect(teamLinkUrl('instagram', 'http://instagram.com/x')).toBeNull()
    expect(teamLinkUrl('instagram', 'https://instagram.com/x')).toBe('https://instagram.com/x')
    expect(teamLinkUrl('website', 'http://example.com')).toBe('http://example.com')
    expect(teamLinkUrl('email', 'mailto:rina@example.com')).toBe('mailto:rina@example.com')
    expect(teamLinkUrl('email', 'mailto:rina@example.com?subject=hi')).toBeNull()
    expect(teamLinkUrl('email', 'javascript:alert(1)')).toBeNull()

    const columns = [
      { id: 'c1', title: 'A', product_id: null, highlighted: false },
      { id: 'c2', title: 'B', product_id: null, highlighted: false },
    ]
    expect(b8aPropProblems('comparison_table', { columns, rows: [{ id: 'r1', label: 'Row', cells: { c1: { kind: 'yes', text: '' } } }], show_prices: true, show_buttons: true })).toContainEqual({
      path: 'rows.0.cells.c2',
      code: 'required',
    })
    expect(b8aPropProblems('store_hours', { days: WEEK_HOURS.slice(0, 6), title: '', note: '', show_open_now: true, highlight_today: true, week_starts: 'sat' })).toContainEqual({ path: 'days', code: 'too_few' })
    expect(b8aPropProblems('store_hours', { days: WEEK_HOURS.map((day, i) => (i === 0 ? { ...day, open: '25:00' } : day)), title: '', note: '', show_open_now: true, highlight_today: true, week_starts: 'sat' })).toContainEqual({
      path: 'days.0.open',
      code: 'invalid',
    })
    expect(b8aPropProblems('progress_bars', { items: [{ id: 'i1', label: 'A', value: 50.25 }], style: 'bar', show_value: true, animate: true })).toContainEqual({ path: 'items.0.value', code: 'out_of_range' })
    expect(b8aPropProblems('review_wall', { ...elementMeta('review_wall')!.props, source: 'product' })).toContainEqual({ path: 'product_id', code: 'required' })
    expect(b8aPropProblems('bundle', { items: [{ id: 'b1', product_id: TEA }, { id: 'b2', product_id: TEA }], title: '', text: '', button_label: '' })).toContainEqual({ path: 'items.1.product_id', code: 'duplicate' })

    const chart = { ...elementMeta('chart')!.props } as Record<string, unknown>
    expect(chartProblems({ ...chart, kind: 'stacked-column' })).toContainEqual({ path: 'series', code: 'too_few' })
    expect(chartProblems({ ...chart, kind: 'stacked-bar', data_source: 'store.rating_breakdown' })).toContainEqual({ path: 'kind', code: 'invalid' })
    expect(chartProblems({ ...chart, source_product_id: SMART })).toContainEqual({ path: 'source_product_id', code: 'invalid' })
    expect(chartProblems({ ...chart, data_source: 'store.rating_breakdown', source_product_id: SMART })).toEqual([])
    const twoSeries = { ...chart, kind: 'stacked-column', series: [{ id: 'sa', name: 'A', values: [1, 2, 3] }, { id: 'sb', name: 'B', values: [1, -2, 3] }] }
    expect(chartProblems(twoSeries)).toEqual([{ path: 'series.1.values.1', code: 'out_of_range' }])
    // The editor's existing validation entry point covers B8a types too.
    expect(b6PropProblems('progress_bars', { items: [], style: 'bar', show_value: true, animate: true })).toContainEqual({ path: 'items', code: 'too_few' })
  })
})

/* ============================================================================================= */

describe('B8a selling blocks', () => {
  it('draws pricing plans with icon + text features, money from the store formatter, highlighted first on phones', async () => {
    renderElements([elementNode('pricing_table', 'e_pricing', { plans: PLANS })])
    const table = await screen.findByRole('list', { name: 'Pricing plans' })
    const plans = within(table).getAllByRole('article')
    expect(plans.map((plan) => within(plan).getByRole('heading').textContent)).toEqual(['Starter', 'Monthly'])
    expect(within(plans[0]!).getByTestId('pricing-price')).toHaveTextContent('Free')
    expect(within(plans[1]!).getByTestId('pricing-price')).toHaveTextContent(/499\.00\/month/)
    expect(within(plans[0]!).getByText(/Not included/, { selector: '.sr-only' })).toBeInTheDocument()
    expect(within(plans[0]!).getByText('Delivery inside Dhaka').closest('li')).toHaveTextContent('Included: Delivery inside Dhaka')
    expect(within(plans[1]!).getByText('Popular')).toBeInTheDocument()
    expect(plans[1]!.closest('li')).toHaveClass('order-first')
    expect(within(plans[1]!).getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', '/shop')
  })

  it('moves the before / after handle by keyboard and pointer; both photos keep their alt text', async () => {
    renderElements([
      elementNode('before_after', 'e_ba', { before: { media_id: MEDIA.before, alt: 'Room before' }, after: { media_id: MEDIA.after, alt: 'Room after' }, start: 40 }),
    ])
    const slider = await screen.findByRole('slider', { name: 'Compare Before and After' })
    expect(screen.getByRole('img', { name: 'Room before' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Room after' })).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuenow', '40')
    expect(slider).toHaveAttribute('aria-valuetext', '40% Before')
    const layer = screen.getByTestId('before-layer')
    expect(layer.style.clipPath).toBe('inset(0 60% 0 0)')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuenow', '41')
    fireEvent.keyDown(slider, { key: 'PageDown' })
    expect(slider).toHaveAttribute('aria-valuenow', '31')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(layer.style.clipPath).toBe('inset(0 100% 0 0)')

    const frame = screen.getByTestId('before-after-frame')
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, width: 400, height: 300, right: 500, bottom: 300, x: 100, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(frame, { clientX: 300, clientY: 10, pointerType: 'touch', pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '50')
    expect(slider).toHaveFocus()
    fireEvent.pointerMove(frame, { clientX: 400, clientY: 10, pointerType: 'touch', pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '75')
    fireEvent.pointerUp(frame, { pointerId: 1 })
    fireEvent.pointerMove(frame, { clientX: 150, clientY: 10, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '75')
  })

  it('compares in a real table: headers with scope, yes / no read out, an unavailable product loses price and button', async () => {
    const data = { e_cmp: { products: { [KETTLE]: productCard('basic-kettle', { id: KETTLE, price: '1500.00', price_max: '1500.00' }) } } }
    renderElements(
      [
        elementNode('comparison_table', 'e_cmp', {
          columns: [
            { id: 'c1', title: 'Basic kettle', product_id: KETTLE, highlighted: false },
            { id: 'c2', title: 'Smart kettle', product_id: SMART, highlighted: true },
            { id: 'c3', title: 'Other shops', product_id: null, highlighted: false },
          ],
          rows: [
            { id: 'r1', label: 'Auto shut-off', cells: { c1: { kind: 'yes', text: '' }, c2: { kind: 'yes', text: '' }, c3: { kind: 'no', text: '' } } },
            { id: 'r2', label: 'Warranty', cells: { c1: { kind: 'text', text: '6 months' }, c2: { kind: 'yes', text: '2 years' }, c3: { kind: 'no', text: '' } } },
          ],
        }),
      ],
      { data },
    )
    const table = await screen.findByRole('table', { name: 'Comparison' })
    expect(screen.getByRole('region', { name: 'Comparison' })).toHaveAttribute('tabindex', '0')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col'])
    expect(headers[1]).toHaveTextContent('Basic kettle')
    expect(within(headers[1]!).getByTestId('price')).toHaveTextContent(/1,500\.00/)
    expect(within(headers[1]!).getByRole('button', { name: 'Add Basic Kettle to the cart' })).toBeInTheDocument()
    // The smart kettle is not on sale any more: the title stays, price and button go.
    expect(headers[2]).toHaveTextContent('Smart kettle')
    expect(within(headers[2]!).queryByTestId('price')).toBeNull()
    expect(within(headers[2]!).queryByRole('button')).toBeNull()
    const rows = within(table).getAllByRole('rowheader')
    expect(rows.map((th) => [th.textContent, th.getAttribute('scope')])).toEqual([
      ['Auto shut-off', 'row'],
      ['Warranty', 'row'],
    ])
    const firstRow = rows[0]!.closest('tr')!
    expect(within(firstRow).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Yes', 'Yes', 'No'])
    const second = rows[1]!.closest('tr')!
    expect(within(second).getAllByRole('cell').map((td) => td.textContent)).toEqual(['6 months', 'Yes: 2 years', 'No'])
  })

  it('marks an unavailable comparison column in a draft', async () => {
    const data = { e_cmp: { products: {}, columns: { c2: { state: 'unavailable' as const } } } }
    renderElements([elementNode('comparison_table', 'e_cmp', { columns: [{ id: 'c1', title: 'A', product_id: null, highlighted: false }, { id: 'c2', title: 'B', product_id: SMART, highlighted: false }], rows: [{ id: 'r1', label: 'Row', cells: { c1: { kind: 'yes', text: '' }, c2: { kind: 'no', text: '' } } }] })], {
      data,
      source: 'draft',
    })
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader')[2]).toHaveAttribute('data-column-state', 'unavailable')
  })

  it('counts a flash sale down with a claimed bar (only when the promotion has a limit) and its products', async () => {
    const endsAt = new Date(Date.now() + 5 * 3600_000).toISOString()
    const data = {
      e_flash: { promotion: { id: uuid(0xf1), name: 'Midnight madness', ends_at: endsAt }, products: [productCard('green-tea'), productCard('mango-jam'), productCard('lime-pickle')], claimed: { used: 30, limit: 120 } },
      e_plain: { promotion: { id: uuid(0xf1), name: 'Midnight madness', ends_at: endsAt }, products: [], claimed: null },
    }
    renderElements(
      [
        elementNode('flash_sale_bar', 'e_flash', { title: '', text: 'Hours only.', product_limit: 2, button: { label: 'Shop the sale', url: '/shop' } }),
        elementNode('flash_sale_bar', 'e_plain', { title: 'Plain', show_products: false }),
      ],
      { data },
    )
    const bar = await screen.findByRole('region', { name: 'Midnight madness' })
    expect(within(bar).getByTestId('countdown')).toBeInTheDocument()
    const progress = within(bar).getByRole('progressbar', { name: 'Claimed so far' })
    expect(progress).toHaveAttribute('aria-valuenow', '30')
    expect(progress).toHaveAttribute('aria-valuemax', '120')
    expect(within(bar).getByText('30 of 120 claimed')).toBeVisible()
    expect(within(within(bar).getByRole('list', { name: 'On sale now' })).getAllByRole('listitem')).toHaveLength(2)
    expect(within(bar).getByRole('link', { name: 'Shop the sale' })).toHaveAttribute('href', '/shop')
    const plain = screen.getByRole('region', { name: 'Plain' })
    expect(within(plain).queryByRole('progressbar')).toBeNull()
    expect(within(plain).queryByRole('list')).toBeNull()
  })

  it('drops a flash sale without a running promotion for visitors and marks it in a draft', async () => {
    const data = { e_flash: { promotion: { id: uuid(0xf1), name: 'Later', ends_at: null }, products: [], claimed: null, state: 'scheduled' as const } }
    const { unmount } = renderElements([elementNode('heading', 'e_h', { text: 'Top' }), elementNode('flash_sale_bar', 'e_flash'), elementNode('flash_sale_bar', 'e_none')], { data })
    await screen.findByRole('heading', { name: 'Top' })
    expect(document.querySelector('[data-b="e_flash"]')).toBeNull()
    expect(document.querySelector('[data-b="e_none"]')).toBeNull()
    unmount()
    renderElements([elementNode('flash_sale_bar', 'e_flash')], { data, source: 'draft' })
    await waitFor(() => expect(document.querySelector('[data-node-state="scheduled"] [data-b="e_flash"]')).not.toBeNull())
  })
})

/* ============================================================================================= */

function bundleProducts() {
  const tea = productDetail({
    id: TEA,
    slug: 'green-tea',
    name: 'Green Tea',
    url: '/product/green-tea',
    options: [],
    variants: [{ id: 'v-tea', sku: 'TEA', name: 'Default', option_values: {}, price: '250.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: '225.50' }],
    default_variant_id: 'v-tea',
  })
  const cup = productDetail({
    id: CUP,
    slug: 'clay-cup',
    name: 'Clay Cup',
    url: '/product/clay-cup',
    options: [],
    variants: [{ id: 'v-cup', sku: 'CUP', name: 'Default', option_values: {}, price: '120.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, promo_price: null }],
    default_variant_id: 'v-cup',
  })
  const tee = productDetail({ id: POT })
  return { [TEA]: tea, [CUP]: cup, [POT]: tee }
}

const BUNDLE_ITEMS = [
  { id: 'b1', product_id: TEA },
  { id: 'b2', product_id: CUP },
  { id: 'b3', product_id: POT },
]

describe('B8a bundle', () => {
  it('totals the chosen items, follows option and checkbox changes, and adds them all one after another', async () => {
    const user = userEvent.setup()
    const posted: string[] = []
    const { fetchMock } = renderElements([elementNode('bundle', 'e_bundle', { items: BUNDLE_ITEMS, title: 'Tea time' })], {
      data: { e_bundle: { products: bundleProducts() } },
      routes: {
        'POST /store/cart/items': (init) => {
          posted.push(JSON.parse(String(init.body)).variant_id)
          return ok(cartFixture())
        },
      },
    })
    const bundle = await screen.findByRole('region', { name: 'Tea time' })
    // 225.50 (promotion) + 120.00 + 450.00 (the tee's default, Red / M).
    expect(within(bundle).getByTestId('bundle-total')).toHaveTextContent(/795\.50/)
    await user.selectOptions(within(bundle).getByRole('combobox', { name: 'Option for Kids Tee' }), 'v-blue-l')
    expect(within(bundle).getByTestId('bundle-total')).toHaveTextContent(/825\.50/)
    // The out-of-stock option cannot be chosen.
    expect(within(bundle).getByRole('option', { name: /Red \/ L — Out of stock/ })).toBeDisabled()
    await user.click(within(bundle).getByRole('checkbox', { name: 'Include Clay Cup' }))
    expect(within(bundle).getByTestId('bundle-total')).toHaveTextContent(/705\.50/)

    await user.click(within(bundle).getByRole('button', { name: 'Add all to cart' }))
    await waitFor(() => expect(within(bundle).getByRole('status')).toHaveTextContent('2 items added to your cart.'))
    expect(posted).toEqual(['v-tea', 'v-blue-l'])
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(2)
  })

  it('says clearly which items could not be added when only some succeed', async () => {
    const user = userEvent.setup()
    renderElements([elementNode('bundle', 'e_bundle', { items: BUNDLE_ITEMS.slice(0, 2), title: 'Pair' })], {
      data: { e_bundle: { products: bundleProducts() } },
      routes: {
        'POST /store/cart/items': (init) => (JSON.parse(String(init.body)).variant_id === 'v-cup' ? fail(422, 'OUT_OF_STOCK') : ok(cartFixture())),
      },
    })
    const bundle = await screen.findByRole('region', { name: 'Pair' })
    await user.click(within(bundle).getByRole('button', { name: 'Add all to cart' }))
    const status = within(bundle).getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Added 1 of 2 items to your cart. These could not be added:'))
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(within(status).getByRole('listitem')).toHaveTextContent('Clay Cup — Sorry, this item is out of stock.')
  })

  it('asks for at least one item, and drops a bundle with fewer than two available products', async () => {
    const user = userEvent.setup()
    const { unmount } = renderElements([elementNode('bundle', 'e_bundle', { items: BUNDLE_ITEMS.slice(0, 2), title: 'Pair' })], { data: { e_bundle: { products: bundleProducts() } } })
    const bundle = await screen.findByRole('region', { name: 'Pair' })
    await user.click(within(bundle).getByRole('checkbox', { name: 'Include Green Tea' }))
    await user.click(within(bundle).getByRole('checkbox', { name: 'Include Clay Cup' }))
    await user.click(within(bundle).getByRole('button', { name: 'Add all to cart' }))
    expect(within(bundle).getByRole('status')).toHaveTextContent('Choose at least one item.')
    unmount()

    renderElements([elementNode('heading', 'e_h', { text: 'Top' }), elementNode('bundle', 'e_bundle', { items: BUNDLE_ITEMS.slice(0, 2) })], { data: { e_bundle: { products: { [TEA]: bundleProducts()[TEA]! } } } })
    await screen.findByRole('heading', { name: 'Top' })
    expect(document.querySelector('[data-b="e_bundle"]')).toBeNull()
  })
})

/* ============================================================================================= */

const REVIEWS = [
  { id: 'r1', author: 'Rina A.', rating: 5, title: 'Lovely', body: 'Fresh and quick.', created_at: '2026-10-01T10:00:00Z', product: { name: 'Green Tea', url: '/product/green-tea', image: null } },
  { id: 'r2', author: 'Karim H.', rating: 4, title: null, body: 'Good value.', created_at: '2026-10-02T10:00:00Z', product: null },
  { id: 'r3', author: 'Mita', rating: 4, title: null, body: 'Will buy again.', created_at: '2026-10-03T10:00:00Z', product: null },
]

describe('B8a trust & people', () => {
  it('names every team link for screen readers; mail links stay mailto, social links open in a new tab', async () => {
    renderElements([
      elementNode('team', 'e_team', {
        members: [
          {
            id: 'm1',
            media_id: MEDIA.rina,
            name: 'Rina Akter',
            role: 'Founder',
            bio: 'Started in her kitchen.',
            links: [
              { id: 'l1', kind: 'instagram', url: 'https://www.instagram.com/example' },
              { id: 'l2', kind: 'email', url: 'mailto:rina@example.com' },
              { id: 'l3', kind: 'facebook', url: 'http://insecure.example.com' },
            ],
          },
          { id: 'm2', media_id: null, name: 'Karim Hasan', role: 'Delivery', bio: '', links: [{ id: 'l1', kind: 'website', url: 'http://karim.example.com' }] },
        ],
        columns: { base: 2, mobile: 1 },
        style: 'circle',
      }),
    ])
    const team = await screen.findByRole('list', { name: 'Our team' })
    expect(within(team).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Rina Akter', 'Karim Hasan'])
    const instagram = within(team).getByRole('link', { name: 'Rina Akter on Instagram (opens in a new tab)' })
    expect(instagram).toHaveAttribute('target', '_blank')
    expect(instagram).toHaveAttribute('rel', 'noopener noreferrer')
    const mail = within(team).getByRole('link', { name: 'Email Rina Akter' })
    expect(mail).toHaveAttribute('href', 'mailto:rina@example.com')
    expect(mail).not.toHaveAttribute('target')
    expect(within(team).queryByRole('link', { name: /Facebook/ })).toBeNull()
    expect(within(team).getByRole('link', { name: 'Karim Hasan: website (opens in a new tab)' })).toHaveAttribute('href', 'http://karim.example.com')
    expect(team).toHaveStyle({ '--b-cols': '2', '--b-cols-m': '1' })
  })

  it('shows approved reviews with stars read out, the average, product links, and a carousel layout', async () => {
    const data = { e_wall: { summary: { average: '4.6', count: 128 }, reviews: REVIEWS } }
    const { unmount } = renderElements([elementNode('review_wall', 'e_wall', { title: 'Loved by customers' })], { data })
    const wall = await screen.findByRole('region', { name: 'Loved by customers' })
    expect(within(wall).getByTestId('review-summary')).toHaveTextContent('4.6 out of 5 · 128 reviews')
    expect(within(wall).getByRole('img', { name: 'Rated 4.6 out of 5' })).toBeInTheDocument()
    expect(within(wall).getByRole('img', { name: 'Rated 5 out of 5' })).toBeInTheDocument()
    expect(within(wall).getAllByRole('img', { name: 'Rated 4 out of 5' })).toHaveLength(2)
    expect(within(wall).getByRole('link', { name: 'About Green Tea' })).toHaveAttribute('href', '/product/green-tea')
    expect(within(wall).getByText('Rina A.')).toBeInTheDocument()
    unmount()

    renderElements([elementNode('review_wall', 'e_wall', { title: 'Loved by customers', layout: 'carousel', show_product: false })], { data })
    const carousel = await screen.findByRole('group', { name: 'Loved by customers' })
    expect(carousel).toHaveAttribute('aria-roledescription', 'carousel')
    expect(within(carousel).getAllByRole('listitem')).toHaveLength(3)
    expect(within(carousel).queryByRole('link', { name: 'About Green Tea' })).toBeNull()
  })

  it('drops an empty review wall for visitors', async () => {
    renderElements([elementNode('heading', 'e_h', { text: 'Top' }), elementNode('review_wall', 'e_wall')], { data: { e_wall: { summary: null, reviews: [] } } })
    await screen.findByRole('heading', { name: 'Top' })
    expect(document.querySelector('[data-b="e_wall"]')).toBeNull()
  })

  it('links photo grid photos: same tab inside the store, a new tab (announced) outside it', async () => {
    renderElements([
      elementNode('photo_grid', 'e_photos', {
        images: [
          { id: 'g1', media_id: MEDIA.tea, alt: 'Tea on a table', link: null },
          { id: 'g2', media_id: MEDIA.front, alt: 'Our shop front', link: { url: '/pages/about' } },
          { id: 'g3', media_id: MEDIA.mugs, alt: '', link: { url: 'https://www.instagram.com/p/example' } },
        ],
        columns: { base: 6, mobile: 3 },
        profile: { label: '@littlesprouts', url: 'https://www.instagram.com/littlesprouts' },
        hover: 'zoom',
      }),
    ])
    const grid = await screen.findByRole('list', { name: '@littlesprouts' })
    expect(within(grid).getByRole('img', { name: 'Tea on a table' })).toBeInTheDocument()
    const inside = within(grid).getByRole('link', { name: 'Our shop front' })
    expect(inside).toHaveAttribute('href', '/pages/about')
    expect(inside).not.toHaveAttribute('target')
    const outside = within(grid).getByRole('link', { name: 'Photo 3 of 3 (opens in a new tab)' })
    expect(outside).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '@littlesprouts (opens in a new tab)' })).toHaveAttribute('href', 'https://www.instagram.com/littlesprouts')
  })
})

/* ============================================================================================= */

describe('B8a store hours', () => {
  const hours = hoursOf(WEEK_HOURS)!

  it('computes open now across midnight and the next opening', () => {
    // Saturday 18:00–02:00: open late Saturday and early Sunday.
    expect(openStatus(hours, { day: 'sat', minutes: 23 * 60 })).toEqual({ open: true, closes: 120 })
    expect(openStatus(hours, { day: 'sun', minutes: 90 })).toEqual({ open: true, closes: 120 })
    expect(openStatus(hours, { day: 'sun', minutes: 150 })).toEqual({ open: false, opens: { day: 'sun', minutes: 720, today: true } })
    expect(openStatus(hours, { day: 'sat', minutes: 600 })).toEqual({ open: false, opens: { day: 'sat', minutes: 1080, today: true } })
    // Thursday after closing → Friday is closed → Saturday 18:00.
    expect(openStatus(hours, { day: 'thu', minutes: 21 * 60 })).toEqual({ open: false, opens: { day: 'sat', minutes: 1080, today: false } })
    expect(openStatus(hours, { day: 'mon', minutes: 600 })).toEqual({ open: true, closes: 1260 })
    const allDay = hours.map((day) => ({ ...day, closed: false, open: 0, close: 0 }))
    expect(openStatus(allDay, { day: 'fri', minutes: 5 })).toEqual({ open: true, closes: null })
    expect(openStatus(hours.map((day) => ({ ...day, closed: true })), { day: 'mon', minutes: 0 })).toEqual({ open: false, opens: null })
  })

  it('reads the clock in the store time zone and orders the week from Saturday', () => {
    // 19:30 UTC on Saturday 14 Nov 2026 is 01:30 on Sunday in Dhaka (UTC+6).
    expect(zonedNow(new Date('2026-11-14T19:30:00Z'), 'Asia/Dhaka')).toEqual({ day: 'sun', minutes: 90 })
    expect(zonedNow(new Date('2026-11-14T19:30:00Z'), 'UTC')).toEqual({ day: 'sat', minutes: 1170 })
    expect(zonedNow(new Date(), 'Not/AZone')).toBeNull()
    expect(displayOrder(hours, 'sat').map((day) => day.day)).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'])
    expect(displayOrder(hours, 'sun')[0]!.day).toBe('sun')
    expect(formatTime(21 * 60, { locale: 'en', banglaDigits: false })).toMatch(/^9:00\s?pm$/i)
    expect(formatTime(10 * 60, { locale: 'bn', banglaDigits: true })).toMatch(/১০:০০/)
    expect(weekdayName('sat', { locale: 'en', banglaDigits: false })).toBe('Saturday')
  })

  it('shows the week, marks today with a label and says whether the shop is open now (after mount, every minute)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T19:30:00Z'))
    renderElements([elementNode('store_hours', 'e_hours', { days: WEEK_HOURS, title: 'Opening hours', note: 'Closed on public holidays.' })], { data: { e_hours: { timezone: 'Asia/Dhaka' } } })
    const section = await screen.findByRole('region', { name: 'Opening hours' })
    const status = await within(section).findByTestId('hours-status')
    expect(status).toHaveTextContent(/^Open now · closes 2:00\s?am$/i)
    const rows = within(section).getAllByRole('rowheader')
    expect(rows.map((th) => th.textContent?.replace('Today', '').trim())).toEqual(['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    const today = rows[1]!.closest('tr')!
    expect(today).toHaveAttribute('data-today', 'true')
    expect(within(today).getByText('Today')).toBeInTheDocument()
    expect(within(today).getByRole('cell')).toHaveTextContent(/12:00\s?pm – 8:00\s?pm/i)
    expect(within(rows[6]!.closest('tr')!).getByRole('cell')).toHaveTextContent('Closed')
    expect(within(section).getByText('Closed on public holidays.')).toBeInTheDocument()
  })

  it('says when a closed shop opens next, in Bangla with Bengali digits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Thursday 22:00 in Dhaka: closed; Friday closed; opens Saturday 18:00.
    vi.setSystemTime(new Date('2026-11-12T16:00:00Z'))
    const builder = payloadOf(documentOf([elementNode('store_hours', 'e_hours', { days: WEEK_HOURS, title: 'Hours' })]), { key: 'cms:x', locale: 'bn', data: { e_hours: { timezone: 'Asia/Dhaka' } }, media })
    renderPayload(builder, {}, { bootstrap: bilingualBootstrap({ bangla_digits: true }), path: '/pages/about?lang=bn' })
    const status = await screen.findByTestId('hours-status')
    await waitFor(() => expect(status).toHaveTextContent('এখন বন্ধ · খুলবে শনিবার'))
    expect(status.textContent).toMatch(/৬:০০/)
    const today = document.querySelector('[data-today="true"]')!
    expect(today).toHaveTextContent('আজ')
  })

  it('refreshes the status as the minutes pass', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    // Monday 20:59 in Dhaka: open; a minute later it is 21:00 and closed.
    vi.setSystemTime(new Date('2026-11-16T14:59:00Z'))
    renderElements([elementNode('store_hours', 'e_hours', { days: WEEK_HOURS, title: 'Opening hours', show_open_now: true })], { data: { e_hours: { timezone: 'Asia/Dhaka' } } })
    const status = await screen.findByTestId('hours-status')
    expect(status).toHaveTextContent(/closes 9:00\s?pm/i)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    expect(screen.getByTestId('hours-status')).toHaveTextContent(/^Closed · opens 10:00\s?am Tuesday$/i)
  })
})

/* ============================================================================================= */

describe('the shared B8a fixture', () => {
  it('draws every non-chart element with its data, in Bangla', async () => {
    const endsAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const data: Record<string, BuilderData> = {
      e_compare: { products: { [KETTLE]: productCard('basic-kettle', { id: KETTLE }), [SMART]: productCard('smart-kettle', { id: SMART }) } },
      e_flash: { promotion: { id: uuid(0xf1), name: 'Flash', ends_at: endsAt }, products: [productCard('green-tea')], claimed: null },
      e_bundle: { products: bundleProducts() },
      e_reviews: { summary: { average: '4.5', count: 10 }, reviews: REVIEWS },
      e_hours: { timezone: 'Asia/Dhaka' },
    }
    const builder = payloadOf(b8aFixture, { key: 'cms:x', locale: 'bn', data, media })
    const { container } = renderPayload(builder, {}, { bootstrap: bilingualBootstrap(), path: '/pages/about?lang=bn' })
    await screen.findByTestId('builder-pricing')
    for (const id of ['e_pricing', 'e_before_after', 'e_compare', 'e_flash', 'e_bundle', 'e_team', 'e_reviews', 'e_photos', 'e_hours', 'e_progress']) {
      expect(container.querySelector(`[data-b="${id}"]`), id).not.toBeNull()
    }
    expect(screen.getByRole('heading', { name: 'শুরুর বাক্স' })).toBeInTheDocument()
    expect(screen.getByText('উপহারের মোড়ক')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /অন্য দোকান/ })).toBeInTheDocument()
    expect(screen.getByText('৬ মাস')).toBeInTheDocument()
    expect(screen.getByText('প্রতিষ্ঠাতা')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'আগে ও পরে তুলনা করুন' })).toHaveAttribute('aria-orientation', 'vertical')
    expect(screen.getByRole('link', { name: /@লিটলস্প্রাউটস/ })).toBeInTheDocument()
  })
})
