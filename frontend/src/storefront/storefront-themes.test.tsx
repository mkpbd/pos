import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, listingBody, productCard } from './test-fixtures'
import type { BlogPostRow, LayoutVariants, ProductCard, StoreBanner, StorefrontBootstrap, StoreSection } from './types'

const image = { id: 'img-1', url: '/storage/media/o/hero.jpg', srcset: '/storage/media/o/hero-640.webp 640w', width: 1600, height: 600, alt: null }

const banner = (id: string, overrides: Partial<StoreBanner> = {}): StoreBanner => ({
  id, kicker: null, title: `Banner ${id}`, subtitle: null, link_url: null, button_label: null, secondary_link_url: null, secondary_button_label: null,
  image, mobile_image: null, text_color: '#ffffff', text_position: 'center', ...overrides,
})

const hero = (banners: StoreBanner[]): StoreSection => ({ id: 's-hero', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'large' }, banners })

const grid = (products: ProductCard[]): StoreSection => ({
  id: 's-grid', type: 'product_grid', title: 'Editor’s pick', subtitle: null, config: { source: 'featured', limit: 8, columns: 4 }, products,
})

/** A store in a layout; contact details and a footer menu for the bar and footer variants. */
function store(layout: Partial<LayoutVariants>, overrides: Partial<StorefrontBootstrap['theme']> = {}): StorefrontBootstrap {
  const base = bootstrapFixture()
  return {
    ...base,
    theme: {
      ...base.theme,
      layout: { ...base.theme.layout, ...layout },
      footer: { ...base.theme.footer, about: 'Handmade in Dhaka', contact: { email: 'hello@berry.test', phone: '+880 1711-000000', address: null }, social: { instagram: 'https://instagram.com/berry' } },
      ...overrides,
    },
    menus: { ...base.menus, footer_1: { name: 'Help', items: [{ id: 'f-1', label: 'Shipping', url: '/shipping', open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] }] } },
  }
}

const post = (slug: string): BlogPostRow => ({ slug, title: `Post ${slug}`, excerpt: null, cover: null, category: null, author: null, published_at: '2026-10-01T10:00:00Z', reading_minutes: 3 })

function serve(bootstrap: StorefrontBootstrap, options: { sections?: StoreSection[]; products?: Partial<Record<string, ProductCard[]>>; posts?: BlogPostRow[]; routes?: Parameters<typeof mockApi>[0] } = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/homepage': ok({ sections: options.sections ?? [], preview: false }),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture([cartLine('l-1')])),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/products': (_init, url) => ({ body: listingBody(options.products?.[url.searchParams.get('sort') ?? ''] ?? []) }),
    'GET /store/blog': ok(options.posts ?? [], { current_page: 1, per_page: 9, total: (options.posts ?? []).length, last_page: 1 }),
    ...options.routes,
  })
}

/** jsdom matches no media query; these tests choose the viewport (and motion preference). */
function viewport({ desktop, reducedMotion = false }: { desktop: boolean; reducedMotion?: boolean }) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: (query === DESKTOP_QUERY && desktop) || (query === REDUCED_MOTION_QUERY && reducedMotion),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

afterEach(() => {
  document.documentElement.removeAttribute('style')
  for (const name of [...document.documentElement.getAttributeNames()]) if (name.startsWith('data-sf-')) document.documentElement.removeAttribute(name)
})

describe('theme presets: document', () => {
  it('marks the preset and variants on the root and sets the heading case', async () => {
    serve(store({ heading_case: 'uppercase', card_style: 'commerce' }, { preset: 'classic' }))
    renderRoutes(storefrontRoutes)

    await screen.findByTestId('site-header')
    const root = document.documentElement
    expect(root).toHaveAttribute('data-sf-preset', 'classic')
    expect(root).toHaveAttribute('data-sf-card', 'commerce')
    expect(root).toHaveAttribute('data-sf-header', 'standard')
    expect(root.style.getPropertyValue('--sf-heading-transform')).toBe('uppercase')
  })

  it('a theme without layout variants keeps today’s header, announcement bar and footer', async () => {
    viewport({ desktop: true })
    serve(store({}, { announcement: { text: 'Free delivery', link: null, background: '#000000', foreground: '#ffffff' } }))
    renderRoutes(storefrontRoutes)

    expect(await screen.findByTestId('announcement-bar')).toHaveTextContent('Free delivery')
    expect(screen.queryByTestId('announcement-ticker')).not.toBeInTheDocument()
    expect(screen.getByTestId('site-header')).not.toHaveAttribute('data-header-style')
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'bar')
    expect(screen.getByTestId('site-footer')).not.toHaveAttribute('data-footer-style')
    expect(document.documentElement).toHaveAttribute('data-sf-preset', 'default')
  })
})

describe('header variants', () => {
  it('centered: the brand in the middle, a search panel from the icon, an airy menu row', async () => {
    viewport({ desktop: true })
    serve(store({ header_style: 'centered' }))
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const header = await screen.findByTestId('site-header')
    expect(header).toHaveAttribute('data-header-style', 'centered')
    expect(within(header).getByRole('link', { name: 'Berry Kids home' })).toHaveClass('justify-center')
    expect(within(header).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'centered')

    await user.click(within(header).getByRole('button', { name: 'Open search' }))
    const panel = await screen.findByRole('dialog', { name: 'Search the store' })
    expect(within(panel).getByRole('combobox', { name: 'Search products' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('commerce: a wide search field and the cart with its count and total; a dark menu bar', async () => {
    viewport({ desktop: true })
    serve(store({ header_style: 'commerce' }))
    renderRoutes(storefrontRoutes)

    const header = await screen.findByTestId('site-header')
    expect(header).toHaveAttribute('data-header-style', 'commerce')
    expect(within(header).getByRole('combobox', { name: 'Search products' })).toBeInTheDocument()
    expect(await within(header).findByRole('button', { name: 'Cart, 2 items, ৳900.00' })).toBeInTheDocument()
    expect(within(header).getByTestId('cart-total')).toHaveTextContent('৳900.00')
    expect(within(header).getByRole('link', { name: 'Wishlist' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'commerce')
  })

  it('falls back to the standard mobile header below the desktop breakpoint', async () => {
    viewport({ desktop: false })
    serve(store({ header_style: 'commerce', top_bar: 'utility' }, { announcement: { text: 'Free delivery', link: null, background: '#000000', foreground: '#ffffff' } }))
    renderRoutes(storefrontRoutes)

    const header = await screen.findByTestId('site-header')
    expect(header).not.toHaveAttribute('data-header-style')
    expect(within(header).getByRole('button', { name: 'Open search' })).toHaveAttribute('aria-controls', 'mobile-search')
    expect(within(header).getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    // The utility row is desktop-only: phones get the announcement bar.
    expect(screen.queryByTestId('utility-bar')).not.toBeInTheDocument()
    expect(screen.getByTestId('announcement-bar')).toHaveTextContent('Free delivery')
  })
})

describe('top bar variants', () => {
  const announcement = { text: 'Fresh vegetables every morning', link: '/fresh', background: '#2e7d32', foreground: '#ffffff' }

  it('ticker: scrolls decorative copies, one real link, and a pause button', async () => {
    serve(store({ top_bar: 'ticker' }, { announcement }))
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const ticker = await screen.findByRole('region', { name: 'Announcement' })
    expect(ticker).toHaveAttribute('data-motion', 'scroll')
    expect(within(ticker).getByRole('link', { name: 'Fresh vegetables every morning' })).toHaveAttribute('href', '/fresh')
    // The moving copies are hidden from assistive technology.
    expect(within(ticker).getAllByText('Fresh vegetables every morning').filter((el) => el.closest('[aria-hidden="true"]')).length).toBeGreaterThan(1)

    const pause = within(ticker).getByRole('button', { name: 'Pause the announcement' })
    await user.click(pause)
    expect(ticker).toHaveAttribute('data-paused', 'true')
    expect(within(ticker).getByRole('button', { name: 'Play the announcement' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ticker: stands still for visitors who prefer reduced motion', async () => {
    viewport({ desktop: true, reducedMotion: true })
    serve(store({ top_bar: 'ticker' }, { announcement: { ...announcement, link: null } }))
    renderRoutes(storefrontRoutes)

    const ticker = await screen.findByRole('region', { name: 'Announcement' })
    expect(ticker).toHaveAttribute('data-motion', 'static')
    expect(within(ticker).getAllByText('Fresh vegetables every morning')).toHaveLength(1)
    expect(within(ticker).queryByRole('button')).not.toBeInTheDocument()
  })

  it('ticker: nothing without an announcement', async () => {
    serve(store({ top_bar: 'ticker' }))
    renderRoutes(storefrontRoutes)
    await screen.findByTestId('site-header')
    expect(screen.queryByTestId('announcement-ticker')).not.toBeInTheDocument()
  })

  it('utility: contact details, the announcement, wishlist and account links', async () => {
    viewport({ desktop: true })
    serve(store({ top_bar: 'utility' }, { announcement }))
    renderRoutes(storefrontRoutes)

    const bar = await screen.findByTestId('utility-bar')
    expect(within(bar).getByRole('link', { name: '+880 1711-000000' })).toHaveAttribute('href', 'tel:+8801711000000')
    expect(within(bar).getByRole('link', { name: 'hello@berry.test' })).toHaveAttribute('href', 'mailto:hello@berry.test')
    expect(within(bar).getByRole('link', { name: 'Fresh vegetables every morning' })).toHaveAttribute('href', '/fresh')
    const links = within(bar).getByRole('navigation', { name: 'Store links' })
    expect(within(links).getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist')
    expect(within(links).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login')
  })
})

describe('footer variants', () => {
  it('columns: three blocks share the row instead of leaving an empty fourth column', async () => {
    // Brand + the "Help" menu + contact = three blocks.
    serve(store({}))
    const { unmount } = renderRoutes(storefrontRoutes)
    const grid = (await screen.findByTestId('site-footer')).firstElementChild!
    expect(grid).toHaveClass('lg:grid-cols-3')
    expect(grid).not.toHaveClass('lg:grid-cols-4')
    unmount()

    // A second menu makes four: today's layout.
    const four = store({})
    four.menus.footer_2 = { ...four.menus.footer_1!, name: 'Shop' }
    serve(four)
    renderRoutes(storefrontRoutes)
    expect((await screen.findByTestId('site-footer')).firstElementChild).toHaveClass('lg:grid-cols-4')
  })

  const rated = (slug: string) => productCard(slug, { rating: { average: '4.5', count: 12 } })

  it('showcase: brand column, popular and new product lists, the store links', async () => {
    serve(store({ footer_style: 'showcase' }), { products: { popularity: [rated('honey-jar'), rated('clay-pot'), rated('wool-scarf'), rated('extra-item')], latest: [productCard('new-vase')] } })
    renderRoutes(storefrontRoutes)

    const footer = await screen.findByTestId('site-footer')
    expect(footer).toHaveAttribute('data-footer-style', 'showcase')
    expect(within(footer).getByText('Handmade in Dhaka')).toBeInTheDocument()
    const popular = await within(footer).findByRole('region', { name: 'Popular' })
    expect(within(popular).getAllByTestId('footer-product')).toHaveLength(3)
    expect(within(popular).getByRole('link', { name: 'Honey Jar' })).toHaveAttribute('href', '/product/honey-jar')
    expect(within(popular).getAllByRole('img', { name: 'Rated 4.5 out of 5' })).toHaveLength(3)
    expect(within(popular).getAllByTestId('price')[0]).toHaveTextContent('৳120.00')
    expect(await within(footer).findByRole('region', { name: 'New arrivals' })).toBeInTheDocument()
    expect(within(footer).getByRole('navigation', { name: 'Help' })).toBeInTheDocument()
  })

  it('widgets: about, latest posts, best selling, top rated and the newsletter; empty widgets hide', async () => {
    const fetchMock = serve(store({ footer_style: 'widgets' }), { products: { popularity: [productCard('best-tee')], rating: [] }, posts: [post('a'), post('b')] })
    renderRoutes(storefrontRoutes)

    const footer = await screen.findByTestId('site-footer')
    expect(footer).toHaveAttribute('data-footer-style', 'widgets')
    expect(within(footer).getByRole('region', { name: 'About us' })).toHaveTextContent('Handmade in Dhaka')
    const posts = await within(footer).findByRole('region', { name: 'Latest posts' })
    expect(within(posts).getByRole('link', { name: 'Post a' })).toHaveAttribute('href', '/blog/a')
    expect(await within(footer).findByRole('region', { name: 'Best selling' })).toHaveTextContent('Best Tee')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('sort=rating'))).toBe(true))
    expect(within(footer).queryByRole('region', { name: 'Top rated' })).not.toBeInTheDocument()
    expect(within(footer).getByRole('form', { name: 'Newsletter' })).toBeInTheDocument()
    expect(within(footer).getByRole('navigation', { name: 'Help' })).toHaveTextContent('Shipping')
  })

  it('widgets: stars on the dark footer take the dark-surface colours, even with a primary as dark as the footer', async () => {
    const dark = bootstrapFixture().theme.colors
    serve(store({ footer_style: 'widgets' }, { colors: { ...dark, primary: '#111111', heading: '#111111', surface: '#ffffff' } }), { products: { popularity: [rated('best-tee')] } })
    renderRoutes(storefrontRoutes)

    const footer = await screen.findByTestId('site-footer')
    expect(footer).toHaveClass('sf-on-dark')
    const stars = await within(footer).findByRole('img', { name: 'Rated 4.5 out of 5' })
    const [empty, filled] = Array.from(stars.children) as HTMLElement[]
    expect(empty).toHaveClass('text-(--sf-star-empty)')
    expect(filled).toHaveClass('text-(--sf-star)')
    // `.sf-on-dark` swaps --sf-star for this: the primary (#111) would vanish, so the surface colour is used.
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--sf-star-on-dark')).toBe('#ffffff'))
  })

  it('subscribes from the newsletter widget', async () => {
    let body: unknown
    serve(store({ footer_style: 'widgets' }))
    const fetchMock = vi.mocked(fetch)
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init = {}) => {
      if (String(input).includes('/store/newsletter') && init.method === 'POST') {
        body = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ success: true, data: { message: 'Please confirm your e-mail.' }, meta: { request_id: 't' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return original(input, init)
    })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Newsletter' })
    await user.type(within(form).getByLabelText('E-mail address'), 'rina@example.com')
    await user.click(within(form).getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByText('Please confirm your e-mail.')).toBeInTheDocument()
    expect(body).toEqual({ email: 'rina@example.com' })
  })
})

describe('product card variants', () => {
  const onSale = productCard('linen-bag', { on_sale: true, discount_percent: 20, compare_at_price: '150.00', is_new: true, hover_image: { url: '/storage/products/linen-bag-2.png', alt: null }, rating: { average: '4.0', count: 7 } })
  const variable = productCard('clay-mug', { price: '80.00', price_max: '140.00', variant_count: 3, default_variant_id: null })

  it('minimal: image-led, the name links the whole card, "From" prices, a discount label and no buttons', async () => {
    serve(store({ card_style: 'minimal' }), { sections: [grid([onSale, variable])] })
    renderRoutes(storefrontRoutes)

    const cards = await screen.findAllByTestId('product-card')
    expect(cards[0]).toHaveAttribute('data-card-style', 'minimal')
    expect(within(cards[0]!).getByRole('link', { name: 'Linen Bag' })).toHaveAttribute('href', '/product/linen-bag')
    expect(within(cards[0]!).getByTestId('discount-badge')).toHaveTextContent('−20 %')
    expect(within(cards[0]!).queryByRole('button')).not.toBeInTheDocument()
    expect(within(cards[1]!).getByTestId('price')).toHaveTextContent('From ৳80.00')
    expect(within(cards[1]!).getAllByRole('link')).toHaveLength(1)
  })

  it('commerce: category, stars, struck price, badges, hover actions on focus and add to cart', async () => {
    serve(store({ card_style: 'commerce' }), { sections: [grid([onSale, productCard('sold-out', { in_stock: false })])] })
    renderRoutes(storefrontRoutes)

    const [card, soldOut] = await screen.findAllByTestId('product-card')
    expect(card).toHaveAttribute('data-card-style', 'commerce')
    expect(within(card!).getByText('Juices')).toBeInTheDocument()
    expect(within(card!).getByRole('img', { name: 'Rated 4.0 out of 5' })).toBeInTheDocument()
    expect(within(card!).getByTestId('compare-price')).toHaveTextContent('৳150.00')
    const badges = within(card!).getByRole('list', { name: 'Product labels' })
    expect(within(badges).getByText('−20 %')).toBeInTheDocument()
    expect(within(badges).getByText('New')).toBeInTheDocument()
    // Wishlist and quick view are keyboard reachable (shown on focus-within) and the second image is there for hover.
    const actions = within(card!).getByTestId('card-hover-actions')
    expect(actions.className).toContain('group-focus-within:opacity-100')
    expect(within(actions).getByRole('button', { name: 'Quick view: Linen Bag' })).toBeInTheDocument()
    expect(card!.querySelector('img[src="/storage/products/linen-bag-2.png"]')).not.toBeNull()
    expect(within(card!).getByRole('button', { name: 'Add Linen Bag to the cart' })).toBeEnabled()
    expect(within(soldOut!).getByRole('list', { name: 'Product labels' })).toHaveTextContent('Out of stock')
  })

  it('the list view keeps the standard card', async () => {
    serve(store({ card_style: 'minimal' }), { products: { featured: [onSale] } })
    renderRoutes(storefrontRoutes, '/search?q=bag&view=list')

    const card = await screen.findByTestId('product-card')
    expect(card).not.toHaveAttribute('data-card-style')
  })
})

describe('arched product card (K1)', () => {
  const romper = productCard('cotton-romper', { on_sale: true, discount_percent: 20, compare_at_price: '150.00', is_new: true, category: { name: 'Baby girls', slug: 'baby-girls' } })
  const bunny = productCard('plush-bunny')
  const dress = productCard('party-dress', { price: '80.00', price_max: '140.00', variant_count: 3, default_variant_id: null })
  const boots = productCard('rain-boots', { in_stock: false })
  const kids = (routes?: Parameters<typeof mockApi>[0]) => serve(store({ card_style: 'arched', header_style: 'commerce' }, { preset: 'kids' }), { sections: [grid([romper, bunny, dress, boots])], routes })

  it('a white image, a corner ribbon on sale and an arched caption block with name, category and struck price', async () => {
    kids()
    renderRoutes(storefrontRoutes)

    const [card, plain] = await screen.findAllByTestId('product-card')
    expect(card).toHaveAttribute('data-card-style', 'arched')
    const labels = within(card!).getByRole('list', { name: 'Product labels' })
    expect(within(labels).getByTestId('sale-ribbon')).toHaveTextContent('−20 %')
    expect(within(labels).getByText('New')).toBeInTheDocument()
    expect(within(plain!).queryByTestId('sale-ribbon')).not.toBeInTheDocument()
    expect(within(plain!).queryByRole('list', { name: 'Product labels' })).not.toBeInTheDocument()

    const caption = within(card!).getByTestId('arched-caption')
    expect(within(caption).getByTestId('card-arch')).toHaveAttribute('aria-hidden', 'true')
    const name = within(caption).getByRole('heading', { name: 'Cotton Romper' })
    expect(name).toHaveClass('font-heading', 'text-inherit')
    expect(within(name).getByRole('link')).toHaveAttribute('href', '/product/cotton-romper')
    expect(within(caption).getByText('Baby girls')).toBeInTheDocument()
    expect(within(caption).getByTestId('compare-price')).toHaveTextContent('৳150.00')
    expect(within(caption).getByTestId('price')).toHaveTextContent('৳120.00')
  })

  it('text on the block uses the primary pair at rest and the accent pair on hover or focus (AA by the theme check)', async () => {
    kids()
    renderRoutes(storefrontRoutes)

    const caption = within((await screen.findAllByTestId('product-card'))[0]!).getByTestId('arched-caption')
    expect(caption).toHaveClass(
      'bg-sf-primary',
      'text-sf-primary-foreground',
      'group-hover:bg-sf-accent',
      'group-hover:text-sf-accent-foreground',
      'group-focus-within:bg-sf-accent',
      'group-focus-within:text-sf-accent-foreground',
    )
    expect(within(caption).getByTestId('card-arch')).toHaveClass('text-sf-primary', 'group-hover:text-sf-accent', 'group-focus-within:text-sf-accent')
    // The price line drops its own colours and takes the block's foreground.
    const price = within(caption).getByTestId('price').parentElement!
    expect(price).toHaveClass('[&_[data-testid=price]]:text-current', '[&_[data-testid=compare-price]]:text-current')
  })

  it('round cart on the arch, wishlist and quick view at the image’s right: shown on hover or keyboard focus, a row on touch', async () => {
    kids()
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const [card, , dress, boots] = await screen.findAllByTestId('product-card')
    const actions = within(card!).getByTestId('card-actions')
    // Touch screens: a visible row; hover screens: the row dissolves and the buttons float.
    expect(actions).toHaveClass('flex', '[@media(hover:hover)]:contents')
    const cart = within(actions).getByRole('button', { name: 'Add Cotton Romper to the cart' })
    expect(cart.parentElement).toHaveClass('[@media(hover:hover)]:absolute', '[@media(hover:hover)]:-top-6', 'group-hover:opacity-100', '[@media(hover:hover)]:group-focus-within:opacity-100')
    const side = within(card!).getByTestId('card-hover-actions')
    expect(side).toHaveClass('[@media(hover:hover)]:right-3', 'group-hover:opacity-100', '[@media(hover:hover)]:group-focus-within:opacity-100')
    const wishlist = within(side).getByRole('button', { name: 'Add Cotton Romper to the wishlist' })
    const quickView = within(side).getByRole('button', { name: 'Quick view: Cotton Romper' })

    // Keyboard: the name, then the cart, wishlist and quick view.
    await waitFor(() => expect(wishlist).toBeEnabled())
    within(card!).getByRole('link', { name: 'Cotton Romper' }).focus()
    await user.tab()
    expect(cart).toHaveFocus()
    await user.tab()
    expect(wishlist).toHaveFocus()
    await user.tab()
    expect(quickView).toHaveFocus()

    // Several variants: a round link to choose options; sold out: a disabled button and the label.
    expect(within(dress!).getByRole('link', { name: 'Choose options: Party Dress' })).toHaveAttribute('href', '/product/party-dress')
    expect(within(boots!).getByRole('button', { name: 'Rain Boots is out of stock' })).toBeDisabled()
    expect(within(boots!).getByRole('list', { name: 'Product labels' })).toHaveTextContent('Out of stock')
  })

  it('the round cart button adds one unit', async () => {
    const posts: unknown[] = []
    kids({
      'POST /store/cart/items': (init) => {
        posts.push(JSON.parse(String(init.body)))
        return ok(cartFixture([cartLine('l-1')]))
      },
    })
    renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    const [card] = await screen.findAllByTestId('product-card')
    await user.click(within(card!).getByRole('button', { name: 'Add Cotton Romper to the cart' }))
    await waitFor(() => expect(posts).toEqual([{ variant_id: 'v-cotton-romper', quantity: '1' }]))
  })

  it('kids: the commerce header keeps its menu bar (coloured by the kids rule in storefront.css)', async () => {
    viewport({ desktop: true })
    kids()
    renderRoutes(storefrontRoutes)

    await screen.findByTestId('site-header')
    expect(document.documentElement).toHaveAttribute('data-sf-preset', 'kids')
    expect(document.documentElement).toHaveAttribute('data-sf-card', 'arched')
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-appearance', 'commerce')
  })
})

describe('hero variants', () => {
  it('tiles: up to three editorial tiles with heading links', async () => {
    serve(store({ hero_style: 'tiles' }), {
      sections: [hero([banner('b-1', { kicker: 'Ceramics', link_url: '/c/ceramics' }), banner('b-2', { link_url: '/c/candles', button_label: 'Discover' }), banner('b-3'), banner('b-4')])],
    })
    renderRoutes(storefrontRoutes)

    const tiles = await screen.findAllByTestId('hero-tile')
    expect(tiles).toHaveLength(3)
    expect(within(tiles[0]!).getByRole('heading', { name: 'Banner b-1' })).toBeInTheDocument()
    expect(within(tiles[0]!).getByRole('link', { name: 'Banner b-1' })).toHaveAttribute('href', '/c/ceramics')
    expect(within(tiles[0]!).getByText('Ceramics')).toBeInTheDocument()
    expect(within(tiles[2]!).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument()
  })

  it('sale: left-aligned uppercase headline with every button of the slide; controls as before', async () => {
    serve(store({ hero_style: 'sale' }), {
      sections: [hero([banner('b-1', { title: 'Mega sale', kicker: 'Up to 50% off', button_label: 'Shop men', link_url: '/men', secondary_button_label: 'Shop women', secondary_link_url: '/women' }), banner('b-2')])],
    })
    renderRoutes(storefrontRoutes)

    const text = (await screen.findAllByTestId('sale-banner-text'))[0]!
    expect(within(text).getByRole('heading', { name: 'Mega sale' })).toHaveClass('uppercase')
    expect(within(text).getByRole('link', { name: 'Shop men' })).toHaveAttribute('href', '/men')
    expect(within(text).getByRole('link', { name: 'Shop women' })).toHaveAttribute('href', '/women')
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeInTheDocument()
  })

  it('inverts a button whose theme fill would vanish on the dark backdrop; slides fall back to a matching colour', async () => {
    const colors = { ...bootstrapFixture().theme.colors, primary: '#111111', primary_foreground: '#ffffff' }
    serve(store({ hero_style: 'sale' }, { colors }), {
      sections: [
        hero([
          banner('b-1', { title: 'Mega sale', button_label: 'Shop men', link_url: '/men', secondary_button_label: 'Shop women', secondary_link_url: '/women' }),
          banner('b-2', { title: 'Light slide', text_color: '#1b3a1f', button_label: 'Shop', link_url: '/shop' }),
        ]),
      ],
    })
    renderRoutes(storefrontRoutes)

    const [dark, light] = await screen.findAllByTestId('sale-banner-text')
    // #111 on the dark scrim (or the dark fallback): white fill, the primary as the label.
    const shopMen = within(dark!).getByRole('link', { name: 'Shop men' })
    expect(shopMen.style.backgroundColor).toBe('rgb(255, 255, 255)')
    expect(shopMen.style.color).toBe('rgb(17, 17, 17)')
    // The accent (#6f55c2) stands out on dark: theme classes only.
    expect(within(dark!).getByRole('link', { name: 'Shop women' }).getAttribute('style')).toBeNull()
    // #111 on a light backdrop is fine as it is.
    expect(within(light!).getByRole('link', { name: 'Shop', hidden: true }).getAttribute('style')).toBeNull()

    const slides = screen.getAllByRole('group', { hidden: true }).filter((el) => el.getAttribute('aria-roledescription') === 'slide')
    expect(slides[0]).toHaveClass('bg-sf-heading')
    expect(slides[1]).toHaveClass('bg-sf-canvas')
  })

  it('keeps the theme button colours when they stand out (today’s look)', async () => {
    serve(store({}), { sections: [hero([banner('b-1', { title: 'Fresh', button_label: 'Shop now', link_url: '/shop' })])] })
    renderRoutes(storefrontRoutes)

    const link = await screen.findByRole('link', { name: 'Shop now' })
    expect(link).toHaveClass('bg-sf-button', 'sf-button')
    expect(link.getAttribute('style')).toBeNull()
  })
})

describe('mobile brand', () => {
  it('a store without a logo keeps its preset’s name style on phones', async () => {
    viewport({ desktop: false })
    serve(store({ header_style: 'commerce' }))
    renderRoutes(storefrontRoutes)

    const header = await screen.findByTestId('site-header')
    const name = within(header).getByText(bootstrapFixture().store.name)
    expect(name).toHaveClass('uppercase', 'text-sf-heading')
  })

  it('the standard header keeps today’s accent-coloured name', async () => {
    viewport({ desktop: false })
    serve(store({}))
    renderRoutes(storefrontRoutes)

    const header = await screen.findByTestId('site-header')
    expect(within(header).getByText(bootstrapFixture().store.name)).toHaveClass('text-sf-accent', 'font-extrabold')
  })
})
