import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { envelope, type CanvasMessage, type ParentMessage } from '@/storefront/builder/canvas/protocol'
import { cloneSample, samplePage } from '@/storefront/builder/test-payload'
import { POPUP_DEFAULTS } from '@/storefront/builder/validate'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { CanvasFrame, type CanvasHandle } from './canvas-frame'
import { toolbarPosition } from './toolbar-position'
import { toRenderTree } from './render-tree'

const ORIGIN = window.location.origin

function setup(overrides: Partial<Parameters<typeof CanvasFrame>[0]> = {}) {
  const onSelect = vi.fn()
  const onHover = vi.fn()
  const onKey = vi.fn()
  const handle = createRef<CanvasHandle>()
  const page = samplePage({ source: 'draft' })
  const props = {
    bootstrap: bootstrapFixture(),
    locale: 'en',
    sections: page.sections,
    data: page.data,
    media: page.media,
    pending: [],
    selection: null,
    hover: null,
    errorIds: [],
    device: 'desktop' as const,
    dragging: false,
    indicator: null,
    onSelect,
    onHover,
    onKey,
    toolbar: () => <div data-testid="toolbar">Tools</div>,
    hoverLabel: (id: string) => `Label of ${id}`,
    handleRef: handle,
    ...overrides,
  }
  const view = render(<CanvasFrame {...props} />)
  const iframe = screen.getByTitle(/Page canvas/) as HTMLIFrameElement
  const child = iframe.contentWindow!
  const posted: (ParentMessage & { source: string })[] = []
  vi.spyOn(child, 'postMessage').mockImplementation((data: unknown) => {
    posted.push(data as ParentMessage & { source: string })
  })
  const fromCanvas = (data: CanvasMessage, init: { origin?: string; source?: MessageEventSource } = {}) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: init.origin ?? ORIGIN, source: init.source ?? child })))
  return { props, view, iframe, posted, fromCanvas, onSelect, onHover, onKey, handle }
}

describe('canvas frame (editor side)', () => {
  it('loads the canvas page with a title and answers ready with init and render', () => {
    const { iframe, posted, fromCanvas } = setup({ selection: 'e_heading' })
    expect(iframe.getAttribute('src')).toBe('/admin/builder-canvas')
    fromCanvas({ type: 'ready' })
    expect(posted.map((m) => m.type)).toEqual(['init', 'render'])
    expect(posted[1]).toMatchObject({ type: 'render', selection: 'e_heading', device: 'desktop', source: 'pos-builder', v: 1 })
  })

  it('render → rects → click selects; messages from another origin or window are ignored', () => {
    const { fromCanvas, onSelect, onHover, onKey, handle, view, props } = setup()
    fromCanvas({ type: 'ready' })
    fromCanvas({ type: 'rects', nodes: { e_heading: { x: 10, y: 50, w: 300, h: 40 } }, scrollY: 0, height: 2000, viewport: { w: 1366, h: 800 } })
    expect(handle.current!.rects()).toEqual({ e_heading: { x: 10, y: 50, w: 300, h: 40 } })

    fromCanvas({ type: 'click', id: 'e_heading' })
    expect(onSelect).toHaveBeenCalledWith('e_heading')
    fromCanvas({ type: 'hover', id: 'e_text' })
    expect(onHover).toHaveBeenCalledWith('e_text')
    fromCanvas({ type: 'key', key: 'z', ctrl: true, shift: false, meta: false })
    expect(onKey).toHaveBeenCalledWith(expect.objectContaining({ key: 'z', ctrl: true }))

    fromCanvas({ type: 'click', id: 'e_text' }, { origin: 'https://evil.test' })
    fromCanvas({ type: 'click', id: 'e_text' }, { source: window })
    expect(onSelect).toHaveBeenCalledTimes(1)

    // With the rects known, the selected node gets its toolbar.
    view.rerender(<CanvasFrame {...props} selection="e_heading" />)
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
  })

  it('sends a new render when the draft changes', () => {
    const { posted, fromCanvas, view, props } = setup()
    fromCanvas({ type: 'ready' })
    const doc = cloneSample()
    const sections = toRenderTree(doc, { locale: 'en', now: Date.now() })
    view.rerender(<CanvasFrame {...props} sections={sections} device="mobile" />)
    expect(posted.at(-1)).toMatchObject({ type: 'render', device: 'mobile' })
  })

  it('B8b: a popup document sends its settings with the render message', () => {
    const popup = { ...structuredClone(POPUP_DEFAULTS), layout: 'slide_in' as const }
    const { posted, fromCanvas } = setup({ surroundings: 'popup', popup })
    fromCanvas({ type: 'ready' })
    expect(posted.at(-1)).toMatchObject({ type: 'render', surroundings: 'popup', popup: { layout: 'slide_in' } })
  })

  it('P1b: a product page zone sends the product it is previewed on; without one, no product field', () => {
    const product = { name: 'Red sneaker', price: '1250.00', image_url: '/media/red.jpg' }
    const { posted, fromCanvas, view, props } = setup({ surroundings: 'zone:product.below_price', product })
    fromCanvas({ type: 'ready' })
    expect(posted.at(-1)).toMatchObject({ type: 'render', surroundings: 'zone:product.below_price', product })
    view.rerender(<CanvasFrame {...props} surroundings="zone:product.bottom" product={null} />)
    expect(posted.at(-1)).toMatchObject({ type: 'render', surroundings: 'zone:product.bottom' })
    expect(posted.at(-1)).not.toHaveProperty('product')
  })
})

describe('canvas frame (B3)', () => {
  it('sends the draft theme after init, and again when it changes', () => {
    const { posted, fromCanvas, view, props } = setup({ theme: { colors: { primary: '#111111' } } })
    fromCanvas({ type: 'ready' })
    expect(posted.map((m) => m.type)).toEqual(['init', 'theme', 'render'])
    view.rerender(<CanvasFrame {...props} theme={{ colors: { primary: '#222222' } }} />)
    expect(posted.at(-1)).toMatchObject({ type: 'theme', settings: { colors: { primary: '#222222' } } })
  })

  it('draws a handle between side-by-side columns; arrow keys and dragging resize', () => {
    const onResize = vi.fn()
    const resizeRow = { rowId: 's_story', columns: [{ id: 'c_story_text', width: 50 }, { id: 'c_story_media', width: 50 }] }
    const { fromCanvas } = setup({ resizeRow, onResize })
    fromCanvas({ type: 'ready' })
    fromCanvas({ type: 'rects', nodes: { c_story_text: { x: 0, y: 100, w: 500, h: 300 }, c_story_media: { x: 524, y: 100, w: 500, h: 300 } }, scrollY: 0, height: 2000, viewport: { w: 1366, h: 800 } })
    const handle = screen.getByRole('separator', { name: 'Width of columns 1 and 2' })
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith('s_story', 0, 55, 'end')

    // 1000 px for 100 % at scale 1 in jsdom (area width 0 → scale 1): 10 px per percent.
    fireEvent.pointerDown(handle, { button: 0, clientX: 512, pointerId: 1 })
    expect(screen.getByTestId('column-resize-cover')).toBeInTheDocument()
    fireEvent.pointerMove(window, { clientX: 612, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith('s_story', 0, 60, 'move')
    expect(screen.getByTestId('column-resize-label')).toHaveTextContent('60 % | 40 %')
    fireEvent.pointerUp(window, { clientX: 612, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith('s_story', 0, 60, 'end')
    expect(screen.queryByTestId('column-resize-cover')).toBeNull()
  })

  it('no handle between stacked columns', () => {
    const resizeRow = { rowId: 's_story', columns: [{ id: 'c_story_text', width: 100 }, { id: 'c_story_media', width: 100 }] }
    const { fromCanvas } = setup({ resizeRow, onResize: vi.fn() })
    fromCanvas({ type: 'ready' })
    fromCanvas({ type: 'rects', nodes: { c_story_text: { x: 0, y: 0, w: 375, h: 300 }, c_story_media: { x: 0, y: 320, w: 375, h: 300 } }, scrollY: 0, height: 2000, viewport: { w: 375, h: 800 } })
    expect(screen.queryByRole('separator')).toBeNull()
  })
})

describe('toolbarPosition', () => {
  const area = { w: 1200, h: 800 }

  it('sits above a node when there is room', () => {
    expect(toolbarPosition({ x: 100, y: 200, w: 400, h: 60 }, 1, area, 380)).toEqual({ left: 100, top: 166 })
  })

  it('goes just below a node at the top of the page when that is on screen', () => {
    expect(toolbarPosition({ x: 0, y: 0, w: 1200, h: 300 }, 1, area, 380)).toEqual({ left: 0, top: 302 })
  })

  it('sits inside a tall top node at its top-right corner, so the first heading stays clear', () => {
    expect(toolbarPosition({ x: 0, y: 0, w: 1200, h: 2000 }, 1, area, 380)).toEqual({ left: 818, top: 2 })
  })

  it('never runs off the right edge, whatever its width', () => {
    expect(toolbarPosition({ x: 1000, y: 300, w: 150, h: 40 }, 1, area, 420)).toEqual({ left: 780, top: 266 })
  })
})

describe('canvas frame (B10)', () => {
  const rects = { e_heading: { x: 10, y: 100, w: 300, h: 40 }, s_features: { x: 0, y: 200, w: 1000, h: 300 } }

  it('hands edit messages to the editor and hides the mini toolbar while a text is edited', () => {
    const onEdit = vi.fn()
    const { fromCanvas, handle, posted } = setup({ selection: 'e_heading', onEdit })
    fromCanvas({ type: 'ready' })
    fromCanvas({ type: 'rects', nodes: rects, scrollY: 0, height: 2000, viewport: { w: 1366, h: 800 } })
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()

    fromCanvas({ type: 'text-edit-start', id: 'e_heading', field: 'text', locale: 'en', kind: 'line' })
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'text-edit-start', id: 'e_heading', field: 'text' }))
    expect(screen.queryByTestId('toolbar')).toBeNull()
    expect(handle.current!.editing()).toBe('e_heading')

    // Ending the edit from the editor (another node chosen, undo, device switch).
    handle.current!.endTextEdit(true)
    expect(posted.at(-1)).toMatchObject({ type: 'end-text-edit', commit: true, source: 'pos-builder' })

    fromCanvas({ type: 'text-edit-commit', id: 'e_heading', field: 'text', value: 'New', locale: 'en' })
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'text-edit-commit', value: 'New' }))
    expect(screen.getByTestId('toolbar')).toBeInTheDocument()
    expect(handle.current!.editing()).toBeNull()
    // Nothing to end any more.
    const count = posted.length
    handle.current!.endTextEdit(false)
    expect(posted).toHaveLength(count)

    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fromCanvas({ type: 'image-drop', id: 'e_image', target: 'image', file })
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'image-drop', id: 'e_image', file }))
    fromCanvas({ type: 'text-edit-link', id: 'e_text', field: 'html', url: null })
    expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'text-edit-link' }))
  })

  it('rerender sends the render again; edit-text focuses the canvas first; a desktop file drag lets the pointer through the overlay', () => {
    const { fromCanvas, handle, posted, iframe } = setup({ selection: 'e_heading' })
    fromCanvas({ type: 'ready' })
    const renders = () => posted.filter((m) => m.type === 'render').length
    const before = renders()
    act(() => handle.current!.rerender())
    expect(renders()).toBe(before + 1)

    const focus = vi.spyOn(iframe.contentWindow!, 'focus')
    handle.current!.editText('e_heading')
    expect(focus).toHaveBeenCalled()
    expect(posted.at(-1)).toMatchObject({ type: 'edit-text', id: 'e_heading' })

    const overlay = screen.getByTestId('canvas-overlay')
    expect(overlay).not.toHaveAttribute('data-file-drag')
    const files = new Event('dragenter') as Event & { dataTransfer: { types: string[] } }
    Object.defineProperty(files, 'dataTransfer', { value: { types: ['Files'] } })
    act(() => void window.dispatchEvent(files))
    expect(overlay).toHaveAttribute('data-file-drag', 'true')
    expect(overlay.className).toContain('[&_*]:pointer-events-none!')
    // Dropped on the canvas: the overlay comes back.
    fromCanvas({ type: 'image-drop', id: 'e_image', target: 'image', file: new File(['x'], 'a.png', { type: 'image/png' }) })
    expect(overlay).not.toHaveAttribute('data-file-drag')
    // A text being dragged (not a file) changes nothing.
    const text = new Event('dragenter') as Event & { dataTransfer: { types: string[] } }
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'] } })
    act(() => void window.dispatchEvent(text))
    expect(overlay).not.toHaveAttribute('data-file-drag')
  })

  it('edit-text, link results and the language go to the canvas; a language change is set-locale, not a new init', () => {
    const { fromCanvas, handle, posted, view, props } = setup()
    fromCanvas({ type: 'ready' })
    handle.current!.editText('e_heading')
    expect(posted.at(-1)).toMatchObject({ type: 'edit-text', id: 'e_heading' })
    expect(posted.at(-1)).not.toHaveProperty('field')
    handle.current!.editText('e_heading', 'text')
    expect(posted.at(-1)).toMatchObject({ type: 'edit-text', id: 'e_heading', field: 'text' })
    handle.current!.linkResult('/shop')
    expect(posted.at(-1)).toMatchObject({ type: 'text-edit-link-result', url: '/shop' })

    posted.length = 0
    view.rerender(<CanvasFrame {...props} locale="bn" />)
    expect(posted.map((m) => m.type)).toEqual(['set-locale'])
    expect(posted[0]).toMatchObject({ locale: 'bn' })
  })

  it('sends the store’s uploaded fonts with the theme, and again when they change', () => {
    const fonts = [{ id: 'f-1', key: 'custom:f-1', name: 'Shapla', family: 'sf-custom-f1', url: '/fonts/f1.woff2' }]
    const { fromCanvas, posted, view, props } = setup({ theme: { colors: { primary: '#111111' } }, fonts })
    fromCanvas({ type: 'ready' })
    expect(posted.find((m) => m.type === 'theme')).toMatchObject({ fonts })
    view.rerender(<CanvasFrame {...props} fonts={[]} />)
    expect(posted.at(-1)).toMatchObject({ type: 'theme', fonts: [] })
  })

  it('draws upload progress over the node', () => {
    const { fromCanvas } = setup({ uploads: { s_features: { progress: 0.42, name: 'farm.jpg' } } })
    fromCanvas({ type: 'ready' })
    fromCanvas({ type: 'rects', nodes: rects, scrollY: 0, height: 2000, viewport: { w: 1366, h: 800 } })
    const bar = screen.getByRole('progressbar', { name: 'Uploading farm.jpg' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveTextContent('42 %')
  })

  it('spacing handles: drag snaps to 4 px with a badge (Alt = margin); arrow keys step by 4 px', () => {
    const onChange = vi.fn()
    const spacing = {
      nodeId: 's_features', label: 'section', deviceLabel: 'mobile',
      values: { padding: { top: 48, bottom: 48 }, margin: { top: 0, bottom: null } }, onChange,
    }
    const { fromCanvas } = setup({ selection: 's_features', spacing })
    fromCanvas({ type: 'ready' })
    fromCanvas({ type: 'rects', nodes: rects, scrollY: 0, height: 2000, viewport: { w: 1366, h: 800 } })
    const bottom = screen.getByRole('slider', { name: 'Padding bottom of the section on mobile' })
    expect(bottom).toHaveAttribute('aria-valuenow', '48')

    fireEvent.pointerDown(bottom, { button: 0, clientY: 500, pointerId: 1 })
    expect(screen.getByTestId('spacing-cover')).toBeInTheDocument()
    fireEvent.pointerMove(window, { clientY: 517, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('padding', 'bottom', 64, 'move')
    expect(screen.getByTestId('spacing-badge')).toHaveTextContent('Padding bottom · 64 px')
    fireEvent.pointerUp(window, { clientY: 517, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('padding', 'bottom', 64, 'end')
    expect(screen.queryByTestId('spacing-cover')).toBeNull()

    // Alt + drag up on the top edge grows the margin above.
    const top = screen.getByRole('slider', { name: 'Padding top of the section on mobile' })
    fireEvent.pointerDown(top, { button: 0, clientY: 200, altKey: true, pointerId: 2 })
    fireEvent.pointerMove(window, { clientY: 176, pointerId: 2 })
    expect(onChange).toHaveBeenLastCalledWith('margin', 'top', 24, 'move')
    expect(screen.getByTestId('spacing-badge')).toHaveTextContent('Margin top · 24 px')
    fireEvent.pointerUp(window, { clientY: 176, pointerId: 2 })

    fireEvent.keyDown(top, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('padding', 'top', 52, 'end')
    // A margin set in a unit that can't be dragged is left alone.
    onChange.mockClear()
    fireEvent.keyDown(bottom, { key: 'ArrowDown', altKey: true })
    expect(onChange).not.toHaveBeenCalled()
  })
})
