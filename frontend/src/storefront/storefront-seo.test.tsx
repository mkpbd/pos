import { act, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { PageLoadingView } from './components/state-views'
import { storefrontRoutes } from './routes'
import { blogPostDetail, blogPostRow, bootstrapFixture, listingBody, productCard, productDetail } from './test-fixtures'
import type { MediaRef, StoreBanner, StoreCategory, StorePage, StoreSection } from './types'

const origin = window.location.origin

const head = {
  description: () => document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
  canonical: () => document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
  robots: () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
  og: (key: string) => document.head.querySelector(`meta[property="og:${key}"]`)?.getAttribute('content') ?? null,
}

beforeEach(() => {
  document.head.querySelectorAll('meta[name], meta[property], link[rel="canonical"]').forEach((el) => el.remove())
  document.title = ''
})

const media = (id: string): MediaRef => ({ id, url: `/storage/media/${id}.jpg`, srcset: `/storage/media/${id}-640.webp 640w, /storage/media/${id}.jpg 1600w`, width: 1600, height: 900, alt: null })

const banner = (id: string): StoreBanner => ({
  id,
  kicker: null,
  title: `Banner ${id}`,
  subtitle: null,
  link_url: null,
  button_label: null,
  secondary_link_url: null,
  secondary_button_label: null,
  image: media(id),
  mobile_image: null,
  text_color: '#ffffff',
  text_position: 'left',
})

const aboutPage: StorePage = {
  slug: 'about',
  title: 'About us',
  template: 'default',
  body_html: '<p>We sell clothes.</p>',
  published_at: null,
  seo_title: 'Our story',
  seo_description: 'Who we are.',
  updated_at: null,
}

const juices: StoreCategory = {
  id: 'c-1',
  slug: 'juices',
  name: 'Fresh juices',
  description_html: '<p>Cold-pressed <strong>every</strong> morning.</p>',
  image: null,
  banner: media('juices-banner'),
  seo: { title: null, description: null },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Fresh juices', url: null }],
  children: [],
}

describe('document head manager', () => {
  it('follows in-app navigation: product, filtered listing, plain listing, content page; restores the store defaults', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products/kids-tee': ok(productDetail({ seo: { title: 'Organic Kids Tee', description: null, image_url: null } })),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products': { body: listingBody([productCard('mango-juice')], { total: 60 }) },
      'GET /store/pages/about': ok(aboutPage),
    })
    const { router, unmount } = renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-blue-l')

    await waitFor(() => expect(document.title).toBe('Organic Kids Tee | Berry Kids'))
    expect(head.description()).toBe('Soft cotton tee.')
    // One canonical URL per product, without ?variant=.
    expect(head.canonical()).toBe(`${origin}/product/kids-tee`)
    expect(head.robots()).toBeNull()
    expect(head.og('type')).toBe('product')
    expect(head.og('title')).toBe('Organic Kids Tee | Berry Kids')
    expect(head.og('url')).toBe(`${origin}/product/kids-tee`)
    expect(head.og('image')).toBe(`${origin}/storage/products/tee-red.png`)

    // A sorted/filtered listing: noindex, canonical to the unfiltered listing (page kept).
    await act(() => router.navigate('/shop?sort=price_asc&in_stock=1&page=2'))
    await waitFor(() => expect(document.title).toBe('Shop | Berry Kids'))
    expect(head.canonical()).toBe(`${origin}/shop?page=2`)
    expect(head.robots()).toBe('noindex, follow')
    expect(head.og('type')).toBe('website')
    expect(head.og('image')).toBeNull()
    expect(head.description()).toBe('Clothes and toys for little ones')

    await act(() => router.navigate('/shop'))
    await waitFor(() => expect(head.robots()).toBeNull())
    expect(head.canonical()).toBe(`${origin}/shop`)

    // A lazily loaded content page.
    await act(() => router.navigate('/pages/about?utm_source=mail'))
    expect(await screen.findByRole('heading', { level: 1, name: 'About us' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Our story | Berry Kids'))
    expect(head.description()).toBe('Who we are.')
    expect(head.canonical()).toBe(`${origin}/pages/about`)

    unmount()
    expect(document.title).toBe('Berry Kids')
    expect(head.description()).toBe('Clothes and toys for little ones')
    expect(head.robots()).toBeNull()
    expect(head.og('title')).toBe('Berry Kids')
  })

  it('marks search results and private pages noindex, and 404s', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products': { body: listingBody([productCard('mango-juice')]) },
    })
    const { router } = renderRoutes(storefrontRoutes, '/search?q=mango')

    await waitFor(() => expect(document.title).toBe('Search results for “mango” | Berry Kids'))
    expect(head.robots()).toBe('noindex, follow')
    expect(head.canonical()).toBe(`${origin}/search`)

    await act(() => router.navigate('/no-such-page'))
    await waitFor(() => expect(document.title).toBe('Page not found | Berry Kids'))
    expect(head.robots()).toBe('noindex, follow')

    await act(() => router.navigate('/wishlist'))
    await waitFor(() => expect(document.title).toBe('Wishlist | Berry Kids'))
    expect(head.robots()).toBe('noindex, follow')
  })

  it('describes category pages from their data and keeps ?page=N in the canonical', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/categories/juices': ok(juices),
      'GET /store/products': { body: listingBody([productCard('mango-juice')], { total: 80, page: 3 }) },
    })
    renderRoutes(storefrontRoutes, '/category/juices?page=3')

    await waitFor(() => expect(document.title).toBe('Fresh juices | Berry Kids'))
    expect(head.canonical()).toBe(`${origin}/category/juices?page=3`)
    expect(head.robots()).toBeNull()
    expect(head.description()).toBe('Cold-pressed every morning.')
    expect(head.og('image')).toBe(`${origin}/storage/media/juices-banner.jpg`)

    // The category banner is the page's LCP image.
    const bannerImg = document.querySelector<HTMLImageElement>('img[src="/storage/media/juices-banner.jpg"]')!
    expect(bannerImg).toHaveAttribute('loading', 'eager')
    expect(bannerImg).toHaveAttribute('fetchpriority', 'high')
  })

  it('describes blog posts as articles', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/mango-lassi': ok(blogPostDetail('mango-lassi', { seo_description: 'A cool drink.' })),
    })
    renderRoutes(storefrontRoutes, '/blog/mango-lassi')

    await waitFor(() => expect(document.title).toBe('Mango Lassi | Berry Kids'))
    expect(head.og('type')).toBe('article')
    expect(head.description()).toBe('A cool drink.')
    expect(head.og('image')).toBe(`${origin}/storage/media/o/cover.jpg`)
    expect(head.canonical()).toBe(`${origin}/blog/mango-lassi`)

    // The cover is the post's LCP image.
    const cover = document.querySelector<HTMLImageElement>('img[src="/storage/media/o/cover.jpg"]')!
    expect(cover).toHaveAttribute('fetchpriority', 'high')
    expect(cover).toHaveAttribute('loading', 'eager')
    expect(cover).toHaveAttribute('sizes', '(min-width: 768px) 768px, 100vw')
  })

  it('is noindex everywhere when the owner turned indexing off', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture({ store: { ...bootstrapFixture().store, allow_indexing: false } })),
      'GET /store/homepage': ok({ sections: [], preview: false }),
    })
    const { unmount } = renderRoutes(storefrontRoutes, '/')

    await waitFor(() => expect(document.title).toBe('Berry Kids'))
    await waitFor(() => expect(head.robots()).toBe('noindex, follow'))
    expect(head.canonical()).toBe(`${origin}/`)
    unmount()
    expect(head.robots()).toBe('noindex, follow')
  })
})

describe('image loading', () => {
  it('loads the first hero slide eagerly at high priority and everything else lazily', async () => {
    const sections: StoreSection[] = [
      { id: 's-1', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'large' }, banners: [banner('hero-1'), banner('hero-2')] },
      { id: 's-2', type: 'banner_grid', title: null, subtitle: null, config: { layout: '2-col' }, banners: [banner('tile-1'), banner('tile-2')] },
      { id: 's-3', type: 'blog_posts', title: 'From the blog', subtitle: null, config: { category_id: null, limit: 3 }, posts: [blogPostRow('mango-lassi')] },
    ]
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections, preview: false }) })
    renderRoutes(storefrontRoutes, '/')

    await screen.findAllByTestId('homepage-section')
    const img = (src: string) => document.querySelector<HTMLImageElement>(`img[src="${src}"]`)!

    const hero = img('/storage/media/hero-1.jpg')
    expect(hero).toHaveAttribute('loading', 'eager')
    expect(hero).toHaveAttribute('fetchpriority', 'high')
    expect(hero).toHaveAttribute('sizes', '100vw')
    expect(hero).toHaveAttribute('width', '1600')
    expect(hero).toHaveAttribute('height', '900')

    for (const src of ['/storage/media/hero-2.jpg', '/storage/media/tile-1.jpg', '/storage/media/o/cover.jpg']) {
      const lazy = img(src)
      expect(lazy).toHaveAttribute('loading', 'lazy')
      expect(lazy).toHaveAttribute('decoding', 'async')
      expect(lazy).not.toHaveAttribute('fetchpriority')
      expect(lazy.getAttribute('sizes')).toBeTruthy()
      expect(lazy).toHaveAttribute('width')
      expect(lazy).toHaveAttribute('height')
    }
  })

  it('loads the product main image at high priority and the thumbnails lazily', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products': { body: listingBody([], { facets: null }) },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const gallery = await screen.findByTestId('product-gallery')
    const main = within(within(gallery).getByRole('button', { name: /full screen/ })).getByRole('img', { name: 'Red tee' })
    expect(main).toHaveAttribute('fetchpriority', 'high')
    expect(main).toHaveAttribute('loading', 'eager')
    expect(main).toHaveAttribute('width', '600')
    const thumbs = within(within(gallery).getByRole('list', { name: 'Product images' })).getAllByRole('img', { hidden: true })
    for (const thumb of thumbs) {
      expect(thumb).toHaveAttribute('loading', 'lazy')
      expect(thumb).not.toHaveAttribute('fetchpriority')
    }
  })
})

describe('lazy routes', () => {
  it('shows an accessible loading state while a page loads', () => {
    render(<PageLoadingView />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading the page')
  })

  it('renders split-off pages (blog index, wishlist) through their routes', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok([]),
      'GET /store/blog': ok([blogPostRow('mango-lassi')], { pagination: { current_page: 1, per_page: 9, total: 1, last_page: 1 }, category: null }),
    })
    const { router } = renderRoutes(storefrontRoutes, '/blog')

    expect(await screen.findByRole('heading', { level: 1, name: 'Blog' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Mango Lassi' })).toHaveAttribute('href', '/blog/mango-lassi')

    await act(() => router.navigate('/wishlist'))
    expect(await screen.findByRole('heading', { level: 1, name: /wishlist/i })).toBeInTheDocument()
  })
})
