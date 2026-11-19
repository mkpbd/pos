import { useEffect, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes, renderWithQuery } from '@/test/utils'
import type { Device } from '@/storefront/builder/types'
import type { DocumentSummary } from '../api'
import { readDocumentInsights, readInsightsSummary } from './insights-api'
import { clickSpots, headline, heatLegend, heatStep, matchPeriod, periodProblem, placeWords, presetPeriod, sectionsBySeen } from './insights-model'
import { HeatOverlay } from './heat-overlay'
import { InsightsPanel } from './insights-panel'
import { useInsights } from './use-insights'

// The panel and pages tests click through selects and type dates: room for a busy full run.
vi.setConfig({ testTimeout: 20_000 })

const RAW = {
  document: { id: 'doc-1', title: 'Eid sale', kind: 'page', key: 'landing:eid' },
  from: '2026-11-01',
  to: '2026-11-03',
  device: null,
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
  totals: {
    views: 1500, unique_visitors: 1240, avg_scroll: '64.20', clicks: 410, orders: 38, revenue: '45600.00', conversion: '3.06',
    scroll_reach: { 25: '90.00', 50: '72.00', 75: '40.00', 100: '20.00' },
    vitals: { lcp_p75: 3100, cls_p75: '0.050', inp_p75: null, rating: { lcp: 'needs_improvement', cls: 'good', inp: null }, samples: { lcp: 80, cls: 80, inp: 0 } },
  },
  daily: [
    { day: '2026-11-01', views: 400, unique_visitors: 350, orders: 10, revenue: '12000.00' },
    { day: '2026-11-02', views: 500, unique_visitors: 420, orders: 12, revenue: '14400.00' },
    { day: '2026-11-03', views: 600, unique_visitors: 470, orders: 16, revenue: '19200.00' },
  ],
  sections: [
    { node_id: 's_hero', label: 'Hero', type: 'section', views: 1400, view_rate: '93.33', clicks: 300, click_rate: '21.43', orders: 30, revenue: '36000.00', reach: '100.00', live: true },
    { node_id: 's_old', label: 'Old banner', type: 'section', views: 200, view_rate: '13.33', clicks: 10, click_rate: '5.00', orders: 0, revenue: '0.00', reach: '80.00', live: false },
    { node_id: 's_faq', label: null, type: 'section', views: 900, view_rate: '60.00', clicks: 100, click_rate: '11.11', orders: 8, revenue: '9600.00', reach: '72.00', live: true },
  ],
  heat: { s_hero: [[17, 2, 120], [16, 3, 60], [2, 18, 10]], s_faq: [[10, 10, 40]], s_bad: [[25, 1, 3]] },
  versions: [{ number: 3, published_at: '2026-11-02T04:00:00Z' }],
}

describe('insights readers', () => {
  it('reads the backend shape: percent strings, CLS as a string, ratings, removed sections and the heat grid', () => {
    const data = readDocumentInsights(RAW)
    expect(data.totals).toMatchObject({ views: 1500, unique_visitors: 1240, avg_scroll: 64.2, orders: 38, revenue: '45600.00', conversion: 3.06 })
    expect(data.totals.vitals).toEqual({ lcp_p75: 3100, cls_p75: 0.05, inp_p75: null, rating: { lcp: 'needs_improvement', cls: 'good', inp: null } })
    expect(data.sections.map((s) => [s.node_id, s.live, s.view_rate])).toEqual([['s_hero', true, 93.33], ['s_old', false, 13.33], ['s_faq', true, 60]])
    expect(data.sections[2]!.label).toBe('')
    // A cell outside the 20 × 20 grid is dropped (and a section left without cells with it).
    expect(Object.keys(data.heat)).toEqual(['s_hero', 's_faq'])
    expect(data.versions).toEqual([{ number: 3, published_at: '2026-11-02T04:00:00Z' }])
    expect(data.currency).toBe('BDT')
    expect(data.timezone).toBe('Asia/Dhaka')
  })

  it('rates the vitals itself when the server sends no rating, and copes with an empty answer', () => {
    const data = readDocumentInsights({ totals: { vitals: { lcp_p75: 2000, cls_p75: '0.300', inp_p75: 450 } } })
    expect(data.totals.vitals.rating).toEqual({ lcp: 'good', cls: 'poor', inp: 'needs_improvement' })
    const empty = readDocumentInsights(null)
    expect(empty.totals.views).toBe(0)
    expect(empty.daily).toEqual([])
    expect(empty.heat).toEqual({})
  })

  it('reads the pages summary by document id', () => {
    const summary = readInsightsSummary({ from: '2026-10-21', to: '2026-11-19', documents: [{ document_id: 'd-1', views: 12, unique_visitors: 9, orders: 2, revenue: '10.00', conversion: '22.22' }, { views: 3 }] })
    expect(summary).toEqual({ 'd-1': { document_id: 'd-1', views: 12, unique_visitors: 9, orders: 2, revenue: '10.00', conversion: 22.22 } })
  })
})

describe('insights in plain words', () => {
  it('writes the headline for the owner', () => {
    const totals = readDocumentInsights(RAW).totals
    expect(headline(totals)).toBe('1,240 people saw this page; 38 ordered (3.1\u00a0%).')
    expect(headline({ ...totals, orders: 0 }, 'home page')).toBe('1,240 people saw this home page; nobody ordered from it yet.')
    expect(headline({ ...totals, unique_visitors: 1, views: 1, orders: 0 })).toBe('1 person saw this page; nobody ordered from it yet.')
    expect(headline({ ...totals, unique_visitors: 0, views: 0, orders: 0 })).toBe('Nobody has opened this page in these days yet.')
    // Without the server's rate it is worked out from the counts.
    expect(headline({ ...totals, conversion: null, unique_visitors: 200, orders: 5 })).toBe('200 people saw this page; 5 ordered (2.5\u00a0%).')
  })

  it('works out the periods in the store calendar and refuses odd custom ones', () => {
    const now = new Date('2026-11-19T20:00:00Z') // already 20 Nov in Dhaka
    expect(presetPeriod('30', 'Asia/Dhaka', now)).toEqual({ from: '2026-10-22', to: '2026-11-20' })
    expect(presetPeriod('7', 'UTC', now)).toEqual({ from: '2026-11-13', to: '2026-11-19' })
    expect(matchPeriod({ from: '2026-11-13', to: '2026-11-19' }, 'UTC', now)).toBe('7')
    expect(matchPeriod({ from: '2026-11-12', to: '2026-11-19' }, 'UTC', now)).toBeNull()
    expect(periodProblem('2026-11-10', '2026-11-01')).toMatch(/on or before/)
    expect(periodProblem('2025-01-01', '2026-11-01')).toMatch(/365 days/)
    expect(periodProblem('', '2026-11-01')).toBe('Choose both dates.')
    expect(periodProblem('2026-11-01', '2026-11-30')).toBeNull()
  })

  it('steps the heat colours and names the places people click', () => {
    expect([1, 24, 25, 60, 100].map((n) => heatStep(n, 100))).toEqual([0, 1, 1, 2, 4])
    expect(heatLegend(10).map((s) => s.label)).toEqual(['1–2', '3–4', '5–6', '7–8', '9–10'])
    // A small maximum keeps only the steps that hold a whole number of clicks.
    expect(heatLegend(2).map((s) => s.label)).toEqual(['1', '2'])
    expect(placeWords(0, 0)).toBe('top left')
    expect(placeWords(10, 10)).toBe('middle')
    expect(placeWords(19, 19)).toBe('bottom right')
    expect(placeWords(10, 0)).toBe('top centre')
    const spots = clickSpots([[17, 2, 120], [16, 3, 60], [2, 18, 20]])
    expect(spots.total).toBe(200)
    expect(spots.spots[0]).toEqual({ place: 'top right', clicks: 180, share: 90 })
  })

  it('sorts sections by the people who saw them, page order on ties', () => {
    const sections = readDocumentInsights(RAW).sections
    expect(sectionsBySeen(sections).map((s) => s.node_id)).toEqual(['s_hero', 's_faq', 's_old'])
  })
})

describe('heat map overlay', () => {
  it('draws the cells over each section, the reach between sections and the legend', () => {
    const data = readDocumentInsights(RAW)
    render(
      <HeatOverlay
        layer={{ heat: data.heat, reach: { s_hero: 100, s_faq: 72 }, max: 120 }}
        rects={{ s_hero: { x: 0, y: 0, w: 1000, h: 400 }, s_faq: { x: 0, y: 400, w: 1000, h: 200 } }}
        scale={0.5}
      />,
    )
    const hero = screen.getByTestId('heat-s_hero')
    expect(hero).toHaveStyle({ left: '0px', top: '0px', width: '500px', height: '200px' })
    const cells = hero.querySelectorAll('span')
    expect(cells).toHaveLength(3)
    expect(cells[0]).toHaveAttribute('data-step', '4')
    expect(cells[0]).toHaveStyle({ left: `${17 * 25 + 1}px`, top: `${2 * 10 + 1}px` })
    // The first section is where everyone starts: no marker there.
    expect(screen.queryByTestId('reach-s_hero')).toBeNull()
    expect(screen.getByTestId('reach-s_faq')).toHaveTextContent('72 % reached here')
    expect(screen.getByTestId('reach-s_faq')).toHaveStyle({ top: '200px' })
    expect(screen.getByTestId('heat-legend')).toHaveTextContent('Clicks per spot1120')
    expect(screen.getByTestId('heat-legend').querySelectorAll('[data-range]')[4]).toHaveAttribute('data-range', '97–120')
    expect(screen.getByTestId('heat-overlay')).toHaveAttribute('aria-hidden', 'true')
  })
})

function Harness({ onDevice, published = true }: { onDevice?: (d: Device) => void; published?: boolean }) {
  const insights = useInsights({ documentId: 'doc-1', available: true, timeZone: 'Asia/Dhaka' })
  const [device, setDevice] = useState<Device>('desktop')
  const setOpen = insights.setOpen
  useEffect(() => setOpen(true), [setOpen])
  return (
    <>
      <InsightsPanel
        insights={insights}
        noun="page"
        published={published}
        timeZone="Asia/Dhaka"
        device={device}
        onDevice={(d) => {
          setDevice(d)
          onDevice?.(d)
        }}
        nameOf={(id) => ({ s_hero: 'Section: Big sale', s_faq: 'Section: Questions' })[id] ?? null}
        onShowSection={() => {}}
        onClose={() => {}}
      />
      <output data-testid="heat-layer">{insights.heat ? Object.keys(insights.heat.reach).join(',') : 'off'}</output>
    </>
  )
}

describe('Insights panel', () => {
  it('shows the figures, each day, the sections, the clicks list and the speed in plain words', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    mockApi({
      'GET /storefront/builder/documents/doc-1/insights': (_init, url) => {
        seen.push(url.search)
        return ok(RAW)
      },
    })
    const onDevice = vi.fn()
    renderWithQuery(<Harness onDevice={onDevice} />)

    expect(await screen.findByTestId('insights-headline')).toHaveTextContent('1,240 people saw this page; 38 ordered (3.1 %).')
    expect(seen[0]).toMatch(/^\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
    expect(screen.getByTestId('insights-orders')).toHaveTextContent(/BDT\s?45,600.00|45,600/)
    expect(screen.getByTestId('insights-scroll')).toHaveTextContent('64 %')

    // The chart: one column per day, the publish marked, every value in the table.
    const chart = screen.getByTestId('insights-daily-chart')
    expect(within(chart).getAllByTestId('publish-marker')).toHaveLength(1)
    expect(within(chart).getByRole('img', { name: /Mon, 2 Nov 2026: 500\. Published v3/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Orders' }))
    expect(within(screen.getByTestId('insights-daily-chart')).getByRole('img', { name: /Tue, 3 Nov 2026: 16$/ })).toBeInTheDocument()

    // Sections by people who saw them, a removed one named so.
    const list = screen.getByTestId('insights-sections')
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.dataset.testid)).toEqual(['insights-section-s_hero', 'insights-section-s_faq', 'insights-section-s_old'])
    expect(within(rows[0]!).getByRole('button', { name: 'Section: Big sale' })).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent(/^Old bannerRemoved section/)
    expect(rows[1]).toHaveTextContent('72 % scrolled this far')

    // The list alternative of the heat map.
    expect(screen.getByTestId('clicks-list')).toHaveTextContent('Section: Big sale190 clicks — most at the top right (95 %), bottom left (5.3 %)')

    // Speed as traffic lights with words.
    expect(screen.getByTestId('vital-lcp')).toHaveTextContent('Could be better · 3.1 s')
    expect(screen.getByTestId('vital-cls')).toHaveTextContent('Good · 0.05')
    expect(screen.getByTestId('vital-inp')).toHaveTextContent('Not enough visits yet')

    // The heat map switch gives the canvas its layer (live sections only).
    expect(screen.getByTestId('heat-layer')).toHaveTextContent('off')
    await user.click(screen.getByRole('switch', { name: /Show clicks on the page/ }))
    expect(screen.getByTestId('heat-layer')).toHaveTextContent('s_hero,s_faq')
    expect(screen.getByText(/drawn on the Desktop view/)).toBeInTheDocument()
  })

  it('filters by device (and shows the canvas in that view) and by dates', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    mockApi({
      'GET /storefront/builder/documents/doc-1/insights': (_init, url) => {
        seen.push(url.search)
        return ok(RAW)
      },
    })
    const onDevice = vi.fn()
    renderWithQuery(<Harness onDevice={onDevice} />)
    await screen.findByTestId('insights-headline')

    await user.click(screen.getByTestId('insights-device'))
    await user.click(await screen.findByRole('option', { name: 'Phones' }))
    await waitFor(() => expect(seen.at(-1)).toMatch(/device=mobile/))
    expect(onDevice).toHaveBeenCalledWith('mobile')

    await user.click(screen.getByTestId('insights-period'))
    await user.click(await screen.findByRole('option', { name: 'Choose dates' }))
    const first = screen.getByLabelText('First day')
    await user.clear(first)
    await user.type(first, '2026-11-01')
    const last = screen.getByLabelText('Last day')
    await user.clear(last)
    await user.type(last, '2026-11-03')
    await waitFor(() => expect(seen.at(-1)).toBe('?from=2026-11-01&to=2026-11-03&device=mobile'))
  })

  it('says so when the page is not published and nothing was counted', async () => {
    mockApi({ 'GET /storefront/builder/documents/doc-1/insights': ok({ totals: {}, daily: [], sections: [], heat: {}, versions: [] }) })
    renderWithQuery(<Harness published={false} />)
    expect(await screen.findByTestId('insights-headline')).toHaveTextContent('Nobody has opened this page in these days yet.')
    expect(screen.getByText(/isn’t published yet/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Show clicks on the page/ })).toBeDisabled()
    expect(screen.getByText('No clicks in these days yet.')).toBeInTheDocument()
  })
})

describe('pages list: views and orders', () => {
  const page = (id: string, key: string, title: string): DocumentSummary => ({
    id, kind: 'page', key, title, schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null,
    published: { version_id: `v-${id}`, number: 1, published_at: '2026-11-01T00:00:00Z' }, path: `/p/${key.slice(8)}`, preview_url: null,
  })

  it('shows Views (30 days) and Orders on each page and sorts campaign pages by them', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })),
      'GET /storefront/builder/documents': ok([page('d-a', 'landing:a', 'Alpha'), page('d-b', 'landing:b', 'Beta'), page('d-c', 'landing:c', 'Gamma')]),
      'GET /storefront/builder/insights': ok({
        from: '2026-10-21', to: '2026-11-19', timezone: 'Asia/Dhaka', currency: 'BDT',
        documents: [
          { document_id: 'd-a', views: 10, unique_visitors: 8, orders: 5, revenue: '100.00', conversion: '62.50' },
          { document_id: 'd-b', views: 300, unique_visitors: 200, orders: 1, revenue: '10.00', conversion: '0.50' },
        ],
      }),
    })
    renderRoutes(routes, '/storefront/pages')

    const stats = await screen.findByTestId('page-stats-d-b')
    expect(stats).toHaveAccessibleName('Beta: 300 views and 1 orders in the last 30 days')
    expect(within(stats).getByText('Views (30 days)')).toBeInTheDocument()
    expect(screen.getByTestId('page-stats-d-c')).toHaveTextContent('Views (30 days)0Orders0')

    const list = screen.getByRole('list', { name: 'Campaign pages' })
    const order = () => within(list).getAllByRole('listitem').map((li) => li.dataset.testid)
    expect(order()).toEqual(['page-row-landing:a', 'page-row-landing:b', 'page-row-landing:c'])
    await user.click(screen.getByTestId('landing-sort'))
    await user.click(await screen.findByRole('option', { name: 'Views (30 days)' }))
    expect(order()).toEqual(['page-row-landing:b', 'page-row-landing:a', 'page-row-landing:c'])
    await user.click(screen.getByTestId('landing-sort'))
    await user.click(await screen.findByRole('option', { name: 'Orders' }))
    expect(order()).toEqual(['page-row-landing:a', 'page-row-landing:b', 'page-row-landing:c'])
  })

  it('leaves the columns out when the figures can’t be loaded', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })),
      'GET /storefront/builder/documents': ok([page('d-a', 'landing:a', 'Alpha'), page('d-b', 'landing:b', 'Beta')]),
    })
    renderRoutes(routes, '/storefront/pages')
    await screen.findByTestId('page-row-landing:a')
    expect(screen.queryByTestId('page-stats-d-a')).toBeNull()
    expect(screen.queryByTestId('landing-sort')).toBeNull()
  })
})
