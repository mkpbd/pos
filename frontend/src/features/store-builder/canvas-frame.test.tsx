import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { envelope, type CanvasMessage, type ParentMessage } from '@/storefront/builder/canvas/protocol'
import { cloneSample, samplePage } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { CanvasFrame, type CanvasHandle } from './canvas-frame'
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
})
