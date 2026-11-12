import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { cloneSample, samplePage } from './builder/test-payload'
import { bilingualBootstrap, bootstrapFixture, resetLocale } from './test-fixtures'
import type { StoreSection } from './types'

afterEach(resetLocale)

const legacySections: StoreSection[] = [
  { id: 's-1', type: 'features_strip', title: 'Why us', subtitle: null, config: { items: [{ icon: 'truck', title: 'Fast delivery', text: null }], background: null } },
]

const builderBootstrap = (home = true) => bootstrapFixture({ builder: { home } })

function requested(fetchMock: ReturnType<typeof mockApi>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

describe('store builder front page', () => {
  it('renders every element type of the published page, with its compiled styles', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(builderBootstrap()), 'GET /store/builder/pages/home': ok(samplePage()) })
    const { container } = renderRoutes(storefrontRoutes)

    const page = await screen.findByTestId('builder-page')
    expect(requested(fetchMock)).toContainEqual(expect.stringContaining('/store/builder/pages/home?lang=en'))
    expect(requested(fetchMock).some((url) => url.includes('/store/homepage'))).toBe(false)

    // heading (level kept), text (rich text), button (router link), image (media + alt), spacer, divider, inner row.
    expect(within(page).getByRole('heading', { level: 2, name: 'Made fresh every morning' })).toHaveAttribute('data-b', 'e_heading')
    const text = container.querySelector('[data-b="e_text"]')!
    expect(text).toHaveClass('sf-rich-text')
    expect(within(text as HTMLElement).getByText('no shortcuts').tagName).toBe('STRONG')
    expect(within(page).getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/shop')
    expect(within(page).getByRole('link', { name: 'Shop now' })).toHaveAttribute('data-b', 'e_button')
    const img = within(page).getByRole('img', { name: 'Fresh vegetables on a table' })
    expect(img).toHaveAttribute('src', '/storage/media/o/vegetables.jpg')
    expect(img).toHaveAttribute('srcset', expect.stringContaining('vegetables-640.webp 640w'))
    expect(img).toHaveAttribute('sizes', '(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 50vw')
    expect(img.closest('[data-b="e_image"]')).toHaveStyle({ aspectRatio: '4 / 3' })
    expect(container.querySelector('[data-b="e_spacer"]')).toHaveClass('b-spacer')
    expect(container.querySelector('[data-b="e_divider"] hr')).toHaveStyle({ width: '60%', borderTopStyle: 'dashed', borderTopWidth: '2px' })
    expect(container.querySelector('[data-b-row="e_row"]')!.querySelectorAll(':scope > .b-col')).toHaveLength(3)
    expect(within(page).getByRole('heading', { level: 3, name: 'Free delivery' })).toBeInTheDocument()

    // Sections: layout classes and the anchor.
    expect(container.querySelector('section[data-b="s_story"]')).toHaveAttribute('id', 'our-story')
    expect(container.querySelector('[data-b="s_hero"] > .b-container')).toHaveClass('b-bleed')
    expect(container.querySelector('[data-b="s_story"] > .b-container')).toHaveClass('b-boxed')

    // One style element with the compiled CSS.
    const styles = container.querySelectorAll('style')
    expect(styles).toHaveLength(1)
    expect(styles[0]!.textContent).toContain('[data-b="e_heading"]{color:var(--sf-heading)')
    expect(styles[0]!.textContent).toContain('@media (max-width: 639px){')
  })

  it('renders wrapped sections through the homepage section components', async () => {
    mockApi({ 'GET /store/bootstrap': ok(builderBootstrap()), 'GET /store/builder/pages/home': ok(samplePage()) })
    renderRoutes(storefrontRoutes)

    const wrapped = await screen.findAllByTestId('builder-section')
    expect(wrapped.map((el) => el.dataset.sectionType)).toEqual(['hero_slider', 'product_grid'])
    expect(wrapped[0]!.closest('[data-b]')).toHaveAttribute('data-b', 'e_slider')
    // The hero slider and the product grid as on the homepage.
    const carousel = screen.getByRole('region', { name: 'Featured' })
    expect(within(carousel).getByRole('link', { name: 'Order a box' })).toHaveAttribute('href', '/shop')
    const grid = screen.getByRole('region', { name: 'Best sellers' })
    expect(within(grid).getByRole('heading', { level: 2, name: 'Best sellers' })).toBeInTheDocument()
    expect(within(grid).getByText('What everyone is buying')).toBeInTheDocument()
    expect(within(grid).getAllByTestId('product-card')).toHaveLength(2)
  })

  it('never draws hidden nodes on a published page', async () => {
    // Defence in depth: even if a hidden node arrived, it is skipped.
    const page = samplePage({ source: 'draft' })
    page.document.source = 'published'
    mockApi({ 'GET /store/bootstrap': ok(builderBootstrap()), 'GET /store/builder/pages/home': ok(page) })
    const { container } = renderRoutes(storefrontRoutes)

    await screen.findByTestId('builder-page')
    expect(container.querySelector('[data-b="s_hidden"]')).toBeNull()
    expect(screen.queryByText('Draft note, hidden from shoppers.')).not.toBeInTheDocument()
    expect(container.querySelector('[data-node-state]')).toBeNull()
  })

  it('shows staff the draft with hidden parts marked for ?preview=draft', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(builderBootstrap(false)), 'GET /store/builder/pages/home': ok(samplePage({ source: 'draft' })) })
    const { container } = renderRoutes(storefrontRoutes, '/?preview=draft')

    expect(await screen.findByText('Draft preview — not published yet. Parts visitors do not see are marked.')).toHaveAttribute('role', 'status')
    expect(requested(fetchMock)).toContainEqual(expect.stringMatching(/\/store\/builder\/pages\/home\?(?=.*preview=draft)(?=.*lang=en)/))
    const marked = container.querySelector('[data-node-state="hidden"]')!
    expect(within(marked as HTMLElement).getByText('Hidden — visitors do not see this')).toBeInTheDocument()
    expect(within(marked as HTMLElement).getByText('Draft note, hidden from shoppers.')).toBeInTheDocument()
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow'))
  })

  it('marks a hidden wrapped section in the draft with the homepage preview frame', async () => {
    const page = samplePage({ source: 'draft' })
    const grid = page.sections[3]!.columns[0]!.elements[0]!
    grid.state = 'hidden'
    page.data.e_grid = { ...page.data.e_grid!, state: 'hidden' as never }
    mockApi({ 'GET /store/bootstrap': ok(builderBootstrap()), 'GET /store/builder/pages/home': ok(page) })
    renderRoutes(storefrontRoutes, '/?preview=draft')

    const wrapped = await screen.findAllByTestId('builder-section')
    const marked = wrapped.find((el) => el.dataset.sectionType === 'product_grid')!
    expect(within(marked).getByText('Hidden — visitors do not see this section')).toBeInTheDocument()
    expect(within(marked).getAllByTestId('product-card')).toHaveLength(2)
  })

  it('keeps the homepage sections when the store has no builder front page', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(builderBootstrap(false)), 'GET /store/homepage': ok({ sections: legacySections, preview: false }) })
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { name: 'Fast delivery' })).toBeInTheDocument()
    expect(screen.getAllByTestId('homepage-section')).toHaveLength(1)
    expect(screen.queryByTestId('builder-page')).not.toBeInTheDocument()
    expect(requested(fetchMock).some((url) => url.includes('/store/builder/pages'))).toBe(false)
  })

  it('falls back to the homepage sections when the front page is gone (404)', async () => {
    mockApi({
      'GET /store/bootstrap': ok(builderBootstrap()),
      'GET /store/builder/pages/home': fail(404, 'PAGE_NOT_FOUND', 'This page does not exist.'),
      'GET /store/homepage': ok({ sections: legacySections, preview: false }),
    })
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { name: 'Fast delivery' })).toBeInTheDocument()
    expect(screen.queryByTestId('builder-page')).not.toBeInTheDocument()
  })

  it('offers a retry when the page fails to load', async () => {
    mockApi({ 'GET /store/bootstrap': ok(builderBootstrap()), 'GET /store/builder/pages/home': fail(500, 'SERVER_ERROR') })
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { name: 'This page could not be loaded' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('passes the Bangla locale through and shows the Bangla texts', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap({}, { builder: { home: true } })),
      'GET /store/builder/pages/home': (_init, url) => ok(samplePage({ locale: url.searchParams.get('lang') ?? 'en' })),
    })
    renderRoutes(storefrontRoutes, '/?lang=bn')

    expect(await screen.findByRole('heading', { level: 2, name: 'প্রতিদিন সকালে তাজা তৈরি' })).toBeInTheDocument()
    expect(requested(fetchMock)).toContainEqual(expect.stringContaining('/store/builder/pages/home?lang=bn'))
    expect(screen.getByRole('link', { name: 'এখনই কিনুন' })).toHaveAttribute('href', '/shop')
    expect(screen.getByRole('img', { name: 'টেবিলে তাজা সবজি' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'সবচেয়ে বেশি বিক্রি' })).toBeInTheDocument()
  })
})

describe('store builder landing pages', () => {
  it('renders /p/:slug with the document title', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/builder/pages/summer-sale': ok(samplePage({ key: 'landing:summer-sale', title: 'Summer sale' })),
    })
    renderRoutes(storefrontRoutes, '/p/summer-sale')

    expect(await screen.findByRole('heading', { level: 2, name: 'Made fresh every morning' })).toBeInTheDocument()
    expect(screen.getByTestId('builder-page')).toHaveAttribute('data-document-key', 'landing:summer-sale')
    await waitFor(() => expect(document.title).toBe('Summer sale | Berry Kids'))
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'http://localhost:3000/p/summer-sale')
    expect(requested(fetchMock).some((url) => url.includes('/store/pages/'))).toBe(false)
  })

  it('shows the not-found page for an unknown or invalid slug', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/builder/pages/gone': fail(404, 'PAGE_NOT_FOUND', 'This page does not exist.') })
    const { router } = renderRoutes(storefrontRoutes, '/p/gone')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    await router.navigate('/p/Not_A_Slug')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('sends /p/home to the front page', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: legacySections, preview: false }) })
    const { router } = renderRoutes(storefrontRoutes, '/p/home')

    expect(await screen.findByRole('heading', { name: 'Fast delivery' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('drops a button whose link is not a safe URL and an element of an unknown type', async () => {
    const document = cloneSample()
    const column = document.sections[1]!.columns[0]!
    const button = column.elements[2]!
    if (button.type === 'button') button.props.link = { url: 'javascript:alert(1)' }
    column.elements.push({ ...column.elements[0]!, id: 'e_future', type: 'hologram' } as unknown as (typeof column.elements)[number])
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/builder/pages/promo': ok(samplePage({ document, key: 'landing:promo' })) })
    const { container } = renderRoutes(storefrontRoutes, '/p/promo')

    await screen.findByTestId('builder-page')
    expect(screen.queryByRole('link', { name: 'Shop now' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-b="e_button"]')!.tagName).toBe('SPAN')
    expect(container.querySelector('[href^="javascript"]')).toBeNull()
    expect(container.querySelector('[data-b="e_future"]')).toBeNull()
  })
})
