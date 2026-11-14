import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentDetail } from './api'
import { clearClipboardMemory } from './clipboard'
import { makeGlobal } from './global-sections'
import { detail } from './test-helpers'

/*
 * B9 in the editor: copy & paste with the keyboard, a global section reference (its panel, detach),
 * Make global from the Layers menu, and a global's own document.
 */

const GID = '01a1c9d9-0000-7000-8000-0000000000aa'
const story = () => structuredClone(cloneSample().sections[1]!)

function globalDetail(): DocumentDetail {
  return {
    id: GID, kind: 'global', key: `global:${GID}`, title: 'Our story', schema_version: 1, draft_revision: 2, has_unpublished_changes: false,
    draft_updated_at: null, published: { version_id: 'v-1', number: 1, published_at: '2026-11-10T10:00:00Z' }, path: null, preview_url: null,
    context: 'page', content: { schema_version: 1, sections: [{ ...story(), id: 's_global' }] },
    global: { usage_count: 2, used_in: [{ id: 'doc-1', title: 'Home', kind: 'page', key: 'home' }, { id: 'doc-2', title: 'About', kind: 'page', key: 'cms:x' }] },
  }
}

function mockEditor(content: BuilderContent, extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  const puts: { revision: number; content: BuilderContent }[] = []
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(content, 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/builder/globals': ok([{ ...globalDetail(), content: undefined, usage_count: 2, used_in: globalDetail().global!.used_in }]),
    [`GET /storefront/builder/documents/${GID}`]: ok(globalDetail()),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number; content: BuilderContent }
      puts.push(body)
      return ok({ ...detail(body.content, body.revision + 1) })
    },
    ...extra,
  })
  return puts
}

const tree = () => screen.getByRole('tree', { name: 'Page layers' })
const rowNames = () => within(tree()).getAllByRole('treeitem').map((row) => row.getAttribute('aria-label'))

beforeEach(() => {
  window.localStorage.clear()
  clearClipboardMemory()
})

describe('B9 editor: copy & paste and global sections', () => {
  it('copies the selected heading with Ctrl+C and pastes it after the selection with Ctrl+V; undo removes it', async () => {
    const user = userEvent.setup()
    mockEditor(cloneSample())
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTitle(/Page canvas/)
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await user.click(within(tree()).getByRole('button', { name: /^Heading.*Made fresh/ }))
    // The browser's copy and paste events (what Ctrl/Cmd+C and V fire outside text fields).
    const data = new Map<string, string>()
    const clipboardData = { setData: (type: string, value: string) => void data.set(type, value), getData: (type: string) => data.get(type) ?? '' }
    fireEvent.copy(document.activeElement ?? document.body, { clipboardData })
    expect(window.localStorage.getItem('pos.builder.clipboard.o-1')).toContain('"e_heading"')
    expect(data.get('text/plain')).toContain('pos-builder-clipboard')
    fireEvent.paste(document.activeElement ?? document.body, { clipboardData })
    await waitFor(() => expect(rowNames().filter((name) => name === 'Heading: Made fresh every morning')).toHaveLength(2))
    // The copy sits right after the original and is selected.
    const names = rowNames()
    const first = names.indexOf('Heading: Made fresh every morning')
    expect(names[first + 1]).toBe('Heading: Made fresh every morning')
    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(rowNames().filter((name) => name === 'Heading: Made fresh every morning')).toHaveLength(1))
  })

  it('copy style / paste style from the Layers menu', async () => {
    const user = userEvent.setup()
    const content = cloneSample()
    const heading = content.sections[1]!.columns[0]!.elements[0]!
    content.sections[1]!.columns[0]!.elements[0] = { ...heading, style: { base: { color: '#112233' } } }
    const puts = mockEditor(content)
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTitle(/Page canvas/)
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await user.click(within(tree()).getByRole('button', { name: /More actions for Heading: Made fresh/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Copy style' }))
    await user.click(within(tree()).getAllByRole('button', { name: /More actions for Text:/ })[0]!)
    await user.click(await screen.findByRole('menuitem', { name: 'Paste style' }))
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 })
    const saved = puts[puts.length - 1]!.content.sections[1]!.columns[0]!.elements.find((e) => e.type === 'text')!
    expect(saved.style).toEqual({ base: { color: '#112233' } })
  })

  it('shows a global section reference with its panel; Detach makes it a normal section again', async () => {
    const user = userEvent.setup()
    mockEditor(makeGlobal(cloneSample(), 's_story', GID))
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTitle(/Page canvas/)
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const row = await within(tree()).findByRole('treeitem', { name: 'Global section · Our story' })
    await user.click(within(row).getByRole('button', { name: /^Global section/ }))
    const panel = await screen.findByTestId('global-ref-panel')
    expect(within(panel).getByText('Used on 2 pages')).toBeInTheDocument()
    expect(within(panel).getByText(/Also on: About/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Edit global section/ })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: /Detach from global/ }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Detach “Our story”?' })
    await user.click(within(confirm).getByRole('button', { name: 'Detach' }))
    await waitFor(() => expect(within(tree()).queryByRole('treeitem', { name: 'Global section · Our story' })).not.toBeInTheDocument())
    expect(rowNames()).toContain('Heading: Made fresh every morning')
  })

  it('Make global from the Layers menu creates the global, publishes it and puts a reference in the page', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | null = null
    let published = false
    mockEditor(cloneSample(), {
      'POST /storefront/builder/documents': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return ok({ ...globalDetail(), title: String(created.title), content: { schema_version: 1, sections: [created.section] }, global: { usage_count: 0, used_in: [] } })
      },
      [`POST /storefront/builder/documents/${GID}/publish`]: () => {
        published = true
        return ok(globalDetail())
      },
    })
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTitle(/Page canvas/)
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const section = within(tree()).getAllByRole('treeitem').find((r) => r.getAttribute('aria-label')?.startsWith('Section · Heading: Made fresh'))!
    await user.click(within(section).getByRole('button', { name: /More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Make global/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Make this section global' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Our story')
    await user.click(within(dialog).getByRole('button', { name: 'Make global' }))
    await waitFor(() => expect(published).toBe(true))
    expect(created).toMatchObject({ kind: 'global', title: 'Our story', context: 'page', from: 'section', section: { id: 's_story', hidden: false, schedule: null } })
    await within(tree()).findByRole('treeitem', { name: 'Global section · Our story' })
  })

  it('a global’s own document: usage banner, no Templates or Global tab, its one section can’t be deleted', async () => {
    const user = userEvent.setup()
    mockEditor(cloneSample(), { 'GET /storefront/builder/documents/doc-1': ok({ ...globalDetail(), id: 'doc-1' }) })
    renderRoutes(routes, '/storefront/builder/doc-1')
    const banner = await screen.findByTestId('global-usage-banner')
    expect(banner).toHaveTextContent('Used on 2 pages: Home, About.')
    expect(screen.queryByRole('tab', { name: 'Templates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Global' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Global section' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const section = within(tree()).getAllByRole('treeitem')[0]!
    await user.click(within(section).getByRole('button', { name: /More actions/ }))
    expect(screen.queryByRole('menuitem', { name: /Make global/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByText(/always has exactly one section/)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('inserts a global section from the Global tab after the selected section', async () => {
    const user = userEvent.setup()
    mockEditor(cloneSample())
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTitle(/Page canvas/)
    await user.click(screen.getByRole('tab', { name: 'Global' }))
    await user.click(await screen.findByRole('button', { name: 'Insert Our story' }))
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await within(tree()).findByRole('treeitem', { name: 'Global section · Our story' })
    const sections = within(tree()).getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '1').map((r) => r.getAttribute('aria-label'))
    expect(sections[sections.length - 1]).toBe('Global section · Our story')
  })
})
