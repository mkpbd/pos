import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, listingBody, productCard, productDetail, resetLocale } from './test-fixtures'
import type { ProductDetail, SizeGuide } from './types'

afterEach(() => {
  resetLocale()
  localStorage.clear()
})

/* P1a: photos per colour, sold-out states with "Notify me", "Only N left", size guide and card colour chips. */

type MockHandler = Parameters<typeof mockApi>[0][string]

const images = [
  { id: 'red-1', url: '/storage/products/red-1.png', alt: 'Red tee, front' },
  { id: 'red-2', url: '/storage/products/red-2.png', alt: 'Red tee, back' },
  { id: 'blue-1', url: '/storage/products/blue-1.png', alt: 'Blue tee, front' },
  { id: 'blue-2', url: '/storage/products/blue-2.png', alt: 'Blue tee, back' },
  { id: 'label', url: '/storage/products/label.png', alt: 'Care label' },
]

const sizeGuide: SizeGuide = {
  title: 'Kids tee sizes',
  intro: 'Measure over light clothing.',
  columns: [
    { id: 'c1', label: 'Size' },
    { id: 'c2', label: 'Chest (cm)' },
    { id: 'c3', label: 'Length (cm)' },
  ],
  rows: [
    { id: 'r1', cells: { c1: 'M', c2: '64', c3: '48' } },
    { id: 'r2', cells: { c1: 'L', c2: '68', c3: '52' } },
  ],
  note: 'Between sizes? Take the larger one.',
  image: null,
}

function photoProduct(overrides: Partial<ProductDetail> = {}): ProductDetail {
  const base = productDetail()
  const [redM, redL, blueL] = base.variants
  return productDetail({
    images,
    photo_option: 'Colour',
    size_guide: sizeGuide,
    options: [
      {
        name: 'Colour',
        slug: 'colour',
        display: 'image',
        values: [
          { value: 'Red', swatch_hex: '#ff0000', image: images[0]!, image_ids: ['red-1', 'red-2'] },
          { value: 'Blue', swatch_hex: '#0000ff', image: images[2]!, image_ids: ['blue-1', 'blue-2'] },
        ],
      },
      { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null, image: null, image_ids: [] }, { value: 'L', swatch_hex: null, image: null, image_ids: [] }] },
    ],
    variants: [
      { ...redM!, image_id: null, stock_left: null },
      { ...redL!, image_id: null, stock_left: null },
      { ...blueL!, image_id: 'blue-2', low_stock: true, stock_left: 2 },
    ],
    ...overrides,
  })
}

function serve(product: ProductDetail, extra: Record<string, MockHandler> = {}, bootstrap = bootstrapFixture()) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/products/kids-tee': ok(product),
    'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
    'GET /store/products/kids-tee/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
    ...extra,
  })
}

const thumbnails = () => within(screen.getByRole('list', { name: 'Product images' })).getAllByRole('button')

describe('photos per colour', () => {
  it("shows the chosen colour's photos, keeps all photos reachable and marks the chosen chip with a check", async () => {
    serve(photoProduct())
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const colours = within(await screen.findByRole('group', { name: /Colour/ }))
    const red = colours.getByRole('radio', { name: 'Colour: Red' })
    expect(red).toBeChecked()
    // The chosen chip has a check mark as well as its ring: never colour alone.
    expect(document.querySelector(`label[for="${red.id}"] [data-testid="chip-check"]`)).not.toBeNull()
    expect(screen.getAllByTestId('chip-check')).toHaveLength(1)

    // Red's two photos only, then every image.
    expect(thumbnails()).toHaveLength(2)
    expect(within(screen.getByRole('button', { name: 'Open Kids Tee, image 1 of 2 full screen' })).getByRole('img')).toHaveAttribute('src', '/storage/products/red-1.png')
    await user.click(screen.getByRole('button', { name: 'All photos (5)' }))
    expect(thumbnails()).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Show image 1 of 5' })).toHaveAttribute('aria-current', 'true')
    await user.click(screen.getByRole('button', { name: 'Show image 5 of 5' }))
    await user.click(screen.getByRole('button', { name: 'Only photos of Red' }))
    expect(thumbnails()).toHaveLength(2)

    // Blue: its photos, starting on the variant's own photo; only two left.
    await user.click(colours.getByRole('radio', { name: 'Colour: Blue' }))
    expect(thumbnails()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute('aria-current', 'true')
    expect(within(screen.getByRole('button', { name: 'Open Kids Tee, image 2 of 2 full screen' })).getByRole('img')).toHaveAttribute('src', '/storage/products/blue-2.png')
    expect(screen.getByTestId('availability')).toHaveTextContent('Only 2 left')
  })

  it('keeps today’s gallery for products without photos per colour', async () => {
    serve(productDetail())
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    expect(await screen.findByRole('radio', { name: 'Colour: Red' })).toBeChecked()
    expect(thumbnails()).toHaveLength(2)
    expect(screen.queryByTestId('gallery-photo-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('size-guide-button')).not.toBeInTheDocument()
  })
})

describe('sold out and notify me', () => {
  it("crosses out sold-out values and turns the buy button into a back-in-stock form", async () => {
    const posts: unknown[] = []
    serve(photoProduct(), {
      'POST /store/products/kids-tee/notify': (init) => {
        posts.push(JSON.parse(String(init.body)))
        return { status: 202, body: { success: true, data: { message: 'Thanks — we will e-mail you when it is back.' }, meta: { request_id: 'test' } } }
      },
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const sizes = within(await screen.findByRole('group', { name: /Size/ }))
    const soldOut = sizes.getByRole('radio', { name: 'L (sold out)' })
    expect(soldOut).toBeEnabled()
    await user.click(soldOut)
    expect(screen.getByTestId('availability')).toHaveTextContent('Out of stock')
    expect(screen.queryByRole('form', { name: 'Add to cart' })).not.toBeInTheDocument()

    const notify = within(screen.getByTestId('notify-me'))
    expect(notify.getByText('Red / L is sold out right now.')).toBeInTheDocument()
    await user.click(notify.getByRole('button', { name: 'Notify me when it’s back' }))
    const form = within(screen.getByRole('form', { name: 'Back-in-stock e-mail for Kids Tee' }))
    const email = form.getByRole('textbox', { name: 'E-mail address' })
    expect(email).toHaveFocus()
    expect(email).toHaveAccessibleDescription('We will send you one e-mail when it is back in stock — nothing else.')

    await user.click(form.getByRole('button', { name: 'Notify me' }))
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(/Please enter a valid e-mail address\./)
    expect(posts).toHaveLength(0)

    await user.type(email, 'rina@example.com{Enter}')
    expect(await screen.findByText('Thanks — we will e-mail you when it is back.')).toBeInTheDocument()
    expect(posts).toEqual([{ variant_id: 'v-red-l', email: 'rina@example.com', website: '' }])
    expect(screen.queryByRole('form', { name: /Back-in-stock/ })).not.toBeInTheDocument()

    // Back to an in-stock size: the cart form returns.
    await user.click(sizes.getByRole('radio', { name: 'M' }))
    expect(screen.getByRole('form', { name: 'Add to cart' })).toBeInTheDocument()
  })

  it('shows the server’s e-mail error and a calm message when throttled', async () => {
    let calls = 0
    serve(photoProduct(), {
      'POST /store/products/kids-tee/notify': () => (++calls === 1 ? fail(422, 'VALIDATION_FAILED', 'Invalid', { email: ['That e-mail domain cannot receive mail.'] }) : fail(429, 'TOO_MANY_REQUESTS')),
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-red-l')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Notify me when it’s back' }))
    const email = screen.getByRole('textbox', { name: 'E-mail address' })
    await user.type(email, 'rina@example.invalid{Enter}')
    await waitFor(() => expect(email).toHaveAccessibleDescription(/That e-mail domain cannot receive mail\./))
    await user.click(screen.getByRole('button', { name: 'Notify me' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please try again later.')
  })
})

describe('size guide', () => {
  it('opens next to the size option as a dialog with a real table and returns focus on close', async () => {
    serve(photoProduct())
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const button = await screen.findByRole('button', { name: 'Size guide' })
    // Next to the Size option, not the colour one.
    expect(button.parentElement).toContainElement(screen.getByRole('group', { name: /Size/ }))
    await user.click(button)

    const dialog = within(await screen.findByRole('dialog', { name: 'Kids tee sizes' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Measure over light clothing.')
    const table = dialog.getByRole('table', { name: 'Kids tee sizes' })
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Chest (cm)', 'Length (cm)'])
    expect(within(table).getByRole('rowheader', { name: 'L' })).toBeInTheDocument()
    expect(within(table).getAllByRole('cell').map((c) => c.textContent)).toEqual(['64', '48', '68', '52'])
    expect(dialog.getByRole('region', { name: 'Kids tee sizes' })).toHaveAttribute('tabindex', '0')
    expect(dialog.getByText('Between sizes? Take the larger one.')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
  })

  it('sits under the options when no option is a size, and closes with its button', async () => {
    const product = photoProduct()
    serve({ ...product, options: product.options.map((o) => (o.name === 'Size' ? { ...o, name: 'Fit', slug: 'fit' } : o)), variants: product.variants.map((v) => ({ ...v, option_values: { Colour: v.option_values.Colour!, Fit: v.option_values.Size! } })) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const button = await screen.findByRole('button', { name: 'Size guide' })
    expect(button.parentElement).toBe(screen.getByTestId('variant-selector'))
    await user.click(button)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('card colour chips', () => {
  it('shows up to five chips plus the rest and swaps the card image on hover and focus', async () => {
    const card = productCard('kids-tee', {
      variant_count: 3,
      default_variant_id: null,
      hover_image: { url: '/storage/products/hover.png', alt: 'Kids Tee worn' },
      swatches: {
        option: 'Colour',
        values: [
          { value: 'Red', swatch_hex: '#ff0000', image: { url: '/storage/products/red-1.png', alt: 'Red tee' } },
          { value: 'Blue', swatch_hex: '#0000ff', image: { url: '/storage/products/blue-1.png', alt: 'Blue tee' } },
          { value: 'Mint', swatch_hex: '#99e2c8', image: null },
        ],
        more: 2,
      },
    })
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/products': { body: listingBody([card, productCard('kids-cap')]) } })
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const [tee, cap] = await screen.findAllByTestId('product-card')
    expect(within(cap!).queryByTestId('card-swatches')).not.toBeInTheDocument()
    const chips = within(within(tee!).getByRole('list', { name: 'Colour choices' }))
    expect(chips.getByRole('img', { name: 'Colour: Mint' })).toBeInTheDocument()
    expect(chips.getByText('and 2 more')).toBeInTheDocument()
    const image = () => tee!.querySelector('img')!

    expect(image()).toHaveAttribute('src', '/storage/products/kids-tee.png')
    await user.hover(chips.getByRole('button', { name: 'Show Colour: Blue' }))
    expect(image()).toHaveAttribute('src', '/storage/products/blue-1.png')
    // The card's own hover image steps aside while a colour is shown.
    expect(tee!.querySelectorAll('img')).toHaveLength(1)
    await user.unhover(chips.getByRole('button', { name: 'Show Colour: Blue' }))
    expect(image()).toHaveAttribute('src', '/storage/products/kids-tee.png')

    await user.click(chips.getByRole('button', { name: 'Show Colour: Red' }))
    await user.tab()
    expect(chips.getByRole('button', { name: 'Show Colour: Red' })).toHaveAttribute('aria-pressed', 'true')
    expect(image()).toHaveAttribute('src', '/storage/products/blue-1.png')
    await user.tab()
    expect(image()).toHaveAttribute('src', '/storage/products/red-1.png')
  })
})

describe('variants in Bangla', () => {
  it('reads the new labels in Bangla', async () => {
    serve(photoProduct(), {}, bilingualBootstrap())
    renderRoutes(storefrontRoutes, '/product/kids-tee?lang=bn&variant=v-blue-l')
    const user = userEvent.setup()

    expect(await screen.findByTestId('availability')).toHaveTextContent('মাত্র 2টি বাকি')
    expect(screen.getByRole('button', { name: 'সব ছবি (5)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'L' })).toBeChecked()
    // Red comes in L only sold out: the chip says so with the current size.
    await user.click(screen.getByRole('radio', { name: 'Colour: Red (বিক্রি শেষ)' }))
    expect(screen.getByRole('radio', { name: 'L (বিক্রি শেষ)' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'আবার এলে আমাকে জানান' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'সাইজ গাইড' }))
    expect(await screen.findByRole('dialog', { name: 'Kids tee sizes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'বন্ধ করুন' })).toBeInTheDocument()
  })
})
