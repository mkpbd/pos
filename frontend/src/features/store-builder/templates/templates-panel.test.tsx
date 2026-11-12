import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { Section } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from '../test-helpers'
import type { BuilderTemplate } from './api'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess }) }
})

beforeEach(() => toastSuccess.mockReset())

const template = (over: Partial<BuilderTemplate>): BuilderTemplate => ({
  id: 't', scope: 'section', preset: null, category: 'hero', name: 'Template', description: null, thumbnail_url: null, allowed_in: ['page', 'cms', 'zone'], source: 'builtin', ...over,
})

const LIBRARY: BuilderTemplate[] = [
  template({ id: 'vegan-hero', preset: 'vegan', category: 'hero', name: 'Fresh hero', description: 'A big banner with a call to action', thumbnail_url: '/builder-templates/vegan-hero.webp' }),
  template({ id: 'classic-grid', preset: 'classic', category: 'products', name: 'Best sellers row' }),
  template({ id: 'cta-band', category: 'cta', name: 'Call-to-action band' }),
  template({ id: 'header-bar', category: 'header', name: 'Logo and menu', allowed_in: ['header'] }),
  template({ id: 'about-page', scope: 'page', category: 'pages', name: 'About us', allowed_in: ['page', 'cms'] }),
  template({ id: 'site-vegan', scope: 'site', preset: 'vegan', category: null, name: 'Vegan Market', allowed_in: ['page'] }),
  template({ id: 'mine-1', source: 'mine', category: 'promo', name: 'Eid offer banner', allowed_in: ['page'] }),
]

const visible = { desktop: true, tablet: true, mobile: true }
const common = { style: {}, visibility: visible, hidden: false, schedule: null, translations: {} }
/** What instantiate returns: fresh ids (one colliding with the sample on purpose). */
const instantiated = (): Section[] => [
  {
    id: 's_hero', type: 'section', props: { layout: 'boxed', anchor: null }, ...common,
    columns: [{ id: 'c_t1', type: 'column', width: { base: 100 }, style: {}, elements: [{ id: 'e_t1', type: 'heading', props: { text: 'Fresh from the farm', level: 2, link: null }, ...common } as never] }],
  },
  {
    id: 's_t2', type: 'section', props: { layout: 'boxed', anchor: null }, ...common,
    columns: [{ id: 'c_t2', type: 'column', width: { base: 100 }, style: {}, elements: [{ id: 'e_t2', type: 'heading', props: { text: 'Order by noon', level: 2, link: null }, ...common } as never] }],
  },
]

const themeDraft = (preset: string) => ({
  settings: { ...bootstrapFixture().theme, logo_media_id: null, favicon_media_id: null, palette: [], preset },
  draft_revision: 1, has_unpublished_changes: false, published: null, preview_url: null, custom_css: null, has_custom_css: false,
})

type Calls = { instantiate: { id: string; body: unknown }[]; saved: unknown[]; deleted: string[]; puts: unknown[] }

function mockEditor(options: { kind?: 'page' | 'header'; preset?: string; templates?: () => ReturnType<typeof ok> } = {}) {
  const calls: Calls = { instantiate: [], saved: [], deleted: [], puts: [] }
  const doc = options.kind === 'header' ? { ...detail({ schema_version: 1, sections: [] }, 1), kind: 'header' as const, key: 'header', title: 'Header', path: null, preview_url: null } : detail(cloneSample(), 3)
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(doc),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/theme/draft': ok(themeDraft(options.preset ?? 'vegan')),
    'GET /storefront/builder/templates': options.templates ?? (() => ok(LIBRARY)),
    'POST /storefront/builder/templates/vegan-hero/instantiate': (init) => {
      calls.instantiate.push({ id: 'vegan-hero', body: JSON.parse(String(init.body)) })
      return ok({ template: { id: 'vegan-hero', name: 'Fresh hero', scope: 'section', source: 'builtin' }, context: 'page', nodes: instantiated(), imported: { media: 2, banners: 0, banners_reused: 0 } })
    },
    'POST /storefront/builder/templates': (init) => {
      const body = JSON.parse(String(init.body)) as { name: string }
      calls.saved.push(body)
      return body.name === 'Too many' ? fail(422, 'TEMPLATE_LIMIT_REACHED', 'Limit reached.') : { status: 201, ...ok(template({ id: 'mine-2', source: 'mine', name: body.name })) }
    },
    'DELETE /storefront/builder/templates/mine-1': () => {
      calls.deleted.push('mine-1')
      return { status: 204 }
    },
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number; content: unknown }
      calls.puts.push(body)
      return ok(detail(cloneSample(), body.revision + 1))
    },
  })
  return calls
}

async function openTemplates(user: ReturnType<typeof userEvent.setup>) {
  renderRoutes(routes, '/storefront/builder/doc-1')
  await screen.findByTestId('store-builder-editor')
  await user.click(screen.getByRole('tab', { name: 'Templates' }))
  return screen.findByTestId('templates-panel')
}

const cardNames = (panel: HTMLElement) => within(panel).queryAllByRole('button', { name: /^Insert / }).map((b) => b.getAttribute('aria-label')!.slice('Insert '.length))

describe('store builder: Templates tab (B5)', () => {
  it('shows only the section and page templates allowed on this document, with a thumbnail or a placeholder', async () => {
    const user = userEvent.setup()
    mockEditor()
    const panel = await openTemplates(user)
    await waitFor(() => expect(cardNames(panel)).toEqual(['Fresh hero', 'Best sellers row', 'Call-to-action band', 'Eid offer banner', 'About us']))
    // A header template and the site templates are not offered on a page.
    expect(within(panel).queryByText('Logo and menu')).toBeNull()
    expect(within(panel).queryByText('Vegan Market')).toBeNull()
    expect(within(panel).getByRole('region', { name: 'Page templates' })).toHaveTextContent('About us')
    expect(screen.getByTestId('template-vegan-hero').querySelector('img')).toHaveAttribute('src', '/builder-templates/vegan-hero.webp')
    expect(within(screen.getByTestId('template-cta-band')).getByTestId('template-placeholder')).toHaveTextContent('Call-to-action band')
  })

  it('filters by this theme’s look, Mine, category and search', async () => {
    const user = userEvent.setup()
    mockEditor({ preset: 'vegan' })
    const panel = await openTemplates(user)
    await waitFor(() => expect(cardNames(panel)).toHaveLength(5))
    const filters = within(panel).getByRole('group', { name: 'Show templates' })

    await user.click(within(filters).getByRole('button', { name: 'Vegan look' }))
    expect(cardNames(panel)).toEqual(['Fresh hero'])
    await user.click(within(filters).getByRole('button', { name: 'Mine' }))
    expect(cardNames(panel)).toEqual(['Eid offer banner'])
    expect(within(panel).getByRole('button', { name: 'Delete template Eid offer banner' })).toBeInTheDocument()

    await user.click(within(filters).getByRole('button', { name: 'All' }))
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Category' }), 'products')
    expect(cardNames(panel)).toEqual(['Best sellers row'])
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Category' }), '')
    await user.type(within(panel).getByRole('searchbox', { name: 'Search templates' }), 'call to')
    expect(cardNames(panel)).toEqual(['Fresh hero'])
    await user.clear(within(panel).getByRole('searchbox', { name: 'Search templates' }))
    await user.type(within(panel).getByRole('searchbox', { name: 'Search templates' }), 'zzz')
    expect(within(panel).getByText('No template matches “zzz”.')).toBeInTheDocument()
  })

  it('has no look filter when the theme’s preset has no templates; a header gets header templates', async () => {
    const user = userEvent.setup()
    mockEditor({ preset: 'default', kind: 'header' })
    const panel = await openTemplates(user)
    await waitFor(() => expect(cardNames(panel)).toEqual(['Logo and menu']))
    expect(within(panel).queryByRole('button', { name: /look$/ })).toBeNull()
  })

  it('inserts a template after the selected section in one undo step and selects it', async () => {
    const user = userEvent.setup()
    const calls = mockEditor()
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTestId('store-builder-editor')
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const before = within(screen.getByRole('tree')).getAllByRole('treeitem').filter((row) => row.getAttribute('aria-level') === '1').map((row) => row.getAttribute('aria-label'))
    await user.click(within(screen.getByRole('tree')).getByRole('button', { name: /^Heading.*Made fresh/ }))

    await user.click(screen.getByRole('tab', { name: 'Templates' }))
    await user.click(await screen.findByRole('button', { name: 'Insert Fresh hero' }))
    await waitFor(() => expect(calls.instantiate).toEqual([{ id: 'vegan-hero', body: { context: 'page' } }]))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('“Fresh hero” added. 2 images were added to your media library.'))

    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const sections = () => within(screen.getByRole('tree')).getAllByRole('treeitem').filter((row) => row.getAttribute('aria-level') === '1')
    const labels = sections().map((row) => row.getAttribute('aria-label'))
    expect(labels).toHaveLength(before.length + 2)
    const at = labels.indexOf('Section · Heading: Fresh from the farm')
    expect(at).toBeGreaterThan(0)
    expect(labels[at + 1]).toBe('Section · Heading: Order by noon')
    expect(sections()[at]).toHaveAttribute('aria-selected', 'true')

    // One undo removes both sections.
    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(sections().map((row) => row.getAttribute('aria-label'))).toEqual(before))
  })

  it('shows an error with a retry when templates can’t be loaded', async () => {
    const user = userEvent.setup()
    let failing = true
    mockEditor({ templates: () => (failing ? fail(500, 'SERVER_ERROR', 'Server unavailable.') : ok(LIBRARY)) })
    const panel = await openTemplates(user)
    expect(await within(panel).findByText('Templates couldn’t be loaded')).toBeInTheDocument()
    failing = false
    await user.click(within(panel).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(cardNames(panel)).toHaveLength(5))
  })

  it('saves a section as a template from Layers and deletes an own template after confirming', async () => {
    const user = userEvent.setup()
    const calls = mockEditor()
    renderRoutes(routes, '/storefront/builder/doc-1')
    await screen.findByTestId('store-builder-editor')
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const tree = screen.getByRole('tree')
    const first = within(tree).getAllByRole('treeitem').find((row) => row.getAttribute('aria-level') === '1')!
    await user.click(within(first).getByRole('button', { name: /^More actions for/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Save as template' }))

    const dialog = await screen.findByRole('dialog', { name: 'Save as template' })
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }))
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name'), 'Too many')
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You have 100 saved templates')

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Our hero')
    await user.type(within(dialog).getByLabelText('Description (optional)'), 'For the front page')
    await user.click(within(dialog).getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(calls.saved).toHaveLength(2))
    const sample = cloneSample()
    expect(calls.saved[1]).toEqual({ name: 'Our hero', description: 'For the front page', scope: 'section', context: 'page', section: sample.sections[0] })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save as template' })).toBeNull())

    await user.click(screen.getByRole('tab', { name: 'Templates' }))
    await user.click(await screen.findByRole('button', { name: 'Delete template Eid offer banner' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the template “Eid offer banner”?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete template' }))
    await waitFor(() => expect(calls.deleted).toEqual(['mine-1']))
  })
})
