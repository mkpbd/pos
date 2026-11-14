import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { bootstrapFixture } from '../../test-fixtures'
import { samplePage } from '../test-payload'
import { CanvasApp } from './canvas-app'
import { BUILDER_SOURCE, envelope, isEditorShortcut, PROTOCOL_VERSION, readCanvasMessage, readCanvasProduct, readParentMessage, type ParentMessage } from './protocol'
import { createCanvasQueryClient } from './query-client'
import { sanitizeHtml } from './sanitize'
import { POPUP_DEFAULTS } from '../validate'

const ORIGIN = window.location.origin

// B6: the canvas replays an entrance through the motion runtime's playMotion.
const motion = vi.hoisted(() => ({ played: [] as string[] }))
vi.mock('../motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../motion')>()),
  playMotion: (el: HTMLElement) => void motion.played.push(el.dataset.b ?? ''),
}))

function message(data: unknown, init: { origin?: string; source?: MessageEventSource | null } = {}) {
  return new MessageEvent('message', { data, origin: init.origin ?? ORIGIN, source: init.source === undefined ? window : init.source })
}

describe('builder canvas protocol', () => {
  it('accepts only same-origin messages from the expected window with the builder source and version', () => {
    const render = envelope({ type: 'scroll-to', id: 'e_x' } satisfies ParentMessage)
    expect(readParentMessage(message(render), ORIGIN, window)).toEqual(render)
    expect(readParentMessage(message(render, { origin: 'https://evil.test' }), ORIGIN, window)).toBeNull()
    expect(readParentMessage(message(render, { source: null }), ORIGIN, window)).toBeNull()
    expect(readParentMessage(message({ ...render, source: 'other' }), ORIGIN, window)).toBeNull()
    expect(readParentMessage(message({ ...render, v: 2 }), ORIGIN, window)).toBeNull()
    expect(readParentMessage(message('hello'), ORIGIN, window)).toBeNull()
    // Canvas messages are not parent messages and the other way round.
    expect(readParentMessage(message(envelope({ type: 'ready' })), ORIGIN, window)).toBeNull()
    expect(readCanvasMessage(message(envelope({ type: 'click', id: 'e_x' })), ORIGIN, window)).toEqual({ type: 'click', id: 'e_x', source: BUILDER_SOURCE, v: PROTOCOL_VERSION })
    expect(readCanvasMessage(message(render), ORIGIN, window)).toBeNull()
  })

  it('hands only the editor shortcuts to the editor', () => {
    expect(isEditorShortcut({ key: 'z', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isEditorShortcut({ key: 'Z', ctrlKey: false, metaKey: true })).toBe(true)
    expect(isEditorShortcut({ key: 'Delete', ctrlKey: false, metaKey: false })).toBe(true)
    expect(isEditorShortcut({ key: 'a', ctrlKey: false, metaKey: false })).toBe(false)
    expect(isEditorShortcut({ key: 'c', ctrlKey: true, metaKey: false })).toBe(false)
  })

  it('cleans unsaved rich text before drawing it', () => {
    const html = sanitizeHtml('<p onclick="x()" style="color:red">Hi <a href="javascript:alert(1)">x</a> <a href="/shop">shop</a></p><script>alert(1)</script><iframe src="https://evil.test"></iframe><p style="text-align: center">c</p>')
    expect(html).toBe('<p>Hi <a>x</a> <a href="/shop">shop</a></p><p style="text-align: center">c</p>')
  })
})

describe('builder canvas app', () => {
  function mount() {
    const posted: { type: string; [key: string]: unknown }[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data as { type: string })
    })
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const send = (data: ParentMessage, init?: { origin?: string }) => act(() => void window.dispatchEvent(message(envelope(data), init)))
    return { posted, send }
  }

  const page = samplePage({ source: 'draft' })
  const frame = (overrides: Partial<Extract<ParentMessage, { type: 'render' }>> = {}): ParentMessage => ({
    type: 'render',
    sections: page.sections,
    data: page.data,
    media: page.media,
    selection: null,
    hover: null,
    errors: [],
    device: 'desktop',
    pending: [],
    ...overrides,
  })

  it('says ready, draws what the editor sends, reports rects, clicks and hovers', async () => {
    const { posted, send } = mount()
    expect(posted[0]).toMatchObject({ type: 'ready', source: BUILDER_SOURCE, v: PROTOCOL_VERSION })
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(frame({ selection: 'e_heading', errors: ['e_button'] }))

    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    await waitFor(() => expect(posted.some((m) => m.type === 'rects')).toBe(true))
    const rects = posted.find((m) => m.type === 'rects') as unknown as { nodes: Record<string, unknown> }
    expect(Object.keys(rects.nodes)).toEqual(expect.arrayContaining(['s_story', 'c_story_text', 'e_heading', 'e_image']))
    // Selection and problems are outlined.
    expect(screen.getByTestId('canvas-outlines').textContent).toContain('[data-b="e_heading"]{outline:2px solid #2563eb')
    expect(screen.getByTestId('canvas-outlines').textContent).toContain('[data-b="e_button"]{outline:2px solid #dc2626')

    // Clicking selects the deepest node and never follows the link.
    const link = screen.getByRole('link', { name: 'Shop now' })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(posted.at(-1)).toMatchObject({ type: 'click', id: 'e_button' })
    fireEvent.mouseOver(screen.getByRole('heading', { name: 'Made fresh every morning' }))
    expect(posted.at(-1)).toMatchObject({ type: 'hover', id: 'e_heading' })

    // Editor shortcuts typed inside the canvas go to the editor.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(posted.at(-1)).toMatchObject({ type: 'key', key: 'z', ctrl: true })
  })

  it('B6: replays a node’s entrance animation when the editor asks (valid ids only)', async () => {
    const { send } = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(frame())
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    motion.played.length = 0
    send({ type: 'play-motion', id: 'e_heading' })
    send({ type: 'play-motion', id: 'e_missing' })
    send({ type: 'play-motion', id: '"]*' })
    expect(motion.played).toEqual(['e_heading'])
  })

  it('ignores messages from another origin and shows skeletons for pending sections', async () => {
    const { send } = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(frame({ data: {}, pending: ['e_grid'] }))
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    expect(screen.getAllByTestId('canvas-skeleton')).toHaveLength(1)

    send(frame({ sections: [], data: {} }), { origin: 'https://evil.test' })
    expect(screen.getByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    send(frame({ sections: [] }))
    expect(await screen.findByTestId('canvas-empty')).toBeInTheDocument()
  })
})

describe('builder canvas: headers, footers and zones (B4)', () => {
  function mount() {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return (data: ParentMessage) => act(() => void window.dispatchEvent(message(envelope(data))))
  }
  const page = samplePage({ source: 'draft' })
  const render$ = (overrides: Partial<Extract<ParentMessage, { type: 'render' }>> = {}): ParentMessage => ({
    type: 'render', sections: page.sections, data: page.data, media: page.media, selection: null, hover: null, errors: [], device: 'desktop', pending: [], ...overrides,
  })

  it('draws a header above a faded sample page; phones get a note about the compact header', async () => {
    const send = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(render$({ surroundings: 'header' }))
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('data-surroundings', 'header')
    const header = main.querySelector('[data-canvas-part="header"]')!
    const sample = screen.getByTestId('canvas-sample')
    expect(sample).toHaveAttribute('aria-hidden', 'true')
    expect(header.compareDocumentPosition(sample) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('canvas-compact-note')).toBeNull()

    send(render$({ surroundings: 'header', device: 'mobile' }))
    expect(await screen.findByTestId('canvas-compact-note')).toHaveTextContent('compact header')
  })

  it('draws a footer and the listing-bottom zone below their samples, with the kind’s empty text', async () => {
    const send = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(render$({ surroundings: 'zone:listing.bottom', sections: [], emptyText: 'This area is empty.' }))
    expect(await screen.findByTestId('canvas-empty')).toHaveTextContent('This area is empty.')
    const sample = screen.getByTestId('canvas-sample')
    expect(sample).toHaveTextContent('Product grid')
    expect(sample.compareDocumentPosition(screen.getByTestId('canvas-empty')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    send(render$({ surroundings: 'footer' }))
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    expect(screen.getByRole('main').querySelector('[data-canvas-part="footer"]')).not.toBeNull()
    expect(screen.getByTestId('canvas-sample')).toHaveTextContent('Your page content')

    // An unknown kind draws as a page.
    send(render$({ surroundings: 'evil' as never }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveAttribute('data-surroundings', 'page'))
    expect(screen.queryByTestId('canvas-sample')).toBeNull()
  })

  it('B8b: draws a popup in its layout over a faded page, without any of its behaviour', async () => {
    const send = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    const popup = { ...POPUP_DEFAULTS, layout: 'slide_in' as const, position: 'bottom_left' as const, width: 'sm' as const }
    send(render$({ surroundings: 'popup', popup }))
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('data-surroundings', 'popup')
    expect(screen.getByTestId('canvas-sample')).toBeInTheDocument()
    const frame = screen.getByTestId('builder-popup')
    expect(frame).toHaveAttribute('data-layout', 'slide_in')
    expect(frame).toHaveClass('absolute', 'left-4', 'max-w-sm')
    expect(screen.getByTestId('popup-close')).toBeInTheDocument()
    // Nothing runs: no portal, focus or scroll lock.
    expect(document.activeElement).toBe(document.body)

    send(render$({ surroundings: 'popup', popup: { ...POPUP_DEFAULTS, layout: 'modal' } }))
    await waitFor(() => expect(screen.getByTestId('builder-popup')).toHaveAttribute('data-layout', 'modal'))
    expect(screen.getByTestId('builder-popup')).toHaveAttribute('aria-modal', 'false')
    expect(document.body.style.overflow).toBe('')

    send(render$({ surroundings: 'popup', popup: { ...POPUP_DEFAULTS, layout: 'bar_top' }, sections: [], emptyText: 'This popup is empty.' }))
    expect(await screen.findByTestId('canvas-empty')).toHaveTextContent('This popup is empty.')
    expect(screen.getByTestId('builder-popup')).toHaveAttribute('role', 'region')
    expect(document.body.style.paddingTop).toBe('')
  })

  it('cleans custom HTML like the server: no scripts, iframes, handlers, classes or ids', () => {
    expect(sanitizeHtml('<div class="x" id="y" onclick="z()"><script>1</script><iframe src="https://evil.test"></iframe><b>Hi</b></div>', { dropClassAndId: true })).toBe('<div><b>Hi</b></div>')
    expect(sanitizeHtml('<p class="x">a</p>')).toBe('<p class="x">a</p>')
  })
})

describe('builder canvas: product page zones (P1b)', () => {
  function mount() {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return (data: ParentMessage) => act(() => void window.dispatchEvent(message(envelope(data))))
  }
  const page = samplePage({ source: 'draft' })
  const render$ = (overrides: Partial<Extract<ParentMessage, { type: 'render' }>> = {}): ParentMessage => ({
    type: 'render', sections: page.sections, data: page.data, media: page.media, selection: null, hover: null, errors: [], device: 'desktop', pending: [], ...overrides,
  })
  const shoe = { name: 'Red sneaker', price: '1250.00', image_url: '/media/red-sneaker.jpg' }
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

  it('reads only a well-formed product from the editor', () => {
    expect(readCanvasProduct(shoe)).toEqual(shoe)
    expect(readCanvasProduct({ name: '  Tea  ', price: null, image_url: 'https://cdn.test/tea.jpg' })).toEqual({ name: 'Tea', price: null, image_url: 'https://cdn.test/tea.jpg' })
    // Not a decimal price, an unsafe or protocol-relative image: dropped; no name: no product at all.
    expect(readCanvasProduct({ name: 'Tea', price: '12,50', image_url: 'javascript:alert(1)' })).toEqual({ name: 'Tea', price: null, image_url: null })
    expect(readCanvasProduct({ name: 'Tea', price: 12.5, image_url: '//evil.test/x.jpg' })).toEqual({ name: 'Tea', price: null, image_url: null })
    expect(readCanvasProduct({ name: '', price: '1.00' })).toBeNull()
    expect(readCanvasProduct('Tea')).toBeNull()
    expect(readCanvasProduct(undefined)).toBeNull()
  })

  it('draws the under-the-price zone in the summary column with the product it is previewed on', async () => {
    const send = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(render$({ surroundings: 'zone:product.below_price', product: shoe }))
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('data-surroundings', 'zone:product.below_price')

    // Name and price above the zone, Add to cart below it, the photos beside it.
    const zone = screen.getByRole('main').querySelector('[data-canvas-part="zone"]')!
    expect(zone.querySelector('[data-b="e_heading"]')).not.toBeNull()
    const head = screen.getByTestId('canvas-sample')
    expect(head).toHaveAttribute('aria-hidden', 'true')
    expect(follows(head, zone)).toBe(true)
    expect(follows(zone, screen.getByTestId('canvas-sample-after'))).toBe(true)
    expect(screen.getByTestId('canvas-product-name')).toHaveTextContent('Red sneaker')
    expect(screen.getByTestId('canvas-product-price')).toHaveTextContent('1,250.00')
    expect(screen.getByTestId('canvas-product-image')).toHaveAttribute('src', '/media/red-sneaker.jpg')
    expect(screen.getByText('Product page, previewed with “Red sneaker”')).toBeInTheDocument()
    // Today's layout: photos on the left with thumbnails under them, details in tabs.
    expect(screen.getByTestId('canvas-sample-gallery')).not.toHaveClass('md:order-2')
    expect(screen.getByTestId('canvas-sample-gallery').querySelector('[data-thumbnails="bottom"]')).not.toBeNull()
    expect(screen.getByRole('main').querySelector('[data-details="tabs"]')).not.toBeNull()

    // The Site styles draft moves the photos and changes the details at once.
    send({ type: 'theme', settings: { layout: { container_width: 1170, product: { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' } } } })
    await waitFor(() => expect(screen.getByTestId('canvas-sample-gallery')).toHaveClass('md:order-2'))
    expect(screen.getByTestId('canvas-sample-gallery').querySelector('[data-thumbnails="side"]')).not.toBeNull()
    expect(screen.getByRole('main').querySelector('[data-details="accordion"]')).not.toBeNull()

    // Empty: the empty note sits in the column.
    send(render$({ surroundings: 'zone:product.below_price', product: shoe, sections: [], emptyText: 'This area is empty.' }))
    expect(await screen.findByTestId('canvas-empty')).toHaveTextContent('This area is empty.')
    expect(screen.getByRole('main').querySelector('[data-canvas-part="zone"] [data-testid="canvas-empty"]')).not.toBeNull()
  })

  it('without a product (an older editor, or the version for all products) the samples stay grey', async () => {
    const send = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(render$({ surroundings: 'zone:product.below_price' }))
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-product-name')).toBeNull()
    expect(screen.queryByTestId('canvas-product-image')).toBeNull()
    expect(screen.getByText('Product details (filled in for each product)')).toBeInTheDocument()

    // A malformed product is ignored the same way.
    send(render$({ surroundings: 'zone:product.after', product: { name: 42 } as never }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveAttribute('data-surroundings', 'zone:product.after'))
    expect(screen.queryByTestId('canvas-product-name')).toBeNull()
  })

  it('draws the product.after zone between the details and related products, product.bottom after them', async () => {
    const send = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(render$({ surroundings: 'zone:product.after', product: shoe }))
    const heading = await screen.findByRole('heading', { name: 'Made fresh every morning' })
    expect(follows(screen.getByTestId('canvas-sample'), heading)).toBe(true)
    expect(follows(heading, screen.getByTestId('canvas-sample-after'))).toBe(true)
    expect(screen.getByTestId('canvas-sample-after')).toHaveTextContent('Related products')
    expect(screen.getByTestId('canvas-product-name')).toHaveTextContent('Red sneaker')

    send(render$({ surroundings: 'zone:product.bottom' }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveAttribute('data-surroundings', 'zone:product.bottom'))
    const sample = screen.getByTestId('canvas-sample')
    expect(sample).toHaveTextContent('Related products and recently viewed')
    expect(follows(sample, screen.getByRole('heading', { name: 'Made fresh every morning' }))).toBe(true)
    expect(screen.queryByTestId('canvas-sample-after')).toBeNull()
  })
})
