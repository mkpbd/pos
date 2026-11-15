import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { envelope, type CanvasMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from './test-helpers'

/* B12 in the editor (editor A): several selected, the command box, the shortcut sheet, Copy to other pages. */

type Backend = { puts: { revision: number; content: BuilderContent }[]; copies: unknown[] }

function mockEditor(): Backend {
  const b: Backend = { puts: [], copies: [] }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(cloneSample(), 3)),
    'GET /storefront/builder/documents': ok([
      { ...detail(), content: undefined },
      { id: 'doc-2', kind: 'page', key: 'landing:sale', title: 'Big sale', path: '/p/sale', schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null, published: null },
      { id: 'doc-3', kind: 'popup', key: 'popup:x', title: 'Welcome popup', schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null, published: null },
    ]),
    'GET /storefront/builder/globals': ok([]),
    'GET /storefront/builder/templates': ok([]),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'POST /storefront/builder/sections/copy': (init) => {
      const body = JSON.parse(String(init.body)) as { document_ids: string[] }
      b.copies.push(body)
      return ok({ results: body.document_ids.map((id) => ({ document_id: id, title: 'Big sale', status: 'copied', section_id: 's_new', revision: 2 })) })
    },
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as Backend['puts'][number]
      b.puts.push(body)
      return ok({ ...detail(body.content, body.revision + 1) })
    },
  })
  return b
}

const RECTS = {
  s_story: { x: 0, y: 300, w: 1200, h: 400 },
  e_heading: { x: 20, y: 320, w: 500, h: 40 },
  e_text: { x: 20, y: 370, w: 500, h: 80 },
  e_button: { x: 20, y: 460, w: 200, h: 40 },
  e_image: { x: 620, y: 320, w: 500, h: 300 },
}

async function openEditor() {
  renderRoutes(routes, '/storefront/builder/doc-1')
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  fromCanvas({ type: 'ready' })
  fromCanvas({ type: 'rects', nodes: RECTS, scrollY: 0, height: 2000, viewport: { w: 1366, h: 900 } })
  return { frame, fromCanvas }
}

const layerNames = () => within(screen.getByRole('tree')).getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))

describe('store builder editor (B12, editor A)', () => {
  it('Ctrl+click selects several; the group toolbar deletes them after one confirmation, and one undo brings both back', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))

    fromCanvas({ type: 'click', id: 'e_heading', ctrl: false, shift: false, meta: false })
    fromCanvas({ type: 'click', id: 'e_button', ctrl: true, shift: false, meta: false })
    const toolbar = await screen.findByTestId('group-toolbar')
    expect(within(toolbar).getByTestId('selected-count')).toHaveTextContent('2 selected')
    expect(screen.getAllByTestId('multi-outline')).toHaveLength(1)

    await user.click(within(toolbar).getByRole('button', { name: 'Delete all (2)' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete these 2 items?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete 2 items' }))
    await waitFor(() => expect(layerNames()).not.toContain('Heading: Made fresh every morning'))
    expect(layerNames().some((name) => name?.startsWith('Button'))).toBe(false)

    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(layerNames()).toContain('Heading: Made fresh every morning'))
    expect(layerNames().some((name) => name?.startsWith('Button'))).toBe(true)
  })

  it('moves several siblings as a block, and Esc clears the selection', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    fromCanvas({ type: 'click', id: 'e_text', ctrl: false, shift: false, meta: false })
    fromCanvas({ type: 'click', id: 'e_button', ctrl: false, shift: true, meta: false })
    const toolbar = await screen.findByTestId('group-toolbar')
    await user.click(within(toolbar).getByRole('button', { name: 'Move up' }))
    await waitFor(() => {
      const names = layerNames()
      expect(names.indexOf('Heading: Made fresh every morning')).toBeGreaterThan(names.findIndex((n) => n?.startsWith('Text')))
    })
    // Already at the top: disabled.
    expect(within(toolbar).getByRole('button', { name: 'Move up' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('group-toolbar')).not.toBeInTheDocument())
  })

  it('Ctrl+K opens the command box: arrows and Enter add an element after the selection', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    fromCanvas({ type: 'click', id: 'e_heading', ctrl: false, shift: false, meta: false })
    await user.keyboard('{Control>}k{/Control}')
    const box = await screen.findByTestId('command-box')
    const input = within(box).getByRole('combobox', { name: /Find an element/ })
    expect(input).toHaveFocus()
    await user.type(input, 'বিভাজক')
    const option = await within(box).findByRole('option', { name: /Divider/ })
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', option.id)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByTestId('command-box')).not.toBeInTheDocument())
    await waitFor(() => {
      const names = layerNames()
      expect(names[names.indexOf('Heading: Made fresh every morning') + 1]).toBe('Divider')
    })
  })

  it('the command box goes to a node on the page; ? opens the shortcut sheet', async () => {
    const user = userEvent.setup()
    mockEditor()
    await openEditor()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await user.click(screen.getByRole('button', { name: 'Find or do anything' }))
    const box = await screen.findByTestId('command-box')
    await user.type(within(box).getByRole('combobox'), 'made fresh')
    await user.click(await within(box).findByRole('option', { name: /^Heading: Made fresh/ }))
    await waitFor(() => expect(within(screen.getByRole('tree')).getByRole('treeitem', { name: 'Heading: Made fresh every morning', selected: true })).toBeInTheDocument())

    await user.keyboard('?')
    const sheet = await screen.findByTestId('shortcut-sheet')
    expect(within(sheet).getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(within(sheet).getByRole('rowheader', { name: 'Find an element, a page or an action' })).toBeInTheDocument()
  })

  it('copies a section to other pages and shows what happened on each', async () => {
    const user = userEvent.setup()
    const b = mockEditor()
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'click', id: 's_story', ctrl: false, shift: false, meta: false })
    const mini = await screen.findByTestId('mini-toolbar')
    await user.click(within(mini).getByRole('button', { name: /More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Copy to other pages…' }))
    const dialog = await screen.findByTestId('copy-to-pages')
    // The open page and popups are not offered.
    await within(dialog).findByText('Big sale')
    expect(within(dialog).queryByText('Home')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Welcome popup')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('radio', { name: 'At the top' }))
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByText('Copied to 1 page.', { exact: false })).toBeInTheDocument()
    expect(b.copies[0]).toMatchObject({ document_ids: ['doc-2'], position: 'top', section: { id: 's_story', type: 'section' } })
  })
})
