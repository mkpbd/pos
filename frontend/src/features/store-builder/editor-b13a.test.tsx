import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import type { Audience } from '@/storefront/builder/audience/types'
import { envelope, type CanvasMessage, type ParentMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail, seedFullMode } from './test-helpers'

/* B13 in the editor (editor A): "Who sees this" badges on the canvas and in Layers, and "Preview as". */

const ONLY_PHONES: Audience = { match: 'all', rules: [{ kind: 'device', in: ['mobile'] }], otherwise: 'hide' }
const ONLY_NEW: Audience = { match: 'all', rules: [{ kind: 'visitor', is: 'new' }], otherwise: 'hide' }

function sample(): BuilderContent {
  const content = cloneSample()
  const section = content.sections.find((s) => s.columns.some((c) => c.elements.some((e) => e.id === 'e_heading')))!
  for (const column of section.columns) for (const element of column.elements) if (element.id === 'e_heading') element.audience = ONLY_PHONES
  for (const column of section.columns) for (const element of column.elements) if (element.id === 'e_button') element.audience = ONLY_NEW
  return content
}

function mockEditor() {
  const puts: { revision: number; content: BuilderContent }[] = []
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(sample(), 3)),
    'GET /storefront/builder/documents': ok([{ ...detail(), content: undefined }]),
    'GET /storefront/builder/globals': ok([]),
    'GET /storefront/builder/templates': ok([]),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'GET /geography/districts': ok([{ id: 13, division_id: 3, name: 'Dhaka' }]),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as (typeof puts)[number]
      puts.push(body)
      return ok({ ...detail(body.content, body.revision + 1) })
    },
  })
  return puts
}

async function openEditor() {
  renderRoutes(routes, '/storefront/builder/doc-1')
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  const posted: ParentMessage[] = []
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((data: unknown) => void posted.push(data as ParentMessage))
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  fromCanvas({ type: 'ready' })
  fromCanvas({
    type: 'rects',
    nodes: { e_heading: { x: 20, y: 320, w: 500, h: 40 }, e_button: { x: 20, y: 460, w: 200, h: 40 }, e_text: { x: 20, y: 370, w: 500, h: 80 } },
    scrollY: 0,
    height: 2000,
    viewport: { w: 1366, h: 900 },
  })
  const previews = () => posted.filter((m): m is Extract<ParentMessage, { type: 'preview-as' }> => m.type === 'preview-as')
  return { fromCanvas, posted, previews }
}

// B21: these tests use full mode (Preview as, the Advanced tab).
beforeEach(() => seedFullMode())

describe('store builder editor (B13, editor A)', () => {
  it('draws "Who sees this" badges on the canvas and in Layers', async () => {
    const user = userEvent.setup()
    mockEditor()
    await openEditor()
    expect(await screen.findByTestId('audience-badge-e_heading')).toHaveTextContent('Phone')
    expect(screen.getByTestId('audience-badge-e_button')).toHaveTextContent('New visitors')
    expect(screen.queryByTestId('audience-badge-e_text')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const badge = await screen.findByTestId('layer-audience-e_heading')
    expect(badge).toHaveAccessibleName('Who sees this: Only on phones')
  })

  it('"Preview as" fades what the shopper would not see; "Show everything" goes back', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas, previews } = await openEditor()
    // The default needs no message: a new canvas page shows everything.
    expect(previews()).toEqual([])
    expect(screen.getByTestId('preview-as-button')).toHaveAccessibleName('Preview as: show everything')

    await user.click(screen.getByTestId('preview-as-button'))
    const panel = await screen.findByTestId('preview-as-panel')
    expect(within(panel).getByText('2 parts of this page have a “Who sees this” rule.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('radio', { name: /A shopper like this/ }))
    await waitFor(() => expect(previews().at(-1)?.context).toMatchObject({ visitor: 'new', account: 'guest', device: 'desktop', cart_subtotal: '0.00', language: 'en', district_id: null, campaign: null }))
    // On a computer the phone-only heading is faded; the new-visitor button shows.
    expect(within(panel).getByTestId('preview-as-result')).toHaveTextContent('1 part is faded')
    expect(screen.getByTestId('audience-badge-e_heading')).toHaveAttribute('data-out', 'true')
    expect(screen.getByTestId('audience-badge-e_heading')).toHaveTextContent('Hidden for this shopper')
    expect(screen.getByTestId('audience-badge-e_button')).not.toHaveAttribute('data-out')

    await user.click(within(within(panel).getByRole('radiogroup', { name: 'Visitor' })).getByRole('radio', { name: 'Returning' }))
    await waitFor(() => expect(previews().at(-1)?.context).toMatchObject({ visitor: 'returning' }))
    expect(screen.getByTestId('audience-badge-e_button')).toHaveAttribute('data-out', 'true')

    // Device follows the canvas width.
    await user.click(within(within(panel).getByRole('radiogroup', { name: 'Device' })).getByRole('radio', { name: 'Phone' }))
    await waitFor(() => expect(previews().at(-1)?.context).toMatchObject({ device: 'mobile' }))
    expect(screen.getByTestId('canvas-area')).toHaveAttribute('data-device', 'mobile')

    await user.type(within(panel).getByLabelText('Cart value'), '2,500')
    await waitFor(() => expect(previews().at(-1)?.context).toMatchObject({ cart_subtotal: '2500.00' }))

    // A new canvas page (reload) gets the preview again.
    const before = previews().length
    fromCanvas({ type: 'ready' })
    await waitFor(() => expect(previews().length).toBe(before + 1))

    await user.click(within(panel).getByRole('radio', { name: /Show everything/ }))
    await waitFor(() => expect(previews().at(-1)?.context).toBeNull())
    expect(screen.getByTestId('audience-badge-e_heading')).not.toHaveAttribute('data-out')
  })

  it('"Who sees this" in the Advanced tab saves the audience with the draft', async () => {
    const user = userEvent.setup()
    const puts = mockEditor()
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'click', id: 'e_text' })
    await user.click(await screen.findByRole('tab', { name: 'Advanced' }))
    await user.click(screen.getByTestId('audience-add-rule'))
    await user.click(await screen.findByRole('menuitem', { name: 'Signed in or guest' }))
    expect(await screen.findByTestId('audience-badge-e_text')).toHaveTextContent('Signed in')
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 5000 })
    const saved = puts.at(-1)!.content.sections.flatMap((s) => s.columns.flatMap((c) => c.elements)).find((e) => e.id === 'e_text')
    expect(saved?.audience).toEqual({ match: 'all', rules: [{ kind: 'account', is: 'signed_in' }], otherwise: 'hide' })
  })
})
