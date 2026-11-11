import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DemoStore } from './demos/api'
import { demoAdminUrl, demoStoreUrl, safeColor } from './demos/links'
import { storefrontRoutes } from './routes'
import { resetLocale } from './test-fixtures'
import { headingFontStack } from './theme'

const demo = (host: string, overrides: Partial<DemoStore> = {}): DemoStore => ({
  host,
  name: 'Green Basket',
  preset: 'vegan',
  tagline: 'free delivery over ৳1,500 · 100 % plant-based',
  colors: { primary: '#f6c445', accent: '#2e7d32', canvas: '#fbf8ef' },
  heading_font: 'baloo',
  image_url: '/storage/media/vegan/banner-hero-1.jpg',
  product_count: 24,
  category_names: ['Fruits', 'Vegetables', 'Pantry', 'Drinks'],
  ...overrides,
})

const DEMOS: DemoStore[] = [
  demo('vegan.shop.localhost'),
  demo('handmade.shop.localhost', {
    name: 'Mati & Co.', preset: 'handmade', tagline: 'Handmade in Bangladesh', heading_font: 'playfair', image_url: null,
    colors: { primary: '#9c4a2a', accent: '#3b2a20', canvas: '#f7f2ea' }, product_count: 1, category_names: ['Pottery', 'Textiles'],
  }),
  demo('classic.shop.localhost', { name: 'Classic Shop', preset: 'classic', tagline: null, heading_font: 'jost', category_names: [], product_count: 30 }),
]

const origin = window.location.origin
const storeHref = (host: string) => `${window.location.protocol}//${host}${window.location.port ? `:${window.location.port}` : ''}/`

afterEach(() => {
  resetLocale()
  document.title = ''
  document.head.querySelectorAll('meta[name="robots"]').forEach((meta) => meta.remove())
})

describe('demo gallery: states', () => {
  it('shows a loading skeleton while the list loads', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderRoutes(storefrontRoutes, '/demos')

    expect(await screen.findByRole('heading', { level: 1, name: 'Online store demos' })).toBeInTheDocument()
    expect(screen.getByTestId('demo-loading')).toHaveTextContent('Loading the demo stores')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('lists the demo stores without a store on the host: cards, links and the title', async () => {
    const fetchMock = mockApi({ 'GET /demo-stores': ok(DEMOS) })
    renderRoutes(storefrontRoutes, '/demos')

    const list = await screen.findByRole('list', { name: 'Demo stores' })
    const cards = within(list).getAllByRole('article')
    expect(cards).toHaveLength(3)
    expect(document.title).toBe('Online store demos')
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    // Outside the store layout: no bootstrap, cart or account requests, only the gallery list.
    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname)
    expect(paths).toEqual(['/api/v1/demo-stores'])

    const vegan = screen.getByRole('article', { name: 'Green Basket' })
    expect(vegan).toHaveAttribute('data-preset', 'vegan')
    expect(within(vegan).getByRole('heading', { level: 2, name: 'Green Basket' }).style.fontFamily).toContain('Baloo 2 Variable')
    expect(within(vegan).getByText('Theme: Vegan')).toBeInTheDocument()
    expect(within(vegan).getByText('free delivery over ৳1,500 · 100 % plant-based')).toBeInTheDocument()
    expect(within(vegan).getByTestId('demo-image')).toHaveAttribute('src', '/storage/media/vegan/banner-hero-1.jpg')
    const swatches = within(vegan).getByRole('list', { name: 'Theme colours' })
    expect(within(swatches).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Primary #f6c445', 'Accent #2e7d32', 'Background #fbf8ef'])
    expect(within(vegan).getByTestId('swatch-primary')).toHaveStyle({ backgroundColor: '#f6c445' })
    const chips = within(vegan).getByRole('list', { name: 'Categories' })
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Fruits', 'Vegetables', 'Pantry', 'Drinks'])
    expect(within(vegan).getByText('24 products')).toBeInTheDocument()
    expect(within(vegan).getByRole('link', { name: 'Open store: Green Basket' })).toHaveAttribute('href', storeHref('vegan.shop.localhost'))
    const admin = within(vegan).getByRole('link', { name: 'Open admin: Green Basket' })
    expect(admin).toHaveAttribute('href', `${origin}/admin`)
    expect(admin).toHaveAccessibleDescription(/sign in to the admin with its owner account/i)

    // No image: a block in the preset's colours; the heading in its serif face; one product.
    const mati = screen.getByRole('article', { name: 'Mati & Co.' })
    expect(within(mati).queryByTestId('demo-image')).not.toBeInTheDocument()
    expect(within(mati).getByTestId('demo-color-block').style.background).toContain('linear-gradient')
    expect(within(mati).getByRole('heading', { level: 2 }).style.fontFamily).toContain('Playfair Display Variable')
    expect(within(mati).getByText('Theme: Handmade')).toBeInTheDocument()
    expect(within(mati).getByText('1 product')).toBeInTheDocument()

    // No tagline and no categories: those parts are left out.
    const classic = screen.getByRole('article', { name: 'Classic Shop' })
    expect(within(classic).queryByRole('list', { name: 'Categories' })).not.toBeInTheDocument()
    expect(within(classic).getByRole('link', { name: 'Open store: Classic Shop' })).toHaveAttribute('href', storeHref('classic.shop.localhost'))

    // Links only: no logins anywhere on the page.
    expect(document.body.textContent).not.toMatch(/@|password/i)
  })

  it('says so when the gallery is turned off on the server (404)', async () => {
    mockApi({ 'GET /demo-stores': fail(404, 'NOT_FOUND', 'Not found.') })
    renderRoutes(storefrontRoutes, '/demos')

    expect(await screen.findByTestId('demo-disabled')).toHaveTextContent('Demo gallery is not enabled on this server.')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('tells how to seed the demos when there are none', async () => {
    mockApi({ 'GET /demo-stores': ok([]) })
    renderRoutes(storefrontRoutes, '/demos')

    const empty = await screen.findByTestId('demo-empty')
    expect(empty).toHaveTextContent('No demo stores have been set up yet. Run php artisan db:seed --class=DemoThemesSeeder.')
    expect(within(empty).getByText('php artisan db:seed --class=DemoThemesSeeder').tagName).toBe('CODE')
  })

  it('shows an error with a retry that loads the list', async () => {
    let calls = 0
    mockApi({ 'GET /demo-stores': () => (++calls === 1 ? fail(500, 'SERVER_ERROR') : ok(DEMOS)) })
    renderRoutes(storefrontRoutes, '/demos')
    const user = userEvent.setup()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The demo stores could not be loaded')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findAllByRole('article')).toHaveLength(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('leaves out a store link for a host that is not a host name, and swatches that are not colours', async () => {
    mockApi({ 'GET /demo-stores': ok([demo('javascript:alert(1)', { colors: { primary: 'red;x', accent: '#2e7d32', canvas: 'url(x)' } })]) })
    renderRoutes(storefrontRoutes, '/demos')

    const card = await screen.findByRole('article', { name: 'Green Basket' })
    expect(within(card).queryByRole('link', { name: /Open store/ })).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open admin: Green Basket' })).toBeInTheDocument()
    expect(within(within(card).getByRole('list', { name: 'Theme colours' })).getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('demo gallery: Bangla', () => {
  it('is shown in Bangla from ?lang=bn and switches back to English', async () => {
    mockApi({ 'GET /demo-stores': ok(DEMOS) })
    const { router } = renderRoutes(storefrontRoutes, '/demos?lang=bn')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'অনলাইন স্টোর ডেমো' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('bn')
    await waitFor(() => expect(document.title).toBe('অনলাইন স্টোর ডেমো'))
    const vegan = await screen.findByRole('article', { name: 'Green Basket' })
    expect(within(vegan).getByText('থিম: ভিগান')).toBeInTheDocument()
    expect(within(vegan).getByText('24টি পণ্য')).toBeInTheDocument()
    expect(within(vegan).getByRole('link', { name: 'স্টোর খুলুন: Green Basket' })).toBeInTheDocument()
    expect(document.cookie).toContain('lang=bn')

    await user.click(within(screen.getByRole('group', { name: 'ভাষা' })).getByRole('button', { name: 'English' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Online store demos' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
    expect(document.documentElement.lang).toBe('en')
    expect(document.cookie).toContain('lang=en')
  })

  it('shows the disabled and empty messages in Bangla', async () => {
    mockApi({ 'GET /demo-stores': fail(404, 'NOT_FOUND') })
    renderRoutes(storefrontRoutes, '/demos?lang=bn')
    expect(await screen.findByTestId('demo-disabled')).toHaveTextContent('এই সার্ভারে ডেমো গ্যালারি চালু করা নেই।')
  })
})

describe('demo gallery: links', () => {
  const at = (protocol: string, port: string) => ({ protocol, port, origin: `${protocol}//localhost${port ? `:${port}` : ''}` })

  it('opens a demo on its host with the gallery’s scheme and port', () => {
    expect(demoStoreUrl('vegan.shop.localhost', at('http:', '5173'))).toBe('http://vegan.shop.localhost:5173/')
    expect(demoStoreUrl('vegan.shop.localhost', at('https:', ''))).toBe('https://vegan.shop.localhost/')
    expect(demoStoreUrl(' Classic.Shop.Localhost ', at('http:', ''))).toBe('http://classic.shop.localhost/')
  })

  it('keeps a port the host names, and refuses values that are not host names', () => {
    expect(demoStoreUrl('handmade.shop.localhost:8080', at('http:', '5173'))).toBe('http://handmade.shop.localhost:8080/')
    for (const bad of ['', 'javascript:alert(1)', 'evil.test/path', 'a b', '//evil.test', 'evil.test@x', '-bad.test']) {
      expect(demoStoreUrl(bad, at('http:', '5173'))).toBeNull()
    }
  })

  it('opens the admin on the gallery’s own origin', () => {
    expect(demoAdminUrl(at('http:', '5173'))).toBe('http://localhost:5173/admin')
  })

  it('accepts hex colours only, and maps heading fonts to the theme stacks', () => {
    expect(safeColor('#2e7d32')).toBe('#2e7d32')
    expect(safeColor('#fff')).toBe('#fff')
    expect(safeColor('red')).toBeNull()
    expect(safeColor(null)).toBeNull()
    expect(headingFontStack('playfair')).toContain('Playfair Display Variable')
    expect(headingFontStack('jost')).toContain('Jost Variable')
    expect(headingFontStack('comic-sans')).toContain('system-ui')
    expect(headingFontStack('constructor')).toContain('system-ui')
  })
})
