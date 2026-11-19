import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok } from '@/test/utils'
import { campaignTouch, DISTRICT_KEY, rememberDistrict, rememberedDistrict, resetVisitorKind, storeDayTime, VISITOR_KEY, VISITOR_SESSION_KEY, visitorKind } from './builder/audience/context'
import { evaluateAudience, matchesTime, readAudience } from './builder/audience/evaluate'
import {
  abStorageKey,
  armFor,
  cleanArms,
  defaultArm,
  drawArm,
  planArms,
  readExperiments,
  rememberReportedArms,
  reportedArmsOf,
  resetMemoryArms,
  resetReportedArms,
  sectionInArm,
} from './builder/audience/experiments'
import { audienceKinds, audienceVerdicts } from './builder/audience/nodes'
import type { AudienceContext, AudienceRule } from './builder/audience/types'
import { CanvasApp } from './builder/canvas/canvas-app'
import { envelope, readParentMessage, type ParentMessage } from './builder/canvas/protocol'
import { createCanvasQueryClient } from './builder/canvas/query-client'
import { PageRenderer } from './builder/page-renderer'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderDocument, BuilderPage, Section } from './builder/types'
import { builderAttributionAt, readBuilderAttribution, rememberBuilderClick } from './insights/builder-attribution'
import { createPageCollector } from './insights/collector'
import type { InsightsBeacon } from './insights/types'
import { ATTRIBUTION_KEY } from './landing/attribution'
import { bootstrapFixture, cartFixture } from './test-fixtures'

/*
 * B13 storefront: the audience rule engine (pure), the browser's side of the context (visitor
 * flag, district, campaign, store time), no flash of content meant for someone else, A/B arm
 * assignment (sticky, by split; DNT / GPC → A and nothing reported), arms on beacons and order
 * attribution, and the canvas's "Preview as".
 */

const DOC = '01a1c9d9-0000-7000-8000-0000000000d1'

const BASE: AudienceContext = {
  visitor: 'new',
  account: 'guest',
  device: 'desktop',
  district_id: null,
  campaign: null,
  cart_subtotal: '0.00',
  day: 'mon',
  time: '12:00',
  language: 'en',
}

const ctx = (overrides: Partial<AudienceContext> = {}): AudienceContext => ({ ...BASE, ...overrides })
const one = (rule: AudienceRule | Record<string, unknown>, match: 'all' | 'any' = 'all') => ({ match, otherwise: 'hide', rules: [rule] })

function setPrivacy({ dnt, gpc }: { dnt?: string | null; gpc?: boolean }) {
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => dnt ?? null })
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => gpc })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  resetVisitorKind()
  resetMemoryArms()
  resetReportedArms()
  setPrivacy({})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ============================================================================================= */

describe('B13 audience rules', () => {
  it('shows a node without an audience (or with no well-formed rule) to everyone', () => {
    expect(evaluateAudience(null, BASE)).toBe(true)
    expect(evaluateAudience(undefined, BASE)).toBe(true)
    expect(evaluateAudience({ match: 'all', rules: [] }, BASE)).toBe(true)
    expect(evaluateAudience({ match: 'all', rules: [{ kind: 'weather', is: 'sunny' }, { kind: 'visitor', is: 'old' }] }, BASE)).toBe(true)
    expect(readAudience('nope')).toBeNull()
  })

  it('reads at most six rules and always hides otherwise', () => {
    const rules = Array.from({ length: 8 }, () => ({ kind: 'language', in: ['en'] }))
    expect(readAudience({ match: 'any', rules, otherwise: 'show' })).toMatchObject({ match: 'any', otherwise: 'hide', rules: expect.any(Array) })
    expect(readAudience({ match: 'any', rules })!.rules).toHaveLength(6)
    expect(readAudience({ match: 'weird', rules })!.match).toBe('all')
  })

  it('visitor, account, device and language', () => {
    expect(evaluateAudience(one({ kind: 'visitor', is: 'new' }), ctx())).toBe(true)
    expect(evaluateAudience(one({ kind: 'visitor', is: 'new' }), ctx({ visitor: 'returning' }))).toBe(false)
    expect(evaluateAudience(one({ kind: 'account', is: 'signed_in' }), ctx())).toBe(false)
    expect(evaluateAudience(one({ kind: 'account', is: 'signed_in' }), ctx({ account: 'signed_in' }))).toBe(true)
    expect(evaluateAudience(one({ kind: 'device', in: ['mobile', 'tablet'] }), ctx())).toBe(false)
    expect(evaluateAudience(one({ kind: 'device', in: ['mobile', 'tablet'] }), ctx({ device: 'mobile' }))).toBe(true)
    expect(evaluateAudience(one({ kind: 'language', in: ['bn'] }), ctx())).toBe(false)
    expect(evaluateAudience(one({ kind: 'language', in: ['bn'] }), ctx({ language: 'bn' }))).toBe(true)
  })

  it('district ids are integers on the wire and strings in storage', () => {
    const rule = one({ kind: 'district', in: [1, 47] })
    expect(evaluateAudience(rule, ctx())).toBe(false)
    expect(evaluateAudience(rule, ctx({ district_id: '47' }))).toBe(true)
    expect(evaluateAudience(rule, ctx({ district_id: 47 }))).toBe(true)
    expect(evaluateAudience(rule, ctx({ district_id: '4' }))).toBe(false)
  })

  it('campaign: utm values, or a campaign id through audience_campaigns (utm_campaign or a short link); an unknown id never matches', () => {
    const campaigns = { 'c0a80001-0000-7000-8000-000000000001': { utm_campaign: 'eid-2026', short_links: ['eid-fb'] } }
    const byId = one({ kind: 'campaign', in: ['c0a80001-0000-7000-8000-000000000001'], utm_source: [], utm_campaign: [] })
    const touch = (values: Partial<NonNullable<AudienceContext['campaign']>>) => ctx({ campaign: { id: null, utm_source: null, utm_campaign: null, short_link: null, ...values } })
    expect(evaluateAudience(byId, ctx(), { campaigns })).toBe(false)
    expect(evaluateAudience(byId, touch({ utm_campaign: 'eid-2026' }), { campaigns })).toBe(true)
    expect(evaluateAudience(byId, touch({ utm_campaign: 'EID-2026' }), { campaigns })).toBe(true)
    expect(evaluateAudience(byId, touch({ short_link: 'eid-fb' }), { campaigns })).toBe(true)
    expect(evaluateAudience(byId, touch({ utm_campaign: 'puja' }), { campaigns })).toBe(false)
    expect(evaluateAudience(byId, touch({ utm_campaign: 'eid-2026' }), { campaigns: {} })).toBe(false)
    // The editor's preview names the campaign itself.
    expect(evaluateAudience(byId, touch({ id: 'c0a80001-0000-7000-8000-000000000001' }))).toBe(true)
    const byUtm = one({ kind: 'campaign', in: [], utm_source: ['facebook'], utm_campaign: ['puja'] })
    expect(evaluateAudience(byUtm, touch({ utm_source: 'Facebook' }))).toBe(true)
    expect(evaluateAudience(byUtm, touch({ utm_campaign: 'puja' }))).toBe(true)
    expect(evaluateAudience(byUtm, touch({ utm_source: 'google' }))).toBe(false)
  })

  it('cart subtotal bounds are inclusive NUMERIC strings; null = open', () => {
    const over = one({ kind: 'cart', min: '1500.00', max: null })
    expect(evaluateAudience(over, ctx({ cart_subtotal: '1499.99' }))).toBe(false)
    expect(evaluateAudience(over, ctx({ cart_subtotal: '1500' }))).toBe(true)
    expect(evaluateAudience(over, ctx({ cart_subtotal: '12000.50' }))).toBe(true)
    const between = one({ kind: 'cart', min: '500', max: '1000.00' })
    expect(evaluateAudience(between, ctx({ cart_subtotal: '1000.00' }))).toBe(true)
    expect(evaluateAudience(between, ctx({ cart_subtotal: '1000.01' }))).toBe(false)
    expect(evaluateAudience(between, ctx({ cart_subtotal: 'abc' }))).toBe(false)
    // A cart rule without bounds is not a rule (everyone).
    expect(evaluateAudience(one({ kind: 'cart', min: null, max: null }), ctx())).toBe(true)
  })

  it('time: days ([] = every day) and a window with `to` exclusive that may cross midnight', () => {
    expect(matchesTime({ days: [], from: '18:00', to: '23:00' }, 'mon', '18:00')).toBe(true)
    expect(matchesTime({ days: [], from: '18:00', to: '23:00' }, 'mon', '23:00')).toBe(false)
    expect(matchesTime({ days: ['fri', 'sat'], from: null, to: null }, 'fri', '03:00')).toBe(true)
    expect(matchesTime({ days: ['fri', 'sat'], from: null, to: null }, 'sun', '03:00')).toBe(false)
    // 22:00–02:00 on Friday: Friday night and the small hours of Saturday, not of Friday.
    const late = { days: ['fri' as const], from: '22:00', to: '02:00' }
    expect(matchesTime(late, 'fri', '23:30')).toBe(true)
    expect(matchesTime(late, 'sat', '01:59')).toBe(true)
    expect(matchesTime(late, 'sat', '02:00')).toBe(false)
    expect(matchesTime(late, 'fri', '01:00')).toBe(false)
    expect(matchesTime(late, 'fri', '21:59')).toBe(false)
    expect(evaluateAudience(one({ kind: 'time', days: ['fri', 'sat'], from: '18:00', to: '23:00' }), ctx({ day: 'sat', time: '19:15' }))).toBe(true)
  })

  it('match all needs every rule, any needs one', () => {
    const rules = [
      { kind: 'visitor', is: 'new' },
      { kind: 'device', in: ['mobile'] },
    ]
    expect(evaluateAudience({ match: 'all', rules }, ctx())).toBe(false)
    expect(evaluateAudience({ match: 'all', rules }, ctx({ device: 'mobile' }))).toBe(true)
    expect(evaluateAudience({ match: 'any', rules }, ctx())).toBe(true)
    expect(evaluateAudience({ match: 'any', rules }, ctx({ visitor: 'returning' }))).toBe(false)
  })

  it('lists the kinds a document uses and, for "Preview as", the nodes it would hide', () => {
    const doc = documentOf([elementNode('heading', 'e_bn', { text: 'বাংলা' }, { audience: one({ kind: 'language', in: ['bn'] }) } as never), elementNode('heading', 'e_all', { text: 'All' })])
    ;(doc.sections[0] as Section).audience = one({ kind: 'device', in: ['desktop'] }) as never
    const page = payloadOf(doc)
    expect([...audienceKinds(page.sections)].sort()).toEqual(['device', 'language'])
    expect(audienceVerdicts(page.sections, null)).toEqual({ ruled: ['s_row0', 'e_bn'], hidden: [] })
    expect(audienceVerdicts(page.sections, ctx({ device: 'mobile' }))).toEqual({ ruled: ['s_row0', 'e_bn'], hidden: ['s_row0', 'e_bn'] })
  })
})

describe('B13 the browser side of the context', () => {
  it('a visitor is new for the whole first visit, returning on a later one, new again after two years', () => {
    const now = Date.UTC(2026, 10, 19)
    expect(visitorKind(now)).toBe('new')
    expect(window.localStorage.getItem(VISITOR_KEY)).toBe(String(now))
    resetVisitorKind()
    expect(visitorKind(now + 60_000)).toBe('new')
    // A later visit (new session).
    window.sessionStorage.removeItem(VISITOR_SESSION_KEY)
    resetVisitorKind()
    expect(visitorKind(now + 86_400_000)).toBe('returning')
    resetVisitorKind()
    expect(visitorKind(now + 731 * 86_400_000)).toBe('new')
  })

  it('remembers the district chosen at checkout (integer ids only)', () => {
    expect(rememberedDistrict()).toBeNull()
    rememberDistrict(47)
    expect(rememberedDistrict()).toBe('47')
    rememberDistrict('<script>')
    expect(rememberedDistrict()).toBe('47')
    window.localStorage.setItem(DISTRICT_KEY, 'x')
    expect(rememberedDistrict()).toBeNull()
  })

  it('reads the P2a campaign touch, lower-cased', () => {
    expect(campaignTouch()).toBeNull()
    window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ utm_source: 'Facebook', utm_campaign: 'Eid-2026', short_link: 'eid-fb', first_seen_at: new Date().toISOString() }))
    expect(campaignTouch()).toEqual({ id: null, utm_source: 'facebook', utm_campaign: 'eid-2026', short_link: 'eid-fb' })
    // The arrival itself counts before its touch is stored.
    window.history.replaceState(null, '', '/p/eid?utm_campaign=Puja&sl=puja-fb')
    expect(campaignTouch()).toEqual({ id: null, utm_source: null, utm_campaign: 'puja', short_link: 'puja-fb' })
    window.history.replaceState(null, '', '/')
  })

  it('tells the weekday and time in the store timezone', () => {
    // 2026-11-20 17:30 UTC = Friday 23:30 in Dhaka (UTC+6).
    const at = new Date(Date.UTC(2026, 10, 20, 17, 30))
    expect(storeDayTime(at, 'Asia/Dhaka')).toEqual({ day: 'fri', time: '23:30' })
    expect(storeDayTime(at, 'Not/AZone')).toEqual({ day: 'fri', time: '23:30' })
    expect(storeDayTime(at, null)).toEqual({ day: 'fri', time: '23:30' })
    expect(storeDayTime(at, 'UTC')).toEqual({ day: 'fri', time: '17:30' })
  })
})

describe('B13 A/B arms', () => {
  const running = { id: 'hero-test', status: 'running' as const, split: 50, winner: null }

  it('reads the payload experiments (published: id, status, split, winner)', () => {
    expect(readExperiments([running, { id: 'Bad Id', status: 'running' }, { id: 'x2', status: 'odd', split: 300 }, 'nope'])).toEqual([running, { id: 'x2', status: 'draft', split: 100, winner: null }])
    expect(readExperiments(null)).toEqual([])
  })

  it('draws B with the split share and keeps the arm sticky in localStorage', () => {
    expect(drawArm(30, 0.29)).toBe('B')
    expect(drawArm(30, 0.3)).toBe('A')
    const first = armFor(DOC, running, { refused: false, random: () => 0.1 })
    expect(first).toBe('B')
    expect(window.localStorage.getItem(abStorageKey(DOC, 'hero-test'))).toBe('B')
    expect(armFor(DOC, running, { refused: false, random: () => 0.9 })).toBe('B')
  })

  it('draft → A, stopped / ended → the winner (else A); DNT / GPC → A with nothing stored', () => {
    expect(defaultArm({ status: 'draft', winner: 'B' })).toBe('A')
    expect(defaultArm({ status: 'stopped', winner: 'B' })).toBe('B')
    expect(defaultArm({ status: 'ended', winner: null })).toBe('A')
    expect(armFor(DOC, running, { refused: true, random: () => 0 })).toBe('A')
    expect(window.localStorage.length).toBe(0)
  })

  it('keeps the arm in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(armFor(DOC, running, { refused: false, random: () => 0.1 })).toBe('B')
    expect(armFor(DOC, running, { refused: false, random: () => 0.9 })).toBe('B')
  })

  it('reports only running experiments, and nothing when refused', () => {
    const experiments = [running, { id: 'old', status: 'ended' as const, split: 50, winner: 'B' as const }]
    expect(planArms(DOC, experiments, { refused: false, random: () => 0.9 })).toEqual({ shown: { 'hero-test': 'A', old: 'B' }, reported: { 'hero-test': 'A' } })
    expect(planArms(DOC, experiments, { refused: true })).toEqual({ shown: { 'hero-test': 'A', old: 'B' }, reported: {} })
    expect(planArms(null, experiments, { refused: false })).toEqual({ shown: { 'hero-test': 'A', old: 'B' }, reported: {} })
  })

  it('draws a section of the shown arm, or one without a known experiment', () => {
    const shown = { 'hero-test': 'B' as const }
    expect(sectionInArm({ experiment: { id: 'hero-test', arm: 'B' } }, shown)).toBe(true)
    expect(sectionInArm({ experiment: { id: 'hero-test', arm: 'A' } }, shown)).toBe(false)
    expect(sectionInArm({ experiment: { id: 'gone', arm: 'B' } }, shown)).toBe(true)
    expect(sectionInArm({ experiment: null }, shown)).toBe(true)
    expect(sectionInArm({}, shown)).toBe(true)
  })

  it('cleans arms before they are sent', () => {
    expect(cleanArms({ 'hero-test': 'B', 'Bad Id': 'A', x2: 'C' })).toEqual({ 'hero-test': 'B' })
    expect(cleanArms({})).toBeNull()
    expect(cleanArms('B')).toBeNull()
  })
})

/* ============================================================================================= */

const HERO_A = 's_hero_a'
const HERO_B = 's_hero_b'

/** A page whose first two sections are the arms of `hero-test`, then a plain section. */
function abPage(status: 'running' | 'draft' | 'stopped' | 'ended', winner: 'A' | 'B' | null = null, source: 'published' | 'draft' = 'published'): BuilderPage {
  const doc: BuilderDocument = documentOf(
    [elementNode('heading', 'e_a', { text: 'Version A hero' })],
    [elementNode('heading', 'e_b', { text: 'Version B hero' })],
    [elementNode('heading', 'e_plain', { text: 'Always here' })],
  )
  const [a, b] = doc.sections as Section[]
  Object.assign(a!, { id: HERO_A, experiment: { id: 'hero-test', arm: 'A' } })
  Object.assign(b!, { id: HERO_B, experiment: { id: 'hero-test', arm: 'B' } })
  return { ...payloadOf(doc, { key: 'landing:eid', source }), experiments: [{ id: 'hero-test', status, split: 50, winner }] as never }
}

function renderPage(page: BuilderPage, props: { scope?: string; insights?: boolean } = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PageRenderer page={page} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('B13 A/B tests on the page', () => {
  it('shows the visitor’s sticky arm of a running test only, and remembers it for the order', () => {
    window.localStorage.setItem(abStorageKey(DOC, 'hero-test'), 'B')
    renderPage(abPage('running'))
    expect(screen.getByRole('heading', { name: 'Version B hero' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Version A hero' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Always here' })).toBeInTheDocument()
    expect(reportedArmsOf(DOC)).toEqual({ 'hero-test': 'B' })
  })

  it('assigns a first-time visitor by the split', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    renderPage(abPage('running'))
    expect(screen.getByRole('heading', { name: 'Version A hero' })).toBeInTheDocument()
    expect(window.localStorage.getItem(abStorageKey(DOC, 'hero-test'))).toBe('A')
  })

  it.each([
    ['draft', null, 'Version A hero'],
    ['stopped', 'B', 'Version B hero'],
    ['ended', 'B', 'Version B hero'],
    ['ended', null, 'Version A hero'],
  ] as const)('a %s test (winner %s) shows %s to everyone and reports nothing', (status, winner, shown) => {
    window.localStorage.setItem(abStorageKey(DOC, 'hero-test'), shown === 'Version A hero' ? 'B' : 'A')
    renderPage(abPage(status, winner))
    expect(screen.getByRole('heading', { name: shown })).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(2)
    expect(reportedArmsOf(DOC)).toBeNull()
  })

  it('Do Not Track: always A, nothing stored or reported', () => {
    setPrivacy({ dnt: '1' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    renderPage(abPage('running'))
    expect(screen.getByRole('heading', { name: 'Version A hero' })).toBeInTheDocument()
    expect(window.localStorage.getItem(abStorageKey(DOC, 'hero-test'))).toBeNull()
    expect(reportedArmsOf(DOC)).toBeNull()
  })

  it('a staff draft preview shows the default arm without assigning one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    renderPage(abPage('running', null, 'draft'))
    expect(screen.getByRole('heading', { name: 'Version A hero' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Version B hero' })).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('a section of an experiment the payload does not list is a plain section', () => {
    const page = { ...abPage('running'), experiments: [] }
    renderPage(page)
    expect(screen.getAllByRole('heading')).toHaveLength(3)
  })

  it('sends the arms with every beacon of a page view (running tests only)', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.append(root)
    const sent: InsightsBeacon[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const collector = createPageCollector({ root, documentId: DOC, version: 3, path: '/p/eid', device: 'desktop', send: (beacon) => sent.push(beacon), arms: { 'hero-test': 'B' } })
    collector.flush(true)
    collector.flush(true)
    collector.destroy()
    expect(sent.length).toBeGreaterThanOrEqual(1)
    for (const beacon of sent) expect(beacon.arms).toEqual({ 'hero-test': 'B' })
    root.remove()
    vi.unstubAllGlobals()
  })

  it('order attribution carries the arms seen on the page; never with DNT / GPC', () => {
    rememberBuilderClick(DOC, 's_hero_b', 'mobile', Date.now(), { 'hero-test': 'B' })
    expect(readBuilderAttribution()).toEqual({ document_id: DOC, node_id: 's_hero_b', device: 'mobile', experiments: { 'hero-test': 'B' } })
    rememberReportedArms(DOC, { 'hero-test': 'A' })
    const form = document.createElement('form')
    const section = document.createElement('section')
    section.className = 'b-section'
    section.dataset.b = 's_order'
    section.append(form)
    expect(builderAttributionAt(DOC, form, 'desktop')).toEqual({ document_id: DOC, node_id: 's_order', device: 'desktop', experiments: { 'hero-test': 'A' } })
    setPrivacy({ gpc: true })
    rememberBuilderClick(DOC, 's_hero_b', 'mobile', Date.now(), { 'hero-test': 'B' })
    expect(readBuilderAttribution()).toEqual({ document_id: DOC, node_id: 's_hero_b', device: 'mobile' })
    expect(builderAttributionAt(DOC, form, 'desktop')).toBeNull()
  })
})

/* ============================================================================================= */

describe('B13 audiences on the page', () => {
  function ruledPage(rule: Record<string, unknown>, extra: Partial<BuilderPage> = {}): BuilderPage {
    const doc = documentOf([elementNode('heading', 'e_ruled', { text: 'Only for some' })], [elementNode('heading', 'e_open', { text: 'For everyone' })])
    ;(doc.sections[0] as Section).audience = one(rule) as never
    return { ...payloadOf(doc, { key: 'landing:eid' }), ...extra }
  }

  it('draws a section with rules only once the visitor is known — never first for everyone', async () => {
    let answer: (value: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))))
    renderPage(ruledPage({ kind: 'account', is: 'signed_in' }))
    expect(screen.getByRole('heading', { name: 'For everyone' })).toBeInTheDocument()
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Only for some' })).toBeNull()
    const body = ok({ id: 'cus_1', name: 'Rahim', email: 'r@example.test' }).body
    await act(async () => answer(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    expect(await screen.findByRole('heading', { name: 'Only for some' })).toBeInTheDocument()
  })

  it('keeps it hidden from a guest', async () => {
    mockApi({ 'GET /store/account/me': ok(null) })
    renderPage(ruledPage({ kind: 'account', is: 'signed_in' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'For everyone' })).toBeInTheDocument())
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Only for some' })).toBeNull()
  })

  it('new visitors only: shown on the first visit, not on a later one', async () => {
    const first = renderPage(ruledPage({ kind: 'visitor', is: 'new' }))
    expect(await screen.findByRole('heading', { name: 'Only for some' })).toBeInTheDocument()
    first.unmount()
    window.sessionStorage.clear()
    resetVisitorKind()
    renderPage(ruledPage({ kind: 'visitor', is: 'new' }))
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Only for some' })).toBeNull()
  })

  it('cart over ৳1,500 reads the cart subtotal', async () => {
    mockApi({ 'GET /store/cart': ok({ ...cartFixture(), subtotal: '1800.00' }) })
    renderPage(ruledPage({ kind: 'cart', min: '1500.00', max: null }))
    expect(await screen.findByRole('heading', { name: 'Only for some' })).toBeInTheDocument()
  })

  it('district: the signed-in shopper’s default address, else the district chosen at checkout', async () => {
    rememberDistrict(13)
    mockApi({ 'GET /store/account/me': ok(null) })
    const guest = renderPage(ruledPage({ kind: 'district', in: [13] }))
    expect(await screen.findByRole('heading', { name: 'Only for some' })).toBeInTheDocument()
    guest.unmount()
    mockApi({
      'GET /store/account/me': ok({ id: 'cus_1', name: 'Rahim', email: 'r@example.test' }),
      'GET /store/account/addresses': ok([{ id: 'a1', is_default_shipping: true, is_default_billing: true, district: { id: 47, name: 'Dhaka' }, division: { id: 3, name: 'Dhaka' } }]),
    })
    renderPage(ruledPage({ kind: 'district', in: [13] }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'For everyone' })).toBeInTheDocument())
    await act(async () => {})
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Only for some' })).toBeNull()
  })

  it('time rules use the payload’s store timezone and are checked again every minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Friday 17:59:30 in Dhaka.
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 20, 11, 59, 30)))
    renderPage(ruledPage({ kind: 'time', days: ['fri'], from: '18:00', to: '23:00' }, { timezone: 'Asia/Dhaka' }))
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Only for some' })).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole('heading', { name: 'Only for some' })).toBeInTheDocument()
  })

  it('language rules follow the page language; elements carry rules too', async () => {
    const doc = documentOf([elementNode('heading', 'e_bn', { text: 'শুধু বাংলায়' }, { audience: one({ kind: 'language', in: ['bn'] }) } as never), elementNode('heading', 'e_en', { text: 'English only' }, { audience: one({ kind: 'language', in: ['en'] }) } as never)])
    renderPage(payloadOf(doc))
    expect(await screen.findByRole('heading', { name: 'English only' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'শুধু বাংলায়' })).toBeNull()
  })
})

/* ============================================================================================= */

describe('B13 canvas: Preview as', () => {
  const ORIGIN = window.location.origin

  it('accepts the preview-as message (and no arm message: the editor sends the arm it shows)', () => {
    const data = envelope({ type: 'preview-as', context: BASE } satisfies ParentMessage)
    expect(readParentMessage(new MessageEvent('message', { data, origin: ORIGIN, source: window }), ORIGIN, window)).toEqual(data)
    const arms = { ...envelope({ type: 'preview-as', context: null } satisfies ParentMessage), type: 'show-arms' }
    expect(readParentMessage(new MessageEvent('message', { data: arms, origin: ORIGIN, source: window }), ORIGIN, window)).toBeNull()
  })

  it('draws every section it is sent (both arms) and fades the nodes the previewed shopper would not see', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const send = (data: ParentMessage) => act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: ORIGIN, source: window })))
    const page = abPage('running', null, 'draft')
    ;(page.sections[2] as Section).audience = one({ kind: 'device', in: ['mobile'] }) as never
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send({ type: 'render', sections: page.sections, data: {}, media: {}, selection: null, hover: null, errors: [], device: 'desktop', pending: [] })

    expect(await screen.findByRole('heading', { name: 'Version A hero' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Version B hero' })).toBeInTheDocument()
    const plain = document.querySelector('section[data-b="s_row2"]')!
    expect(plain).toHaveAttribute('data-b-audience')
    expect(plain).not.toHaveAttribute('data-b-audience-out')
    expect(screen.getByTestId('canvas-audience').textContent).toBe('')

    send({ type: 'preview-as', context: BASE })
    expect(screen.getByRole('heading', { name: 'Always here' })).toBeInTheDocument()
    expect(plain).toHaveAttribute('data-b-audience-out')
    expect(screen.getByTestId('canvas-audience').textContent).toContain('[data-b="s_row2"]{opacity:.35')

    send({ type: 'preview-as', context: { ...BASE, device: 'mobile' } })
    expect(plain).not.toHaveAttribute('data-b-audience-out')
    send({ type: 'preview-as', context: null })
    expect(screen.getByTestId('canvas-audience').textContent).toBe('')
  })
})
