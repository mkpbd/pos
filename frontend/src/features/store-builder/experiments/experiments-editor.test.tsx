import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { envelope, type CanvasMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Experiment } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail } from '../test-helpers'
import { createTest, experimentsOf, removeTest } from './experiments-model'

/* B13 editor B: "Test a different version", the A/B tests panel, the canvas switch, Layers grouping. */

type Backend = { puts: { revision: number; content: BuilderContent }[]; actions: { path: string; body: Record<string, unknown> }[] }

const ARM = (visitors: number, goal: number) => ({ visitors, views: visitors, goal_count: goal, rate: '0', orders: goal, revenue: '15000.00', add_to_carts: 0, clicks: 0, section_views: visitors })

function mockEditor(options: { content?: BuilderContent; permissions?: string[] } = {}): Backend {
  const b: Backend = { puts: [], actions: [] }
  let current = options.content ?? cloneSample()
  let revision = 3
  const exp = `/storefront/builder/documents/doc-1/experiments/${experimentsOf(current)[0]?.id ?? 'none'}`
  const setStatus = (status: Experiment['status']) => {
    current = { ...current, experiments: experimentsOf(current).map((e) => ({ ...e, status, started_at: status === 'running' ? '2026-11-19T04:00:00Z' : e.started_at })) }
  }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: options.permissions ?? ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(current, revision)),
    'GET /storefront/builder/documents': ok([{ ...detail(), content: undefined }]),
    'GET /storefront/builder/globals': ok([]),
    'GET /storefront/builder/templates': ok([]),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as Backend['puts'][number]
      b.puts.push(body)
      current = body.content
      revision = body.revision + 1
      return ok(detail(current, revision))
    },
    [`POST ${exp}/start`]: (init, url) => {
      b.actions.push({ path: url.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      setStatus('running')
      revision += 1
      return ok(detail(current, revision))
    },
    [`POST ${exp}/keep`]: (init, url) => {
      const body = JSON.parse(String(init.body)) as { arm: 'A' | 'B'; revision: number }
      b.actions.push({ path: url.pathname, body })
      const id = experimentsOf(current)[0]!.id
      const kept = removeTest(current, id, body.arm)
      current = { ...kept, experiments: experimentsOf(current).map((e) => ({ ...e, status: 'ended' as const, winner: body.arm, ended_at: '2026-11-20T04:00:00Z' })) }
      revision += 1
      return ok(detail(current, revision))
    },
    [`GET ${exp}/results`]: ok({
      goal: 'orders',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
      arms: { A: ARM(1200, 40), B: ARM(1180, 48) },
      lift: '23.40',
      probability_b_beats_a: '96.12',
      confidence: 'high',
      enough_data: true,
      recommendation: 'keep_b',
      daily: [
        { day: '2026-11-17', A: { visitors: 600, goal_count: 18 }, B: { visitors: 590, goal_count: 22 } },
        { day: '2026-11-18', A: { visitors: 600, goal_count: 22 }, B: { visitors: 590, goal_count: 26 } },
      ],
    }),
  })
  return b
}

const RECTS = {
  s_hero: { x: 0, y: 0, w: 1200, h: 300 },
  s_story: { x: 0, y: 300, w: 1200, h: 400 },
  s_features: { x: 0, y: 700, w: 1200, h: 300 },
}

async function openEditor() {
  renderRoutes(routes, '/storefront/builder/doc-1')
  const frame = (await screen.findByTitle(/Page canvas/)) as HTMLIFrameElement
  const sent: { type: string; sections?: { id: string }[] }[] = []
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((data: unknown) => {
    const message = (data as { message?: { type: string } }).message ?? (data as { type: string })
    sent.push(message as (typeof sent)[number])
  })
  const fromCanvas = (data: CanvasMessage) =>
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: window.location.origin, source: frame.contentWindow })))
  fromCanvas({ type: 'ready' })
  fromCanvas({ type: 'rects', nodes: RECTS, scrollY: 0, height: 2000, viewport: { w: 1366, h: 900 } })
  const rendered = () => [...sent].reverse().find((m) => m.type === 'render')?.sections?.map((s) => s.id) ?? []
  return { fromCanvas, rendered }
}

const toolbar = () => screen.getByRole('banner', { name: 'Editor toolbar' })

describe('A/B tests in the editor (B13, editor B)', () => {
  it('"Test a different version" adds version B and a draft test; the canvas shows one version; Layers groups them; one undo takes it back', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas, rendered } = await openEditor()
    fromCanvas({ type: 'click', id: 's_story', ctrl: false, shift: false, meta: false })
    const mini = await screen.findByTestId('mini-toolbar')
    await user.click(within(mini).getByRole('button', { name: /More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Test a different version/ }))

    const panel = await screen.findByTestId('ab-panel')
    const card = within(panel).getByRole('article')
    expect(within(card).getByTestId('ab-status')).toHaveTextContent('Not started')
    expect(within(card).getByRole('textbox', { name: 'Name' })).toHaveValue('Heading test')
    expect(within(toolbar()).getByTestId('ab-tests-count')).toHaveTextContent('1')

    // Version B (the copy, selected) is on the canvas; version A is left out.
    await waitFor(() => expect(rendered()).not.toContain('s_story'))
    const copyId = rendered().find((id) => !['s_hero', 's_features', 's_products', 's_hidden'].includes(id))!
    expect(copyId).toBeTruthy()

    // The switch on the canvas: "Showing version A | B".
    // jsdom's canvas area is 200 px high: the section sits in view.
    fromCanvas({ type: 'rects', nodes: { ...RECTS, [copyId]: { x: 0, y: 20, w: 1200, h: 150 } }, scrollY: 0, height: 2000, viewport: { w: 1366, h: 900 } })
    const switcher = await screen.findByRole('group', { name: /A\/B test .*version shown on the canvas/ })
    expect(within(switcher).getByRole('button', { name: 'Version B' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(switcher).getByRole('button', { name: 'Version A' }))
    await waitFor(() => expect(rendered()).toContain('s_story'))
    expect(rendered()).not.toContain(copyId)

    // Split: 10–90 in steps of 5, said in words.
    const split = within(card).getByRole('slider', { name: 'Shoppers who see version B' })
    expect(split).toHaveAttribute('aria-valuetext', '50 % see version B, 50 % see version A')

    // Layers: a heading line for the test and a version tag on each section.
    await user.click(within(panel).getByRole('button', { name: 'Close A/B tests' }))
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    const groups = await screen.findAllByTestId(/^ab-group-/)
    expect(groups).toHaveLength(1)
    expect(screen.getByTestId('arm-tag-s_story')).toHaveTextContent('Version A')
    expect(screen.getByTestId(`arm-tag-${copyId}`)).toHaveTextContent(/Version B.*not on the canvas/)

    // One undo: the copy and the test are gone.
    await user.click(within(toolbar()).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.queryByTestId(/^ab-group-/)).not.toBeInTheDocument())
    expect(screen.queryByTestId(`layer-${copyId}`)).not.toBeInTheDocument()
    expect(within(toolbar()).queryByTestId('ab-tests-count')).not.toBeInTheDocument()
  })

  it('starts a test through the server (saved first, with the revision), shows live results in words and keeps the winner', async () => {
    const user = userEvent.setup()
    const content = createTest(cloneSample(), 's_story', 'Story test')!.content
    const b = mockEditor({ content })
    await openEditor()
    await user.click(within(toolbar()).getByTestId('ab-tests-button'))
    const panel = await screen.findByTestId('ab-panel')
    // Rename (a draft edit, saved by autosave), then start.
    const name = within(panel).getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Bigger photo')
    await user.click(within(panel).getByTestId('ab-start'))
    await waitFor(() => expect(b.actions).toHaveLength(1))
    expect(b.puts.at(-1)!.content.experiments?.[0]?.name).toBe('Bigger photo')
    expect(b.actions[0]!.path).toMatch(/\/experiments\/ab_[a-z0-9]+\/start$/)
    expect(b.actions[0]!.body).toEqual({ revision: b.puts.length + 3 })
    await waitFor(() => expect(within(panel).getByTestId('ab-status')).toHaveTextContent('Running'))
    expect(within(panel).getByTestId('ab-status-note')).toHaveTextContent('Starts when you publish the page.')
    // Locked while running.
    expect(within(panel).getByRole('slider', { name: 'Shoppers who see version B' })).toBeDisabled()

    expect(await within(panel).findByTestId('ab-headline')).toHaveTextContent('Version B gets 23 % more orders — 96 % sure version B is better.')
    expect(within(panel).getByTestId('ab-progress')).toHaveAttribute('aria-valuenow', '100')
    expect(within(panel).getByTestId('ab-recommendation')).toHaveTextContent('Our suggestion: keep version B.')
    expect(within(panel).getByTestId('ab-chart')).toBeInTheDocument()
    expect(within(panel).getByRole('table', { name: 'Results by version' })).toBeInTheDocument()

    await user.click(within(panel).getByTestId('ab-keep-B'))
    const confirm = await screen.findByRole('alertdialog', { name: 'Keep version B?' })
    await user.click(within(confirm).getByRole('button', { name: 'Keep version B' }))
    await waitFor(() => expect(b.actions).toHaveLength(2))
    expect(b.actions[1]!.path).toMatch(/\/keep$/)
    expect(b.actions[1]!.body).toMatchObject({ arm: 'B' })
    await waitFor(() => expect(within(panel).getByTestId('ab-status')).toHaveTextContent('Finished'))
    expect(within(panel).getByTestId('ab-status-note')).toHaveTextContent('You kept version B.')
  })

  it('without the publish permission, Start says why and nothing is sent', async () => {
    const user = userEvent.setup()
    const content = createTest(cloneSample(), 's_story', 'Story test')!.content
    const b = mockEditor({ content, permissions: ['storefront.view', 'storefront.manage'] })
    await openEditor()
    await user.click(within(toolbar()).getByTestId('ab-tests-button'))
    const panel = await screen.findByTestId('ab-panel')
    const start = within(panel).getByTestId('ab-start')
    expect(start).toHaveAttribute('aria-disabled', 'true')
    expect(within(panel).getByText(/Only people who may publish/)).toBeInTheDocument()
    await user.click(start)
    expect(b.actions).toHaveLength(0)
  })

  it('the empty panel offers to test the selected section', async () => {
    const user = userEvent.setup()
    mockEditor()
    const { fromCanvas } = await openEditor()
    fromCanvas({ type: 'click', id: 's_features', ctrl: false, shift: false, meta: false })
    await user.click(within(toolbar()).getByTestId('ab-tests-button'))
    const empty = await screen.findByTestId('ab-empty')
    await user.click(within(empty).getByRole('button', { name: 'Test the selected section' }))
    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(within(toolbar()).getByTestId('ab-tests-count')).toHaveTextContent('1')
  })
})
