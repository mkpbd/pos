import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { bootstrapFixture } from '../../test-fixtures'
import { samplePage } from '../test-payload'
import { CanvasApp } from './canvas-app'
import { BUILDER_SOURCE, envelope, isEditorShortcut, PROTOCOL_VERSION, readCanvasMessage, readParentMessage, type ParentMessage } from './protocol'
import { createCanvasQueryClient } from './query-client'
import { sanitizeHtml } from './sanitize'

const ORIGIN = window.location.origin

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

  it('cleans custom HTML like the server: no scripts, iframes, handlers, classes or ids', () => {
    expect(sanitizeHtml('<div class="x" id="y" onclick="z()"><script>1</script><iframe src="https://evil.test"></iframe><b>Hi</b></div>', { dropClassAndId: true })).toBe('<div><b>Hi</b></div>')
    expect(sanitizeHtml('<p class="x">a</p>')).toBe('<p class="x">a</p>')
  })
})
