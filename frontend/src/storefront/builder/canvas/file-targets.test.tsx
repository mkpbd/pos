import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { bootstrapFixture } from '../../test-fixtures'
import { documentOf, elementNode, IMAGE_MEDIA_ID, payloadOf } from '../test-payload'
import { CanvasApp } from './canvas-app'
import { dropTargetOf, fileTargetAt, galleryListOf } from './file-targets'
import { envelope, readCanvasMessage, type ParentMessage } from './protocol'
import { createCanvasQueryClient } from './query-client'
import type { TreeNode } from './text-fields'

/* B21: picture files dragged from the computer onto the canvas — where they land, and what the canvas tells the editor. */

const ORIGIN = window.location.origin

function box(el: Element, x: number, y: number, w: number, h: number) {
  el.getBoundingClientRect = () => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect
}

/**
 * s_1 (0–600): column c_1 (heading 20–60, image 80–280, gallery 300–500) and an empty column
 * c_2; s_bg has a column with a background picture; a global section.
 */
function page() {
  document.body.innerHTML = `
    <section data-b="s_1">
      <div data-b="c_1"><h2 data-b="e_head">Hello</h2><figure data-b="e_img"><img alt=""></figure><div data-b="e_gal"><img alt=""></div></div>
      <div data-b="c_2"></div>
    </section>
    <section data-b="s_bg"><div data-b="c_bg"><p data-b="e_text">Text</p></div></section>
    <section data-b="s_glob" data-b-global><div data-b="c_glob"><p data-b="e_glob">Global</p></div></section>`
  const q = (id: string) => document.querySelector(`[data-b="${id}"]`)!
  box(q('s_1'), 0, 0, 1000, 600)
  box(q('c_1'), 0, 0, 500, 600)
  box(q('e_head'), 0, 20, 500, 40)
  box(q('e_img'), 0, 80, 500, 200)
  box(q('e_gal'), 0, 300, 500, 200)
  box(q('c_2'), 500, 0, 500, 600)
  box(q('s_bg'), 0, 600, 1000, 300)
  box(q('c_bg'), 0, 600, 1000, 300)
  box(q('e_text'), 0, 650, 1000, 200)
  const nodes = new Map<string, TreeNode>([
    ['s_1', { id: 's_1', type: 'section', style: {} }],
    ['c_1', { id: 'c_1', type: 'column', style: {} }],
    ['e_head', { id: 'e_head', type: 'heading' }],
    ['e_img', { id: 'e_img', type: 'image' }],
    ['e_gal', { id: 'e_gal', type: 'gallery', props: { images: [] } }],
    ['c_2', { id: 'c_2', type: 'column', style: {} }],
    ['s_bg', { id: 's_bg', type: 'section', style: {} }],
    ['c_bg', { id: 'c_bg', type: 'column', style: { base: { background: { type: 'image', image: { media_id: 'm' } } } } }],
    ['e_text', { id: 'e_text', type: 'text' }],
    ['s_glob', { id: 's_glob', type: 'section', global: true }],
    ['c_glob', { id: 'c_glob', type: 'column', global: true }],
    ['e_glob', { id: 'e_glob', type: 'text', global: true }],
  ])
  return { q, nodes }
}

describe('B21 file drop targets', () => {
  it('a picture is replaced, a gallery takes items (not a product gallery)', () => {
    const { q, nodes } = page()
    expect(fileTargetAt(q('e_img').querySelector('img'), { x: 10, y: 100 }, nodes)).toMatchObject({ node_id: 'e_img', kind: 'replace', rect: { y: 80, h: 200 } })
    expect(fileTargetAt(q('e_gal').querySelector('img'), { x: 10, y: 400 }, nodes)).toMatchObject({ node_id: 'e_gal', kind: 'insert', into: 'items' })
    expect(galleryListOf('horizontal_gallery', { source: 'products' })).toBeNull()
    expect(galleryListOf('horizontal_gallery', { source: 'images' })).toBe('items')
    expect(galleryListOf('logo_carousel', {})).toBe('logos')
    expect(galleryListOf('heading', {})).toBeNull()
  })

  it('an element’s top or bottom edge adds pictures beside it (a line), its middle is the section background', () => {
    const { q, nodes } = page()
    expect(fileTargetAt(q('e_head'), { x: 10, y: 22 }, nodes)).toEqual({ node_id: 'c_1', kind: 'insert', into: 'column', index: 0, before: 'e_head', rect: { x: 0, y: 20, w: 500, h: 0 }, line: true })
    expect(fileTargetAt(q('e_head'), { x: 10, y: 58 }, nodes)).toMatchObject({ node_id: 'c_1', kind: 'insert', index: 1, before: 'e_img', rect: { y: 80 }, line: true })
    expect(fileTargetAt(q('e_head'), { x: 10, y: 40 }, nodes)).toMatchObject({ node_id: 's_1', kind: 'background', rect: { y: 0, h: 600 } })
    // In the column between elements: by the midpoints; after the last one = the end.
    expect(fileTargetAt(q('c_1'), { x: 10, y: 290 }, nodes)).toMatchObject({ node_id: 'c_1', kind: 'insert', index: 2, before: 'e_gal' })
    expect(fileTargetAt(q('c_1'), { x: 10, y: 590 }, nodes)).toMatchObject({ node_id: 'c_1', kind: 'insert', index: 3, before: null, rect: { y: 500 } })
    // An empty column: its box.
    expect(fileTargetAt(q('c_2'), { x: 600, y: 300 }, nodes)).toEqual({ node_id: 'c_2', kind: 'insert', into: 'column', index: 0, before: null, rect: { x: 500, y: 0, w: 500, h: 600 } })
    // The section's own area.
    expect(fileTargetAt(q('s_1'), { x: 5, y: 5 }, nodes)).toMatchObject({ node_id: 's_1', kind: 'background' })
  })

  it('a column that already has a background picture keeps taking it (B10); Shift picks the background; global sections take nothing', () => {
    const { q, nodes } = page()
    expect(fileTargetAt(q('e_text'), { x: 10, y: 750 }, nodes)).toMatchObject({ node_id: 'c_bg', kind: 'background' })
    expect(fileTargetAt(q('e_img'), { x: 10, y: 100 }, nodes, { background: true })).toMatchObject({ node_id: 's_1', kind: 'background' })
    expect(fileTargetAt(q('e_glob'), { x: 10, y: 10 }, nodes)).toBeNull()
    expect(fileTargetAt(null, { x: 0, y: 0 }, nodes)).toBeNull()
    expect(dropTargetOf({ node_id: 'c_1', kind: 'insert', into: 'column', index: 1, before: 'e_img', rect: { x: 0, y: 0, w: 1, h: 0 }, line: true })).toEqual({ node_id: 'c_1', kind: 'insert', into: 'column', index: 1, before: 'e_img' })
  })

  it('the protocol accepts drag-files and drop-files from the canvas', () => {
    for (const type of ['drag-files', 'drop-files']) {
      const event = new MessageEvent('message', { data: envelope({ type } as never), origin: ORIGIN, source: window })
      expect(readCanvasMessage(event, ORIGIN, window)).toMatchObject({ type })
    }
  })
})

describe('B21 files dropped on the canvas', () => {
  const doc = documentOf([elementNode('heading', 'e_head', { text: 'Fresh bread' }), elementNode('image', 'e_img', { media_id: IMAGE_MEDIA_ID, alt: 'Loaf' })])
  const payload = payloadOf(doc, { source: 'draft' })

  async function mount() {
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
    const send = (data: ParentMessage) => act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: ORIGIN, source: window })))
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send({ type: 'render', sections: payload.sections, data: payload.data, media: payload.media, selection: null, hover: null, errors: [], device: 'desktop', pending: [] })
    await screen.findByRole('heading', { name: 'Fresh bread' })
    return { sent: (type: string) => posted.filter((m) => m.type === type) }
  }

  /** A drag event at a point (jsdom has no DragEvent coordinates). */
  const drag = (type: 'dragOver' | 'drop', el: Element, init: { dataTransfer: unknown; shiftKey?: boolean }, y = 0) => {
    const event = createEvent[type](el, init)
    Object.defineProperty(event, 'clientX', { value: 1 })
    Object.defineProperty(event, 'clientY', { value: y })
    fireEvent(el, event)
  }

  const transfer = (files: File[]) => ({ types: ['Files'], files, items: files.map(() => ({ kind: 'file' })), dropEffect: 'none' })

  it('tells the editor where the files would land, and hands several files over as drop-files', async () => {
    const { sent } = await mount()
    const heading = screen.getByRole('heading', { name: 'Fresh bread' })
    const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]
    const dataTransfer = transfer(files)
    // jsdom draws nothing (0-size boxes): the pointer is at the heading's top edge.
    drag('dragOver', heading, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(sent('drag-files')).toEqual([expect.objectContaining({ over: expect.objectContaining({ node_id: 'c_row0', kind: 'insert', into: 'column', before: 'e_head', line: true }), count: 2 })])
    // The same place again: not repeated.
    drag('dragOver', heading, { dataTransfer })
    expect(sent('drag-files')).toHaveLength(1)
    drag('drop', heading, { dataTransfer })
    expect(sent('drop-files')).toEqual([expect.objectContaining({ target: { node_id: 'c_row0', kind: 'insert', into: 'column', index: 0, before: 'e_head' }, files })])
    expect(sent('drag-files').at(-1)).toMatchObject({ over: null })
    expect(sent('image-drop')).toHaveLength(0)
  })

  it('one file on a picture is still the B10 image-drop; several replace it and add the rest (drop-files); at most 10 go', async () => {
    const { sent } = await mount()
    const image = document.querySelector<HTMLElement>('[data-b="e_img"]')!
    const one = new File(['x'], 'photo.png', { type: 'image/png' })
    fireEvent.drop(image, { dataTransfer: transfer([one]) })
    expect(sent('image-drop')).toEqual([expect.objectContaining({ id: 'e_img', target: 'image', file: one })])
    expect(sent('drop-files')).toHaveLength(0)

    const twelve = Array.from({ length: 12 }, (_, i) => new File([String(i)], `p${i}.png`, { type: 'image/png' }))
    fireEvent.drop(image, { dataTransfer: transfer(twelve) })
    const [drop] = sent('drop-files') as unknown as [{ target: unknown; files: File[] }]
    expect(drop.target).toEqual({ node_id: 'e_img', kind: 'replace' })
    expect(drop.files).toHaveLength(10)
    expect(sent('image-drop')).toHaveLength(1)
  })

  it('a dragged text (not files) is left alone; leaving the canvas clears the place', async () => {
    const { sent } = await mount()
    const heading = screen.getByRole('heading', { name: 'Fresh bread' })
    fireEvent.dragOver(heading, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(sent('drag-files')).toHaveLength(0)
    drag('dragOver', heading, { dataTransfer: transfer([new File(['a'], 'a.png', { type: 'image/png' })]) })
    fireEvent.dragLeave(heading, { relatedTarget: null })
    expect(sent('drag-files').map((m) => m.over === null)).toEqual([false, true])
  })
})
