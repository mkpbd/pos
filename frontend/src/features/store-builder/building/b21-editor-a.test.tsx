import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { envelope, type CanvasMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Section } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from '../test-helpers'

/*
 * B21 in the editor (Editor A): the canvas "What next?" strip under the last section (one click
 * inserts a section at the end, one undo step; More… opens Templates), Ctrl+K "Suggested next",
 * and "Try another layout" from the section's mini toolbar (a click rearranges, undo puts it back).
 */

const VIS = { desktop: true, tablet: true, mobile: true }
const tpl = (id: string, name: string, category: string) => ({ id, scope: 'section', preset: null, category, name, description: null, thumbnail_url: null, allowed_in: ['page', 'cms', 'zone'], source: 'builtin' })
const TEMPLATES = [tpl('neutral-testimonials', 'Customer reviews', 'testimonials'), tpl('neutral-faq-accordion', 'FAQ accordion', 'faq'), tpl('neutral-cta-band', 'Call-to-action band', 'cta'), tpl('neutral-trust-strip', 'Trust badges strip', 'features')]

const reviewsSection = (): Section =>
  ({
    id: 's_newreviews', type: 'section', props: { layout: 'boxed', anchor: null }, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {},
    columns: [{ id: 'c_newreviews', type: 'column', width: { base: 100 }, style: {}, elements: [{ id: 'e_newquote', type: 'quote', props: { text: 'Lovely honey', author: 'Rina', role: '', style: 'card' }, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} }] }],
  }) as unknown as Section

function mockEditor(content: BuilderContent = cloneSample()) {
  const calls = { instantiate: [] as string[] }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(content, 3)),
    'GET /storefront/builder/documents': ok([]),
    'GET /storefront/builder/globals': ok([]),
    'GET /storefront/builder/templates': ok(TEMPLATES),
    'POST /storefront/builder/templates/neutral-testimonials/instantiate': () => {
      calls.instantiate.push('neutral-testimonials')
      return ok({ context: 'page', nodes: [reviewsSection()], imported: { media: 0, banners: 0, banners_reused: 0 } })
    },
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number; content: BuilderContent }
      return ok({ ...detail(body.content, body.revision + 1) })
    },
  })
  return calls
}

// jsdom has no layout: the canvas is drawn at scale 1 and the overlay is 200 px tall.
const RECTS = {
  s_hero: { x: 0, y: 0, w: 1200, h: 40 },
  s_story: { x: 0, y: 40, w: 1200, h: 40 },
  s_features: { x: 0, y: 80, w: 1200, h: 30 },
  s_products: { x: 0, y: 110, w: 1200, h: 30 },
}

async function openEditor() {
  renderRoutes(routes, '/storefront/builder/doc-1')
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  fromCanvas({ type: 'ready' })
  fromCanvas({ type: 'rects', nodes: RECTS, scrollY: 0, height: 2000, viewport: { w: 1366, h: 200 } })
  return { frame, fromCanvas }
}

const sectionNames = () =>
  within(screen.getByRole('tree'))
    .getAllByRole('treeitem')
    .filter((row) => row.getAttribute('aria-level') === '1')
    .map((row) => row.getAttribute('aria-label'))

beforeEach(() => window.localStorage.clear())

describe('B21 editor A: What next? and Try another layout', () => {
  it('the strip under the last section suggests reviews, questions and a call to action; a click adds one at the end (one undo step)', async () => {
    const user = userEvent.setup()
    const calls = mockEditor()
    await openEditor()
    const strip = await screen.findByTestId('next-strip')
    expect(strip).toHaveAccessibleName('What next? Suggested sections')
    expect(within(strip).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Add Customer reviews', 'Add Questions and answers', 'Add Call to action', 'More…'])
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const before = sectionNames().length

    await user.click(within(strip).getByRole('button', { name: /Customer reviews/ }))
    await waitFor(() => expect(calls.instantiate).toEqual(['neutral-testimonials']))
    await waitFor(() => expect(sectionNames()).toHaveLength(before + 1))
    expect(sectionNames().at(-1)).toMatch(/Section/)

    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(sectionNames()).toHaveLength(before))
  })

  it('More… opens the Templates tab', async () => {
    const user = userEvent.setup()
    mockEditor()
    await openEditor()
    await user.click(within(await screen.findByTestId('next-strip')).getByRole('button', { name: 'More…' }))
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Ctrl+K lists "Suggested next" first', async () => {
    const user = userEvent.setup()
    mockEditor()
    await openEditor()
    await screen.findByTestId('next-strip')
    await user.keyboard('{Control>}k{/Control}')
    const box = await screen.findByTestId('command-box')
    const listbox = within(box).getByRole('listbox')
    const groups = within(listbox).getAllByRole('group')
    expect(groups[0]).toHaveAccessibleName('Suggested next')
    expect(within(groups[0]!).getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Customer reviews')]))
  })

  it('an empty page shows "Start your page" with the first sections to add', async () => {
    mockEditor({ schema_version: 1, sections: [] } as BuilderContent)
    await openEditor()
    const card = await screen.findByTestId('next-empty')
    expect(within(card).getByRole('heading', { name: 'Start your page' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Build it for me/ })).toBeInTheDocument()
  })

  it('Try another layout: the section toolbar opens the strip; a click rearranges the section and undo puts it back', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'click', id: 's_story', ctrl: false, shift: false, meta: false })
    const toolbar = await screen.findByTestId('mini-toolbar')
    await user.click(within(toolbar).getByRole('button', { name: 'Try another layout' }))
    const panel = await screen.findByTestId('layout-variants')
    expect(panel).toHaveAccessibleName(/Try another layout/)
    const right = within(panel).getByRole('button', { name: /Picture on the right/ })
    const left = within(panel).getByRole('button', { name: /Picture on the left/ })
    expect(right).toHaveAttribute('aria-pressed', 'true')
    // The story section has a background of its own: no "behind".
    expect(within(panel).queryByRole('button', { name: /behind/ })).not.toBeInTheDocument()

    await user.click(left)
    await waitFor(() => expect(within(screen.getByTestId('layout-variants')).getByRole('button', { name: /Picture on the left/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(within(screen.getByTestId('layout-variants')).getByRole('status')).toHaveTextContent('Picture on the left. Undo puts the old layout back.')

    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(within(screen.getByTestId('layout-variants')).getByRole('button', { name: /Picture on the right/ })).toHaveAttribute('aria-pressed', 'true'))

    await user.click(within(screen.getByTestId('layout-variants')).getByRole('button', { name: 'Shuffle' }))
    await waitFor(() => expect(within(screen.getByTestId('layout-variants')).getByRole('button', { name: /Picture above the text/ })).toHaveAttribute('aria-pressed', 'true'))
    await user.click(within(screen.getByTestId('layout-variants')).getByRole('button', { name: 'Close Try another layout' }))
    expect(screen.queryByTestId('layout-variants')).not.toBeInTheDocument()
  })

  it('the inspector header of a section offers Try another layout too', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'click', id: 's_products', ctrl: false, shift: false, meta: false })
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' })
    await user.click(await within(inspector).findByRole('button', { name: 'Try another layout' }))
    const panel = await screen.findByTestId('layout-variants')
    const buttons = within(within(panel).getByRole('list', { name: 'Layouts' })).getAllByRole('button')
    expect(buttons).toHaveLength(4)
    for (const [i, name] of ['Grid, 3 per row', 'Grid, 4 per row', 'Grid, 5 per row', 'Sliding row'].entries()) expect(buttons[i]).toHaveAccessibleName(new RegExp(`^${name}`))
  })
})
