import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage } from './builder/types'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, cartLine, customerFixture, productCard, productDetail, resetLocale } from './test-fixtures'
import type { ProductDetail, ProductLayout, ProductVariant, StorefrontBootstrap } from './types'

afterEach(() => {
  resetLocale()
  localStorage.clear()
  document.documentElement.style.removeProperty('--sf-quick-buy-space')
})

const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

const zone = (key: string, text: string): BuilderPage => payloadOf(documentOf([elementNode('heading', `e_${key.replace('.', '_')}`, { text, level: 2 })]), { key: `zone:${key}`, title: key })

const delivery = {
  options: [
    { zone: 'Inside Dhaka', method: 'Home delivery', min_days: 1, max_days: 2, fee: '60.00', free_over: '2000.00' },
    { zone: 'Outside Dhaka', method: null, min_days: 3, max_days: 5, fee: '120.00', free_over: null },
    { zone: 'Sub-Dhaka', method: null, min_days: 2, max_days: 3, fee: null, free_over: null },
    { zone: 'Hill tracts', method: null, min_days: 5, max_days: 7, fee: '150.00', free_over: null },
  ],
  cod_available: true,
}

/** The kids tee with the P1b additions (no video, no zones, no questions yet). */
function p1bProduct(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return productDetail({
    badges: [{ text: 'Best seller', tone: 'dark' }],
    video: null,
    delivery,
    zones: { 'product.below_price': null, 'product.after': null, 'product.bottom': null },
    questions_count: 0,
    ...overrides,
  })
}

function withLayout(layout: Partial<ProductLayout>): StorefrontBootstrap {
  const base = bootstrapFixture()
  return { ...base, theme: { ...base.theme, layout: { ...base.theme.layout, product: { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs', ...layout } } } }
}

const related = (extra: Record<string, unknown> = {}) => ({ related: [productCard('kids-shorts')], frequently_bought: [], frequently_bought_source: null, ...extra })

const noQuestions = ok([], { pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } })

function serve(options: { product?: ProductDetail; bootstrap?: StorefrontBootstrap; related?: unknown; routes?: Parameters<typeof mockApi>[0] } = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(options.bootstrap ?? bootstrapFixture()),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/products/kids-tee': ok(options.product ?? p1bProduct()),
    'GET /store/products/kids-tee/related': ok(options.related ?? related()),
    'GET /store/products/kids-tee/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
    'GET /store/products/kids-tee/questions': noQuestions,
    ...options.routes,
  })
}

describe('buy now (P1b)', () => {
  it('adds the chosen variant and quantity, then goes straight to the checkout', async () => {
    const posts: unknown[] = []
    serve({
      routes: {
        'POST /store/cart/items': (init) => {
          posts.push(bodyOf(init))
          return ok(cartFixture([cartLine('l-1')]))
        },
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Add to cart' })
    await user.click(within(form).getByRole('button', { name: 'Increase: Quantity of Kids Tee' }))
    await user.click(within(form).getByRole('button', { name: 'Buy now' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/checkout'))
    expect(posts).toEqual([{ variant_id: 'v-red-m', quantity: '2' }])
    expect(screen.queryByRole('dialog', { name: /Your cart/ })).not.toBeInTheDocument()
  })

  it('is gone for a sold-out variant, where "Notify me" takes its place', async () => {
    serve()
    renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-red-l')

    expect(await screen.findByTestId('notify-me')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Buy now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Add to cart' })).not.toBeInTheDocument()
  })
})

describe('delivery note (P1b)', () => {
  it('shows each zone’s days and fee and cash on delivery under the price', async () => {
    serve()
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const note = await screen.findByTestId('delivery-note')
    expect(within(note).getAllByTestId('delivery-option').map((li) => li.textContent)).toEqual([
      'Inside Dhaka: 1–2 days · ৳60 · free over ৳2,000',
      'Outside Dhaka: 3–5 days · ৳120',
      'Sub-Dhaka: 2–3 days · charge depends on the method',
      'Hill tracts: 5–7 days · ৳150',
    ])
    // Three zones show; the rest fold away.
    expect(within(note).getByText('1 more delivery area').closest('details')).not.toHaveAttribute('open')
    expect(within(note).getByTestId('cod-note')).toHaveTextContent('Cash on delivery available')
    expect(note.compareDocumentPosition(screen.getByTestId('variant-selector')) & FOLLOWING).toBeTruthy()
    expect(screen.getAllByTestId('price')[0]!.compareDocumentPosition(note) & FOLLOWING).toBeTruthy()
  })

  it('is worded in Bangla with Bengali digits when the store uses them', async () => {
    serve({ bootstrap: bilingualBootstrap({ bangla_digits: true }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee?lang=bn')

    const note = await screen.findByTestId('delivery-note')
    await waitFor(() => expect(within(note).getAllByTestId('delivery-option')[0]).toHaveTextContent('Inside Dhaka: ১–২ দিন · ৳৬০ · ৳২,০০০-এর বেশি কেনাকাটায় ফ্রি'))
    expect(within(note).getByTestId('cod-note')).toHaveTextContent('ক্যাশ অন ডেলিভারি সুবিধা আছে')
    expect(screen.getByRole('button', { name: 'এখনই কিনুন' })).toBeInTheDocument()
  })

  it('stays away when shipping is not set up', async () => {
    serve({ product: p1bProduct({ delivery: null }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    expect(await screen.findByTestId('buy-area')).toBeInTheDocument()
    expect(screen.queryByTestId('delivery-note')).not.toBeInTheDocument()
  })
})

describe('gallery and badges (P1b)', () => {
  it('shows the owner’s badges after the automatic ones, on the photo and on cards', async () => {
    serve({ related: related({ related: [productCard('kids-shorts', { badges: [{ text: 'Eid offer', tone: 'sale' }] })] }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const labels = within(await screen.findByTestId('product-gallery')).getByRole('list', { name: 'Product labels' })
    expect(within(labels).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sale', 'New', 'Best seller'])
    expect(within(labels).getByText('Best seller')).toHaveAttribute('data-tone', 'dark')

    const card = within(await screen.findByRole('region', { name: 'Related products' })).getByTestId('product-card')
    expect(within(card).getByText('Eid offer')).toHaveStyle({ backgroundColor: '#c2410c', color: '#ffffff' })
  })

  it('plays the product video, the last slide, only once the shopper asks', async () => {
    serve({ product: p1bProduct({ video: { provider: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const thumbnails = within(await screen.findByRole('list', { name: 'Product images' })).getAllByRole('button')
    expect(thumbnails.map((b) => b.getAttribute('aria-label'))).toEqual(['Show image 1 of 2', 'Show image 2 of 2', 'Show the product video'])
    await user.click(thumbnails[2]!)
    expect(thumbnails[2]).toHaveAttribute('aria-current', 'true')
    // Nothing is loaded from YouTube before play.
    expect(document.querySelector('iframe')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Play the video of Kids Tee' }))
    const frame = screen.getByTitle('Video of Kids Tee')
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1')
    expect(frame).toHaveFocus()

    // A colour with its own photo brings the photo back.
    await user.click(within(screen.getByTestId('variant-selector')).getByRole('radio', { name: 'Colour: Blue' }))
    expect(screen.queryByTitle('Video of Kids Tee')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute('aria-current', 'true')
  })

  it('offers zoom in the lightbox and the video as its last slide', async () => {
    serve({ product: p1bProduct({ video: { provider: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871' } }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Open Kids Tee, image 1 of 2 full screen' }))
    const lightbox = await screen.findByRole('dialog', { name: 'Kids Tee, image 1 of 2' })
    expect(within(lightbox).getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(within(lightbox).getByRole('button', { name: 'Zoom in' })).toBeEnabled()
    expect(within(lightbox).getByText('1 / 3')).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    const video = await screen.findByRole('dialog', { name: 'Kids Tee, video' })
    expect(within(video).queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument()
    await user.click(within(video).getByRole('button', { name: 'Play the video of Kids Tee' }))
    expect(within(video).getByTitle('Video of Kids Tee')).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1')
    await user.click(within(video).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('designable product page (P1b)', () => {
  it('follows the theme: gallery right, thumbnails beside it, sticky summary, details as an accordion', async () => {
    serve({
      bootstrap: withLayout({ gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' }),
      product: p1bProduct({ questions_count: 1 }),
      routes: {
        'GET /store/products/kids-tee/questions': ok([{ id: 'q1', name: 'Rina A.', question: 'Is it soft?', answer: 'Very.', asked_at: '2026-11-01T10:00:00Z', answered_at: '2026-11-02T10:00:00Z' }], {
          pagination: { current_page: 1, per_page: 10, total: 1, last_page: 1 },
        }),
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const page = await screen.findByTestId('product-page')
    expect(page).toHaveAttribute('data-gallery', 'right')
    const gallery = screen.getByTestId('product-gallery')
    expect(gallery.parentElement).toHaveClass('md:order-last')
    expect(gallery).toHaveAttribute('data-thumbnails', 'side')
    expect(screen.getByTestId('product-summary')).toHaveClass('md:sticky')

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Description' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Made from', { exact: false })).toBeInTheDocument()
    const questions = screen.getByRole('button', { name: 'Questions (1)' })
    expect(questions).toHaveAttribute('aria-expanded', 'false')
    await user.click(questions)
    expect(questions).toHaveAttribute('aria-expanded', 'true')
    expect(within(await screen.findByRole('list', { name: 'Questions and answers' })).getByText('Very.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Specifications' })).toBeInTheDocument()
  })

  it('opens the reviews in the accordion from the rating link, every time', async () => {
    serve({ bootstrap: withLayout({ details: 'accordion' }), product: p1bProduct({ rating: { average: '4.5', count: 2 } }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const reviews = await screen.findByRole('button', { name: 'Reviews (2)' })
    expect(reviews).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByTestId('rating-summary'))
    expect(reviews).toHaveAttribute('aria-expanded', 'true')
    await user.click(reviews)
    expect(reviews).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByTestId('rating-summary'))
    expect(reviews).toHaveAttribute('aria-expanded', 'true')
  })

  it('stacks the details under their own headings', async () => {
    serve({ bootstrap: withLayout({ details: 'stacked' }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    expect(await screen.findByRole('heading', { level: 2, name: 'Description' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    for (const name of ['Specifications', 'Reviews', 'Questions']) expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    expect(await screen.findByText('No questions yet. Be the first to ask.')).toBeInTheDocument()
  })

  it('draws the zones the server resolved for this product, in their places; a draft preview asks for drafts', async () => {
    const fetchMock = serve({
      bootstrap: bootstrapFixture({ builder: { home: false, zones: { 'product.after': zone('product.after', 'Store-wide note') } } }),
      product: p1bProduct({ zones: { 'product.below_price': zone('product.below_price', 'Free gift wrap'), 'product.after': zone('product.after', 'For all tees'), 'product.bottom': zone('product.bottom', 'Our promise') } }),
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee?preview=draft')

    const below = await screen.findByTestId('builder-zone-product.below_price')
    expect(within(below).getByRole('heading', { name: 'Free gift wrap' })).toBeInTheDocument()
    expect(below).toHaveClass('b-zone-inline')
    expect(below.closest('[data-testid="product-summary"]')).not.toBeNull()
    expect(screen.getByTestId('delivery-note').compareDocumentPosition(below) & FOLLOWING).toBeTruthy()
    expect(below.compareDocumentPosition(screen.getByTestId('buy-area')) & FOLLOWING).toBeTruthy()

    const after = screen.getByTestId('builder-zone-product.after')
    expect(within(after).getByRole('heading', { name: 'For all tees' })).toBeInTheDocument()
    expect(screen.queryByText('Store-wide note')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Product information' }).compareDocumentPosition(after) & FOLLOWING).toBeTruthy()

    const relatedRow = await screen.findByRole('region', { name: 'Related products' })
    const bottom = screen.getByTestId('builder-zone-product.bottom')
    expect(after.compareDocumentPosition(relatedRow) & FOLLOWING).toBeTruthy()
    expect(relatedRow.compareDocumentPosition(bottom) & FOLLOWING).toBeTruthy()

    const productCall = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost')).find((url) => url.pathname === '/api/v1/store/products/kids-tee')
    expect(productCall?.searchParams.get('preview')).toBe('draft')
  })
})

const variantOf = (id: string, extra: Partial<ProductVariant>): ProductVariant => ({ ...productDetail().variants[0]!, id, compare_at_price: null, on_sale: false, discount_percent: null, image_id: null, ...extra })

describe('frequently bought together (P1b)', () => {
  it('adds the ticked items one after another, with the exact total of their prices today', async () => {
    const posts: unknown[] = []
    serve({
      related: related({
        frequently_bought: [
          productCard('kids-socks', { price: '80.50', price_max: '80.50' }),
          productCard('kids-cap', { price: '150.00', price_max: '150.00', promotion: { id: 'pr-1', name: 'Caps week', type: 'percent', value: '10', ends_at: null, show_countdown: false, price: '135.00' } }),
        ],
        frequently_bought_source: 'automatic',
      }),
      routes: {
        'POST /store/cart/items': (init) => {
          posts.push(bodyOf(init))
          return ok(cartFixture([cartLine('l-1')]))
        },
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const fbt = await screen.findByRole('region', { name: 'Frequently bought together' })
    expect(within(fbt).getByText('Based on what shoppers bought together')).toBeInTheDocument()
    expect(within(fbt).getAllByTestId('fbt-item')).toHaveLength(3)
    // 450.00 (this tee) + 80.50 + 135.00 (the cap's promotional price).
    expect(within(fbt).getByTestId('fbt-total')).toHaveTextContent('৳665.50')
    await user.click(within(fbt).getByRole('checkbox', { name: 'Include Kids Socks' }))
    expect(within(fbt).getByTestId('fbt-total')).toHaveTextContent('৳585.00')

    await user.click(within(fbt).getByRole('button', { name: 'Add selected to cart' }))
    await waitFor(() => expect(within(fbt).getByTestId('fbt-status')).toHaveTextContent('2 items added to your cart.'))
    expect(posts).toEqual([
      { variant_id: 'v-red-m', quantity: '1' },
      { variant_id: 'v-kids-cap', quantity: '1' },
    ])
    expect(await screen.findByRole('dialog', { name: /Your cart/ })).toBeInTheDocument()
  })

  it('names what could not be added and keeps the mini-cart closed', async () => {
    serve({
      related: related({ frequently_bought: [productCard('kids-socks')], frequently_bought_source: 'manual' }),
      routes: {
        'POST /store/cart/items': (init) => (bodyOf(init).variant_id === 'v-kids-socks' ? fail(422, 'OUT_OF_STOCK', 'Out of stock') : ok(cartFixture([cartLine('l-1')]))),
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const fbt = await screen.findByRole('region', { name: 'Frequently bought together' })
    expect(within(fbt).queryByText('Based on what shoppers bought together')).not.toBeInTheDocument()
    await user.click(within(fbt).getByRole('button', { name: 'Add selected to cart' }))
    const status = within(fbt).getByTestId('fbt-status')
    await waitFor(() => expect(status).toHaveTextContent('Added 1 of 2 items to your cart. These could not be added:'))
    expect(within(status).getByRole('listitem')).toHaveTextContent(/^Kids Socks — /)
    expect(screen.queryByRole('dialog', { name: /Your cart/ })).not.toBeInTheDocument()

    // Nothing ticked: the shopper is asked to tick something.
    await user.click(within(fbt).getByRole('checkbox', { name: 'Include Kids Tee' }))
    await user.click(within(fbt).getByRole('checkbox', { name: 'Include Kids Socks' }))
    await user.click(within(fbt).getByRole('button', { name: 'Add selected to cart' }))
    expect(status).toHaveTextContent('Tick at least one item.')
  })

  it('lets the shopper choose the option of a product with several variants', async () => {
    const posts: unknown[] = []
    const hat = productDetail({
      id: 'p-kids-hat',
      slug: 'kids-hat',
      name: 'Kids Hat',
      url: '/product/kids-hat',
      options: [{ name: 'Size', slug: 'size', display: 'button', values: [{ value: 'S', swatch_hex: null }, { value: 'L', swatch_hex: null }] }],
      variants: [variantOf('v-hat-s', { name: 'S', option_values: { Size: 'S' }, price: '200.00', in_stock: false }), variantOf('v-hat-l', { name: 'L', option_values: { Size: 'L' }, price: '220.00' })],
      default_variant_id: 'v-hat-s',
    })
    serve({
      related: related({ frequently_bought: [productCard('kids-hat', { variant_count: 2, default_variant_id: null, price: '200.00', price_max: '220.00' })], frequently_bought_source: 'manual' }),
      routes: {
        'GET /store/products/kids-hat': ok(hat),
        'POST /store/cart/items': (init) => {
          posts.push(bodyOf(init))
          return ok(cartFixture([cartLine('l-1')]))
        },
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const fbt = await screen.findByRole('region', { name: 'Frequently bought together' })
    // The sold-out small hat cannot be picked; the large one is.
    const option = await within(fbt).findByRole('combobox', { name: 'Option for Kids Hat' })
    expect(option).toHaveValue('v-hat-l')
    expect(within(option).getByRole('option', { name: 'S — Out of stock' })).toBeDisabled()
    expect(within(fbt).getByTestId('fbt-total')).toHaveTextContent('৳670.00')
    await user.click(within(fbt).getByRole('button', { name: 'Add selected to cart' }))
    await waitFor(() => expect(posts).toEqual([{ variant_id: 'v-red-m', quantity: '1' }, { variant_id: 'v-hat-l', quantity: '1' }]))
  })
})

describe('questions & answers (P1b)', () => {
  const question = { id: 'q1', name: 'Rina A.', question: 'Is it pure cotton?', answer: 'Yes, 100% organic cotton.', asked_at: '2026-11-01T10:00:00Z', answered_at: '2026-11-02T10:00:00Z' }

  it('lists the answered questions and lets a guest ask one', async () => {
    const asked: unknown[] = []
    serve({
      product: p1bProduct({ questions_count: 1 }),
      routes: {
        'GET /store/products/kids-tee/questions': ok([question], { pagination: { current_page: 1, per_page: 10, total: 1, last_page: 1 } }),
        'POST /store/products/kids-tee/questions': (init) => {
          asked.push(bodyOf(init))
          return { status: 202, body: { success: true, data: { message: 'Thanks — your question will appear once we answer it.' }, meta: { request_id: 'test' } } }
        },
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: 'Questions (1)' }))
    const list = await screen.findByRole('list', { name: 'Questions and answers' })
    expect(within(list).getByText('Is it pure cotton?')).toBeInTheDocument()
    expect(within(list).getByText('Yes, 100% organic cotton.')).toBeInTheDocument()
    expect(within(list).getByText(/^Asked by Rina A\. on /)).toBeInTheDocument()
    expect(within(list).getByText(/^Answered by Berry Kids on /)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ask a question' }))
    const form = screen.getByRole('form', { name: 'Ask a question about Kids Tee' })
    const name = within(form).getByRole('textbox', { name: 'Your name' })
    expect(name).toHaveFocus()
    await user.type(name, 'Karim')
    await user.type(within(form).getByRole('textbox', { name: 'E-mail' }), 'karim@example.com')
    await user.type(within(form).getByRole('textbox', { name: 'Your question' }), 'Does it shrink after washing?')
    await user.click(within(form).getByRole('button', { name: 'Send question' }))

    expect(await screen.findByTestId('question-thanks')).toHaveTextContent('Thanks — your question will appear once we answer it.')
    expect(asked).toEqual([{ name: 'Karim', email: 'karim@example.com', question: 'Does it shrink after washing?', website: '' }])
    expect(screen.queryByRole('form', { name: 'Ask a question about Kids Tee' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask a question' })).toHaveFocus()
  })

  it('starts filled in for a signed-in shopper, checks the question and shows the server’s field errors', async () => {
    serve({
      routes: {
        'GET /store/account/me': ok(customerFixture()),
        'POST /store/products/kids-tee/questions': fail(422, 'VALIDATION_FAILED', 'Invalid', { question: ['Please leave out links.'] }),
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: 'Questions' }))
    expect(await screen.findByTestId('questions-empty')).toHaveTextContent('No questions yet. Be the first to ask.')
    await user.click(screen.getByRole('button', { name: 'Ask a question' }))
    const form = screen.getByRole('form', { name: 'Ask a question about Kids Tee' })
    expect(within(form).getByRole('textbox', { name: 'Your name' })).toHaveValue('Rina Akter')
    expect(within(form).getByRole('textbox', { name: 'E-mail' })).toHaveValue('rina@example.com')
    const text = within(form).getByRole('textbox', { name: 'Your question' })
    expect(text).toHaveFocus()

    await user.type(text, 'Hm?')
    await user.click(within(form).getByRole('button', { name: 'Send question' }))
    expect(within(form).getByText('Please write at least 5 characters.')).toBeInTheDocument()
    expect(text).toHaveAttribute('aria-invalid', 'true')
    expect(text).toHaveFocus()

    await user.type(text, ' See www.example.com')
    await user.click(within(form).getByRole('button', { name: 'Send question' }))
    expect(await within(form).findByText('Please leave out links.')).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Ask a question' })).toHaveFocus()
  })

  it('has no Questions part when the catalog reports none (stores from before P1b)', async () => {
    serve({ product: p1bProduct({ questions_count: undefined }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const tablist = await screen.findByRole('tablist', { name: 'Product information' })
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Description', 'Specifications', 'Reviews'])
  })
})

/* The quick-buy bar watches the buy area with an IntersectionObserver (absent in jsdom: stubbed). */
type Observer = { callback: IntersectionObserverCallback; targets: Element[] }

function stubObserver() {
  const observers: Observer[] = []
  class FakeIntersectionObserver {
    callback: IntersectionObserverCallback
    targets: Element[] = []
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
      observers.push(this)
    }
    observe(target: Element) {
      this.targets.push(target)
    }
    unobserve() {}
    disconnect() {
      this.targets = []
    }
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  /** The buy area scrolls up past the top (`past`) or back into view. */
  return (past: boolean) =>
    act(() => {
      for (const observer of observers) {
        const target = observer.targets.find((el) => el.getAttribute('data-testid') === 'buy-area')
        if (!target) continue
        const entry = { target, isIntersecting: !past, boundingClientRect: { bottom: past ? -40 : 320 }, rootBounds: { top: 0 } }
        observer.callback([entry as unknown as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
      }
    })
}

describe('quick-buy bar (P1b)', () => {
  it('appears once the buy area has scrolled away and shares its quantity', async () => {
    const scroll = stubObserver()
    const posts: unknown[] = []
    serve({
      routes: {
        'POST /store/cart/items': (init) => {
          posts.push(bodyOf(init))
          return ok(cartFixture([cartLine('l-1')]))
        },
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Add to cart' })
    expect(screen.queryByTestId('quick-buy')).not.toBeInTheDocument()

    scroll(true)
    const bar = screen.getByRole('region', { name: 'Quick buy' })
    expect(within(bar).getByText('Kids Tee')).toBeInTheDocument()
    expect(within(bar).getByText('Red / M')).toBeInTheDocument()
    expect(within(bar).getByTestId('quick-buy-price')).toHaveTextContent('৳450.00')
    expect(document.documentElement.style.getPropertyValue('--sf-quick-buy-space')).toMatch(/px$/)

    await user.click(within(bar).getByRole('button', { name: 'Increase: Quantity of Kids Tee' }))
    expect(within(form).getByRole('textbox', { name: 'Quantity of Kids Tee' })).toHaveValue('2')
    await user.click(within(bar).getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByRole('dialog', { name: /Your cart/ })).toBeInTheDocument()
    expect(posts).toEqual([{ variant_id: 'v-red-m', quantity: '2' }])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Your cart/ })).not.toBeInTheDocument())

    // Back in view: the bar hides from everyone and stops padding the page.
    scroll(false)
    expect(screen.queryByRole('region', { name: 'Quick buy' })).not.toBeInTheDocument()
    expect(screen.getByTestId('quick-buy')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('quick-buy')).toHaveAttribute('inert')
    expect(document.documentElement.style.getPropertyValue('--sf-quick-buy-space')).toBe('')
  })

  it('takes the shopper to the back-in-stock form for a sold-out variant', async () => {
    const scroll = stubObserver()
    serve()
    renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-red-l')
    const user = userEvent.setup()

    await screen.findByTestId('notify-me')
    scroll(true)
    const bar = screen.getByRole('region', { name: 'Quick buy' })
    expect(within(bar).getByText('Out of stock')).toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: 'Buy now' })).not.toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Notify me when it’s back' }))
    expect(within(screen.getByTestId('notify-me')).getByRole('button', { name: 'Notify me when it’s back' })).toHaveFocus()
  })
})
