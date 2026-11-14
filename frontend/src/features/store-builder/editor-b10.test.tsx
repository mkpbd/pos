import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { envelope, type CanvasMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from './test-helpers'
import { findNode } from './tree'

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, ...toasts }) }
})
beforeEach(() => Object.values(toasts).forEach((fn) => fn.mockReset()))

/* B10 in the editor: text edits from the canvas, Edit in English | বাংলা, dropped pictures, Check page and the publish summary. */

type Backend = { puts: { revision: number; content: BuilderContent }[]; checks: { content?: BuilderContent }[] }

function mockEditor(options: { locales?: string[]; check?: 'ok' | 'fail'; content?: BuilderContent } = {}): Backend {
  const b: Backend = { puts: [], checks: [] }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(options.content ?? cloneSample(), 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: options.locales ?? ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as Backend['puts'][number]
      b.puts.push(body)
      return ok({ ...detail(body.content, body.revision + 1) })
    },
    'POST /storefront/builder/documents/doc-1/check': (init) => {
      b.checks.push(JSON.parse(String(init.body)) as { content?: BuilderContent })
      if (options.check === 'fail') return fail(503, 'SERVICE_UNAVAILABLE', 'Down.')
      return ok({
        issues: [{ code: 'link_missing_page', severity: 'error', node_id: 'e_button', message: 'The button links to a page that doesn’t exist.', details: { url: '/gone' } }],
        counts: { error: 1, warning: 0, tip: 0 },
        checked_at: '2026-11-14T10:00:00Z',
      })
    },
  })
  return b
}

async function openEditor() {
  renderRoutes(routes, '/storefront/builder/doc-1')
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  return { frame, fromCanvas }
}

const layerNames = () => within(screen.getByRole('tree')).getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))

describe('store builder editor (B10)', () => {
  it('applies a text edit from the canvas as one undo step; a too-long label is cut with a note', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))

    fromCanvas({ type: 'text-edit-start', id: 'e_heading', field: 'text', locale: 'en', kind: 'line' })
    fromCanvas({ type: 'text-edit-commit', id: 'e_heading', field: 'text', value: 'Baked at dawn', locale: 'en', kind: 'line' })
    await waitFor(() => expect(layerNames()).toContain('Heading: Baked at dawn'))
    expect(within(screen.getByRole('tree')).getByRole('treeitem', { name: 'Heading: Baked at dawn', selected: true })).toBeInTheDocument()

    const undo = within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' })
    await user.click(undo)
    await waitFor(() => expect(layerNames()).toContain('Heading: Made fresh every morning'))
    expect(undo).toBeDisabled()

    fromCanvas({ type: 'text-edit-commit', id: 'e_button', field: 'label', value: 'y'.repeat(70), locale: 'en', kind: 'line' })
    expect(toasts.info).toHaveBeenCalledWith(expect.stringMatching(/Cut to 60 characters/))
    await waitFor(() => expect(layerNames()).toContain(`Button: ${'y'.repeat(47)}…`))
    fromCanvas({ type: 'text-edit-commit', id: 'e_button', field: 'variant', value: 'x', locale: 'en' })
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/can’t be changed on the page/))
  })

  it('a refused text commit still sends a render, so the canvas shows the old text at once', async () => {
    mockEditor()
    const { frame, fromCanvas } = await openEditor()
    const posted: { type: string }[] = []
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((data: unknown) => void posted.push(data as { type: string }))
    fromCanvas({ type: 'ready' })
    await waitFor(() => expect(posted.some((m) => m.type === 'render')).toBe(true))
    const renders = () => posted.filter((m) => m.type === 'render').length
    const before = renders()
    fromCanvas({ type: 'text-edit-commit', id: 'e_heading', field: 'text', value: '   ', locale: 'en', kind: 'line' })
    expect(toasts.error).toHaveBeenCalled()
    await waitFor(() => expect(renders()).toBeGreaterThan(before))
  })

  it('Edit in বাংলা: the canvas edits the Bangla text, saved to translations.bn', async () => {
    const user = userEvent.setup()
    const b = mockEditor({ locales: ['en', 'bn'] })
    const { fromCanvas } = await openEditor()
    const group = screen.getByRole('group', { name: 'Edit in' })
    await user.click(within(group).getByRole('button', { name: 'বাংলা' }))
    expect(within(group).getByRole('button', { name: 'বাংলা' })).toHaveAttribute('aria-pressed', 'true')

    fromCanvas({ type: 'text-edit-commit', id: 'e_heading', field: 'text', value: 'প্রতিদিন সকালে তাজা', locale: 'bn' })
    await waitFor(() => expect(b.puts.length).toBeGreaterThan(0), { timeout: 4000 })
    const heading = findNode(b.puts.at(-1)!.content, 'e_heading')!.node as { props: { text: string }; translations: Record<string, Record<string, string>> }
    expect(heading.translations.bn?.text).toBe('প্রতিদিন সকালে তাজা')
    expect(heading.props.text).toBe('Made fresh every morning')
  })

  it('the language toggle is offered only when the store has Bangla', async () => {
    mockEditor()
    await openEditor()
    await screen.findByRole('banner', { name: 'Editor toolbar' })
    expect(screen.queryByRole('group', { name: 'Edit in' })).toBeNull()
  })

  it('a dropped file that isn’t a picture gets a plain message; Replace picture opens the media chooser', async () => {
    mockEditor()
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'image-drop', id: 'e_image', target: 'image', file: new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }) })
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/“menu.pdf” isn’t a picture we can use/))

    fromCanvas({ type: 'image-replace', id: 'e_image', target: 'image' })
    expect(await screen.findByRole('dialog', { name: 'Replace picture' })).toBeInTheDocument()
  })

  it('Check page: the panel lists the client and server issues; the server gets the current content', async () => {
    const user = userEvent.setup()
    const b = mockEditor()
    await openEditor()
    const toolbar = screen.getByRole('banner', { name: 'Editor toolbar' })
    await user.click(within(toolbar).getByRole('button', { name: /Check page/ }))
    const panel = await screen.findByTestId('check-panel')
    expect(await within(panel).findByText('The button links to a page that doesn’t exist.')).toBeInTheDocument()
    expect(b.checks[0]?.content?.sections.map((s) => s.id)).toEqual(cloneSample().sections.map((s) => s.id))
    expect(within(panel).getByTestId('check-summary')).toHaveTextContent(/error/)
    expect(within(toolbar).getByTestId('check-badge')).toBeInTheDocument()

    // The node's name selects it on the page.
    await user.click(within(panel).getByRole('button', { name: 'Button: Shop now' }))
    await user.click(within(panel).getByRole('button', { name: 'Close the page check' }))
    expect(screen.queryByTestId('check-panel')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Layers' })).toBeInTheDocument()
  })

  it('the publish dialog shows the check summary; errors don’t block publishing', async () => {
    const user = userEvent.setup()
    mockEditor()
    await openEditor()
    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish this page?' })
    const summary = within(dialog).getByTestId('publish-check')
    await waitFor(() => expect(summary).toHaveTextContent(/Page check: .*1 error/))
    expect(within(summary).getByText('The button links to a page that doesn’t exist.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publish anyway' })).toBeEnabled()
  })

  it('when the server checks fail, the dialog says so and still lets you publish', async () => {
    const user = userEvent.setup()
    mockEditor({ check: 'fail' })
    await openEditor()
    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish this page?' })
    expect(await within(dialog).findByText(/Couldn’t run the server checks — try again/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^Publish/ })).toBeEnabled()
  })

  it('Fix it applies a fix as one undo step, or selects the node for a field to fill in', async () => {
    const user = userEvent.setup()
    const content = cloneSample()
    const heading = findNode(content, 'e_feat_a')!.node as { visibility: Record<string, boolean> }
    heading.visibility = { desktop: false, tablet: false, mobile: false }
    mockEditor({ content })
    await openEditor()
    const toolbar = screen.getByRole('banner', { name: 'Editor toolbar' })
    await user.click(within(toolbar).getByRole('button', { name: /Check page/ }))
    const panel = await screen.findByTestId('check-panel')
    const issue = await within(panel).findByTestId('check-issue-hidden_everywhere')
    await user.click(within(issue).getByRole('button', { name: /^Show it on all devices/ }))
    expect(toasts.success).toHaveBeenCalledWith('Fixed. Undo puts it back.')
    await waitFor(() => expect(within(panel).queryByTestId('check-issue-hidden_everywhere')).toBeNull())
    await user.click(within(toolbar).getByRole('button', { name: 'Undo' }))
    expect(await within(panel).findByTestId('check-issue-hidden_everywhere')).toBeInTheDocument()

    // A server issue's Fix it selects its node in the inspector.
    const server = within(panel).getByTestId('check-issue-link_missing_page')
    await user.click(within(server).getByRole('button', { name: /^Select it: The button links to a page/ }))
    await waitFor(() => expect(within(screen.getByTestId('inspector-panel')).getByLabelText(/Button text|Label/i)).toHaveValue('Shop now'))
  })
})
