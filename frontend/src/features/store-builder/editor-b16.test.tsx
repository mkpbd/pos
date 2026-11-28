import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { envelope, type CanvasMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentDetail } from './api'
import { detail, seedFullMode } from './test-helpers'

/*
 * B16 in the editor: presence avatars, the "someone else is editing" banner with a real read-only
 * editor (live refresh, Ask to edit, Take over, unsaved changes kept aside), comments (panel,
 * comment mode pins, @mentions, resolve, "C", bell deep link), the Activity tab, "Download a copy"
 * and a campaign page's "Change address…".
 */

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, ...toasts }) }
})
beforeEach(() => {
  Object.values(toasts).forEach((fn) => fn.mockReset())
  window.localStorage.clear()
  seedFullMode()
})

const RIMA = { id: 'u-2', name: 'Rima Akter' }
const DOC = '/storefront/builder/documents/doc-1'

type Calls = { method: string; path: string; body: unknown }[]

function presenceOf(lockHolder: { id: string; name: string } | null, extra: Record<string, unknown> = {}) {
  return {
    viewers: [
      { user: { id: 'u-1', name: 'Rahim Uddin' }, editing: lockHolder === null, since: null, last_seen: null, is_me: true },
      ...(lockHolder ? [{ user: lockHolder, editing: true, since: null, last_seen: null, is_me: false }] : [{ user: { id: 'u-3', name: 'Zahid Khan' }, editing: false, since: null, last_seen: null, is_me: false }]),
    ],
    lock: lockHolder ? { user: lockHolder, acquired_at: '2026-11-20T10:00:00Z', expires_at: '2099-01-01T00:00:00Z' } : { user: { id: 'u-1', name: 'Rahim Uddin' }, acquired_at: null, expires_at: null },
    mine: lockHolder === null,
    draft_revision: 3,
    comments: { open: 1, updated_at: '2026-11-20T10:00:00Z' },
    ...extra,
  }
}

const THREAD = {
  id: 'c1',
  number: 1,
  node_id: 'e_heading',
  node_removed: false,
  anchor: { x: 0.5, y: 0.5 },
  body: 'Make this bigger @Rahim Uddin',
  mentions: [{ id: 'u-1', name: 'Rahim Uddin' }],
  author: RIMA,
  parent_id: null,
  resolved_at: null,
  resolved_by: null,
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
  edited_at: null,
  can_edit: false,
  can_delete: true,
  replies: [],
}

type Options = {
  permissions?: string[]
  doc?: DocumentDetail
  presence?: () => ReturnType<typeof presenceOf>
  fetched?: () => DocumentDetail
  save?: (init: RequestInit) => ReturnType<typeof ok>
  comments?: unknown[]
}

function mockEditor(options: Options = {}) {
  const calls: Calls = []
  const log = (method: string, path: string) => (init: RequestInit) => void calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : null })
  const doc = options.doc ?? detail(cloneSample(), 3)
  const fetchMock = mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: options.permissions ?? ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    [`GET ${DOC}`]: () => ok(options.fetched ? options.fetched() : doc),
    'GET /storefront/builder/documents': ok([{ ...doc, content: undefined }]),
    'GET /storefront/builder/globals': ok([]),
    'GET /storefront/builder/templates': ok([]),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    [`POST ${DOC}/presence`]: (init) => {
      log('POST', 'presence')(init)
      return ok(options.presence ? options.presence() : presenceOf(null))
    },
    [`DELETE ${DOC}/presence`]: { status: 204 },
    [`POST ${DOC}/lock/take-over`]: (init) => {
      log('POST', 'take-over')(init)
      return ok(presenceOf(null))
    },
    [`POST ${DOC}/lock/request`]: (init) => {
      log('POST', 'request')(init)
      return ok({ sent: true })
    },
    [`PUT ${DOC}/draft`]: (init) => {
      log('PUT', 'draft')(init)
      if (options.save) return options.save(init)
      const body = JSON.parse(String(init.body)) as { revision: number; content: BuilderContent }
      return ok(detail(body.content, body.revision + 1))
    },
    [`GET ${DOC}/comments`]: ok(options.comments ?? [THREAD], { counts: { open: 1, resolved: 0 } }),
    [`POST ${DOC}/comments`]: (init) => {
      log('POST', 'comments')(init)
      return ok({ ...THREAD, id: 'c-new', number: 2, body: JSON.parse(String(init.body)).body })
    },
    [`POST ${DOC}/comments/c1/resolve`]: (init) => {
      log('POST', 'resolve')(init)
      return ok(null)
    },
    'GET /storefront/builder/mentionable': ok([RIMA, { id: 'u-3', name: 'Zahid Khan' }]),
    [`GET ${DOC}/versions`]: ok([{ id: 'v4', kind: 'version', number: 4, name: null, note: null, via: 'manual', published_at: '2026-11-19T10:00:00Z', created_by: RIMA, created_at: '2026-11-19T10:00:00Z' }]),
    [`GET ${DOC}/activity`]: ok(
      [
        { id: 'a1', at: '2026-11-20T09:40:00Z', user: RIMA, action: 'edited', summary: '', details: { saves: 12, started_at: '2026-11-20T09:10:00Z', ended_at: '2026-11-20T09:40:00Z' } },
        { id: 'a2', at: '2026-11-19T10:00:00Z', user: RIMA, action: 'published', summary: 'Published version 4', details: { version_id: 'v4', version_number: 4 } },
      ],
      { next_before: null },
    ),
    [`POST ${DOC}/address`]: (init) => {
      log('POST', 'address')(init)
      const slug = JSON.parse(String(init.body)).slug as string
      if (slug === 'taken') return fail(409, 'DOCUMENT_EXISTS', 'Taken')
      return ok({ ...doc, key: `landing:${slug}`, path: `/p/${slug}`, preview_url: `https://shop.test/p/${slug}?preview=draft`, content: undefined })
    },
  })
  return { calls, fetchMock }
}

async function openEditor(path = '/storefront/builder/doc-1') {
  renderRoutes(routes, path)
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined)
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  fromCanvas({ type: 'ready' })
  fromCanvas({
    type: 'rects',
    nodes: { s_story: { x: 0, y: 300, w: 1366, h: 400 }, e_heading: { x: 20, y: 320, w: 500, h: 40 }, e_text: { x: 20, y: 370, w: 500, h: 80 } },
    scrollY: 0,
    height: 2000,
    viewport: { w: 1366, h: 900 },
  })
  return { fromCanvas }
}

const heartbeat = () => act(() => void window.dispatchEvent(new Event('focus')))

describe('store builder editor (B16): presence & the edit lock', () => {
  it('shows who else is here and stays editable while the lock is mine', async () => {
    const { calls } = mockEditor()
    await openEditor()
    expect(await screen.findByTestId('presence-avatars')).toHaveAccessibleName('Also on this page: Zahid Khan (viewing)')
    expect(calls.find((c) => c.path === 'presence')?.body).toEqual({ editing: true })
    expect(screen.queryByTestId('presence-banner')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled()
  })

  it('turns the editor read-only while someone else edits, refreshes the draft and lets me ask or take over', async () => {
    const user = userEvent.setup()
    let revision = 3
    const changed = cloneSample()
    changed.sections = changed.sections.filter((s) => s.id !== 's_hero')
    const { calls } = mockEditor({ presence: () => presenceOf(RIMA, { draft_revision: revision }), fetched: () => detail(revision === 3 ? cloneSample() : changed, revision) })
    const { fromCanvas } = await openEditor()

    const banner = await screen.findByTestId('presence-banner')
    expect(banner).toHaveTextContent('Rima Akter is editing this page. You can look and comment.')
    expect(screen.getByTestId('presence-rima'.replace('rima', 'u-2'))).toHaveAccessibleName('Rima Akter, editing')
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Home', level: 1 })).toBeInTheDocument()

    // The inspector shows everything, but nothing can be changed.
    fromCanvas({ type: 'click', id: 'e_heading' })
    const inspector = screen.getByTestId('inspector-panel')
    await waitFor(() => expect(within(inspector).getAllByTestId('inspector-read-only').length).toBeGreaterThan(0))
    for (const field of within(inspector).getAllByRole('textbox')) expect(field).toBeDisabled()
    // Keys that change the page are refused with a word why.
    await user.keyboard('{Delete}')
    await waitFor(() => expect(toasts.info).toHaveBeenCalledWith('Rima Akter is editing this page. You can look and leave comments.', expect.anything()))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    // Live refresh: the next heartbeat has a newer revision.
    revision = 5
    heartbeat()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Layers' })).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: /Hero/ })).not.toBeInTheDocument())

    await user.click(within(banner).getByRole('button', { name: 'Ask to edit' }))
    await waitFor(() => expect(calls.some((c) => c.path === 'request')).toBe(true))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('Rima Akter got a notification')))

    await user.click(within(banner).getByRole('button', { name: 'Take over' }))
    await waitFor(() => expect(screen.queryByTestId('presence-banner')).not.toBeInTheDocument())
    expect(calls.some((c) => c.path === 'take-over')).toBe(true)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled()
  })

  it('B22a: switching to read-only and back keeps the drag sensors stable (no React hook warning)', async () => {
    const user = userEvent.setup()
    const errors = vi.spyOn(console, 'error')
    mockEditor({ presence: () => presenceOf(RIMA) })
    await openEditor()
    const banner = await screen.findByTestId('presence-banner')
    await user.click(within(banner).getByRole('button', { name: 'Take over' }))
    await waitFor(() => expect(screen.queryByTestId('presence-banner')).not.toBeInTheDocument())
    const sizeWarnings = errors.mock.calls.filter((call) => call.some((arg) => typeof arg === 'string' && arg.includes('changed size between renders')))
    expect(sizeWarnings).toEqual([])
    errors.mockRestore()
  })

  it('offers no Take over to people who can’t publish while the lease is live', async () => {
    mockEditor({ permissions: ['storefront.view', 'storefront.manage'], presence: () => presenceOf(RIMA) })
    await openEditor()
    const banner = await screen.findByTestId('presence-banner')
    expect(within(banner).getByRole('button', { name: 'Ask to edit' })).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument()
  })

  it('keeps my unsaved changes aside when someone takes over, and puts them back after I take over again', async () => {
    const user = userEvent.setup()
    let holder: typeof RIMA | null = null
    mockEditor({
      presence: () => presenceOf(holder),
      save: () => {
        holder = RIMA
        return fail(423, 'DOCUMENT_LOCKED', 'Rima Akter is editing this page.', { user: RIMA }) as ReturnType<typeof ok>
      },
    })
    const { fromCanvas } = await openEditor()
    await screen.findByTestId('presence-avatars')
    fromCanvas({ type: 'click', id: 'e_heading' })
    const field = await within(screen.getByTestId('inspector-panel')).findByLabelText('Heading text')
    await user.clear(field)
    await user.type(field, 'Mine')

    const banner = await screen.findByTestId('presence-banner', {}, { timeout: 8000 })
    expect(banner).toHaveTextContent('Your changes that weren’t saved are kept on this computer.')
    expect(within(banner).getByRole('button', { name: 'Copy my changes' })).toBeInTheDocument()

    holder = null
    await user.click(within(banner).getByRole('button', { name: 'Take over' }))
    const stash = await screen.findByTestId('stash-banner')
    await user.click(within(stash).getByRole('button', { name: 'Put my changes back' }))
    await waitFor(() => expect(screen.queryByTestId('stash-banner')).not.toBeInTheDocument())
    expect(within(screen.getByTestId('inspector-panel')).getByLabelText('Heading text')).toHaveValue('Mine')
  })
})

describe('store builder editor (B16): comments', () => {
  it('lists threads, drops a pin in comment mode, mentions someone and resolves', async () => {
    const user = userEvent.setup()
    const { calls } = mockEditor()
    await openEditor()
    const button = await screen.findByTestId('comments-button')
    await waitFor(() => expect(within(button).getByTestId('comments-count')).toHaveTextContent('1 open'))
    await user.click(button)
    const panel = await screen.findByTestId('comments-panel')
    const thread = await within(panel).findByTestId('comment-thread-c1')
    expect(thread).toHaveTextContent('Make this bigger @Rahim Uddin')
    expect(within(thread).getByRole('button', { name: /Show on the page: Heading/ })).toBeInTheDocument()
    expect(await screen.findByTestId('comment-pin-c1')).toHaveAccessibleName(/Comment 1 by Rima Akter: Make this bigger/)

    // Comment mode: a click on the page drops a pin on the part under it.
    await user.click(within(panel).getByTestId('comment-mode-button'))
    fireEvent.click(screen.getByTestId('comment-catcher'), { clientX: 270, clientY: 330 })
    const draft = await within(panel).findByTestId('comment-draft')
    expect(draft).toHaveTextContent('New comment on “Heading')
    const box = within(draft).getByTestId('new-comment-box')
    await user.type(box, 'Ask @Ri')
    const option = await screen.findByRole('option', { name: /Rima Akter/ })
    expect(box).toHaveAttribute('aria-expanded', 'true')
    await user.click(option)
    expect(box).toHaveValue('Ask @Rima Akter ')
    await user.type(box, 'please')
    await user.click(within(draft).getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(calls.find((c) => c.path === 'comments')?.body).toEqual({ body: 'Ask @Rima Akter please', node_id: 'e_heading', anchor: { x: 0.5, y: 0.25 }, mentions: ['u-2'] }))

    await user.click(within(thread).getByRole('button', { name: 'Resolve comment 1' }))
    await waitFor(() => expect(calls.some((c) => c.path === 'resolve')).toBe(true))
  })

  it('"C" starts a comment on the selected part; a removed part is named so', async () => {
    const user = userEvent.setup()
    mockEditor({ comments: [{ ...THREAD, id: 'c9', node_id: 'e_gone', node_removed: true }] })
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'click', id: 'e_heading' })
    await act(async () => (document.activeElement as HTMLElement | null)?.blur())
    await user.keyboard('c')
    const panel = await screen.findByTestId('comments-panel')
    expect(within(panel).getByTestId('comment-draft')).toHaveTextContent('New comment on “Heading')
    expect(within(panel).getByTestId('comment-removed-part')).toHaveTextContent('On a removed part')
  })

  it('opens at the comment from a bell notification link', async () => {
    mockEditor()
    await openEditor('/storefront/builder/doc-1?comment=c1')
    const thread = await screen.findByTestId('comment-thread-c1')
    await waitFor(() => expect(thread).toHaveAttribute('data-active', 'true'))
    // Its part of the page is selected.
    await waitFor(() => expect(within(screen.getByTestId('inspector-panel')).getByRole('heading', { level: 2 })).toHaveTextContent('Heading'))
  })
})

describe('store builder editor (B16): activity, download and address', () => {
  it('shows the activity in plain words with links to versions', async () => {
    const user = userEvent.setup()
    mockEditor()
    await openEditor()
    await user.click(screen.getByRole('button', { name: 'More page actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Version history/ }))
    await user.click(await screen.findByRole('tab', { name: 'Activity' }))
    const list = await screen.findByTestId('activity-list')
    expect(list).toHaveTextContent('Rima Akter edited the draft (12 saves, 3:10–3:40 PM)')
    expect(list).toHaveTextContent('Rima Akter published version 4')
    await user.click(within(list).getByRole('button', { name: 'See version 4' }))
    await waitFor(() => expect(screen.getByTestId('version-4')).toHaveFocus())
  })

  it('downloads a copy of the page as a .json file', async () => {
    const user = userEvent.setup()
    const { fetchMock } = mockEditor()
    await openEditor()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(`${DOC}/export`)
        ? new Response(JSON.stringify({ format: 'pos-builder-page', version: 1 }), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="home.json"' } })
        : original(input, init),
    )
    const created: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:x'), revokeObjectURL: () => undefined }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await user.click(screen.getByRole('button', { name: 'More page actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Download a copy (.json)' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('“home.json” is downloaded')))
    expect(click).toHaveBeenCalled()
    expect(await created[0]!.text()).toContain('pos-builder-page')
  })

  it('changes a campaign page’s address; a taken one is refused', async () => {
    const user = userEvent.setup()
    const doc = { ...detail(cloneSample(), 3), key: 'landing:eid', path: '/p/eid', preview_url: 'https://shop.test/p/eid?preview=draft' }
    const { calls } = mockEditor({ doc })
    await openEditor()
    await user.click(await screen.findByRole('button', { name: 'Change address…' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('New address')
    await user.clear(input)
    await user.type(input, 'taken')
    await user.click(within(dialog).getByRole('button', { name: 'Change address' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That address is taken. Try another one.')
    await user.clear(input)
    await user.type(input, 'Eid Sale 2026')
    expect(within(dialog).getByTestId('address-preview')).toHaveTextContent('https://shop.test/p/eid-sale-2026')
    await user.click(within(dialog).getByRole('button', { name: 'Change address' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('The page is now at /p/eid-sale-2026. Old links forward to it.'))
    expect(calls.filter((c) => c.path === 'address').map((c) => c.body)).toEqual([{ slug: 'taken' }, { slug: 'eid-sale-2026' }])
  })
})
