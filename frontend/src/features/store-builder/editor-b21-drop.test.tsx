import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ApiError } from '@/lib/api/client'
import { envelope, type CanvasMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from './test-helpers'

/* B21 in the editor: picture files dropped on the canvas are uploaded one by one and placed in one undo step. */

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, ...toasts }) }
})
const upload = vi.hoisted(() => vi.fn())
vi.mock('./media-upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('./media-upload')>()), uploadPicture: upload }))

beforeEach(() => {
  Object.values(toasts).forEach((fn) => fn.mockReset())
  upload.mockReset()
  let n = 0
  upload.mockImplementation(async (file: File, options: { onProgress?: (f: number) => void; alt?: string }) => {
    options.onProgress?.(0.5)
    n += 1
    return { id: `0190a1c9-0000-7000-8000-00000000000${n}`, url: `/storage/media/${file.name}`, srcset: '', width: 800, height: 600, alt: options.alt ?? null, mime_type: file.type }
  })
})

function mockEditor() {
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(cloneSample(), 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number; content: never }
      return ok({ ...detail(body.content, body.revision + 1) })
    },
  })
}

async function openEditor() {
  const user = userEvent.setup()
  mockEditor()
  renderRoutes(routes, '/storefront/builder/doc-1')
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  await user.click(await screen.findByRole('tab', { name: 'Layers' }))
  const undo = within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' })
  return { user, fromCanvas, undo }
}

const png = (name: string) => new File(['png'], name, { type: 'image/png' })
const layerNames = () => within(screen.getByRole('tree')).getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))

describe('store builder editor (B21 pictures from the computer)', () => {
  it('several pictures between elements: uploaded with a suggested description, added in one undo step', async () => {
    const { user, fromCanvas, undo } = await openEditor()
    fromCanvas({ type: 'drop-files', target: { node_id: 'c_story_text', kind: 'insert', into: 'column', index: 1, before: 'e_text' }, files: [png('fresh-mango.png'), png('red_saree.png')] })
    await waitFor(() => expect(layerNames()).toEqual(expect.arrayContaining(['Image: Fresh mango', 'Image: Red saree'])))
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[0]![1]).toMatchObject({ alt: 'Fresh mango' })
    expect(toasts.success).toHaveBeenCalledWith(expect.stringMatching(/^2 pictures added\. Check their descriptions/))
    // Placed in order, before the text.
    const names = layerNames()
    expect(names.indexOf('Image: Fresh mango')).toBeLessThan(names.indexOf('Image: Red saree'))
    expect(names.indexOf('Image: Red saree')).toBeLessThan(names.findIndex((n) => n?.startsWith('Text')))

    await user.click(undo)
    await waitFor(() => expect(layerNames()).not.toContain('Image: Fresh mango'))
    expect(layerNames()).not.toContain('Image: Red saree')
    expect(undo).toBeDisabled()
  })

  it('each file that can’t be used or fails gets its own message; the rest still arrive', async () => {
    const { fromCanvas } = await openEditor()
    upload.mockImplementationOnce(async () => {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Invalid.', { file: ['The picture is too wide.'] })
    })
    fromCanvas({
      type: 'drop-files',
      target: { node_id: 'c_story_text', kind: 'insert', into: 'column', before: null },
      files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }), png('wide.png'), png('basket.png')],
    })
    await waitFor(() => expect(layerNames()).toContain('Image: Basket'))
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/“menu.pdf” isn’t a picture we can use/))
    expect(toasts.error).toHaveBeenCalledWith('“wide.png”: The picture is too wide.')
    expect(layerNames()).not.toContain('Image: Wide')
    expect(toasts.success).toHaveBeenCalledWith(expect.stringMatching(/^1 picture added/))
  })

  it('at most 10 pictures per drop; a background takes one; progress shows over the target', async () => {
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'rects', nodes: { s_story: { x: 0, y: 0, w: 800, h: 400 }, c_story_text: { x: 0, y: 0, w: 400, h: 400 } }, scrollY: 0, height: 2000, viewport: { w: 1366, h: 800 } })
    let release: () => void = () => {}
    upload.mockImplementationOnce(
      (file: File, options: { onProgress?: (f: number) => void }) =>
        new Promise((resolve) => {
          options.onProgress?.(0.4)
          release = () => resolve({ id: '0190a1c9-0000-7000-8000-0000000000aa', url: `/storage/media/${file.name}`, srcset: '', width: 1, height: 1, alt: null })
        }),
    )
    fromCanvas({ type: 'drop-files', target: { node_id: 's_story', kind: 'background' }, files: [png('wall.png'), png('other.png')] })
    const bar = await screen.findByRole('progressbar', { name: /Uploading wall.png/ })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(toasts.info).toHaveBeenCalledWith('A background takes one picture: the first one is used.')
    await act(async () => release())
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringMatching(/^Background picture set/)))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('progressbar')).toBeNull()

    upload.mockClear()
    fromCanvas({ type: 'drop-files', target: { node_id: 'c_story_text', kind: 'insert', into: 'column', before: null }, files: Array.from({ length: 12 }, (_, i) => png(`p${i}.png`)) })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(10))
    expect(toasts.info).toHaveBeenCalledWith('Up to 10 pictures at a time: the first 10 are added.')
  })

  it('the canvas says where the files would land; dropping clears it', async () => {
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'drag-files', over: { node_id: 'c_story_text', kind: 'insert', into: 'column', index: 0, before: 'e_heading', rect: { x: 0, y: 40, w: 400, h: 0 }, line: true }, count: 3 })
    const mark = screen.getByTestId('file-drop-mark')
    expect(mark).toHaveAttribute('data-kind', 'insert')
    expect(within(mark).getByRole('status')).toHaveTextContent('Add 3 pictures here')
    fromCanvas({ type: 'drag-files', over: { node_id: 'e_image', kind: 'replace', rect: { x: 400, y: 0, w: 400, h: 300 } } })
    expect(within(screen.getByTestId('file-drop-mark')).getByRole('status')).toHaveTextContent('Replace picture')
    fromCanvas({ type: 'drop-files', target: { node_id: 'e_image', kind: 'replace' }, files: [png('a-cat.png'), png('b-dog.png')] })
    expect(screen.queryByTestId('file-drop-mark')).toBeNull()
    await waitFor(() => expect(layerNames()).toEqual(expect.arrayContaining(['Image: A cat', 'Image: B dog'])))
    fromCanvas({ type: 'drag-files', over: { node_id: 's_story', kind: 'background', rect: { x: 0, y: 0, w: 800, h: 400 } } })
    fromCanvas({ type: 'drag-files', over: null })
    expect(screen.queryByTestId('file-drop-mark')).toBeNull()
  })
})
