import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { campaign, landingPage, marketingManager, marketingViewer, shortLink, stats } from '@/features/marketing/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('campaigns page', () => {
  it('shows the period results, every campaign with Direct / other, and the campaign list', async () => {
    const statsUrls: URL[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/stats': (_init, url) => {
        statsUrls.push(url)
        return ok(stats())
      },
      'GET /marketing/campaigns': paged([campaign(), campaign({ id: 'cmp-2', name: 'Winter launch', utm_campaign: 'winter', landing_document: null, starts_at: null, ends_at: null, short_links_count: 0 })]),
    })
    renderRoutes(routes, '/marketing/campaigns?from=2026-11-12&to=2026-11-14')

    expect(await screen.findByRole('heading', { name: 'Marketing' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('stat-visits')).toHaveTextContent('320'))
    expect(screen.getByTestId('stat-visits')).toHaveTextContent('250 different visitors')
    expect(screen.getByTestId('stat-orders')).toHaveTextContent('9')
    expect(screen.getByTestId('stat-orders')).toHaveTextContent('1 cancelled not counted')
    expect(screen.getByTestId('stat-revenue')).toHaveTextContent('BDT13,450.50')
    expect(screen.getByTestId('stat-conversion')).toHaveTextContent('3.6%')
    expect(screen.getByTestId('stat-aov')).toHaveTextContent('1,494.50')
    expect(statsUrls[0]?.searchParams.get('from')).toBe('2026-11-12')
    expect(statsUrls[0]?.searchParams.get('to')).toBe('2026-11-14')
    expect(statsUrls[0]?.searchParams.has('campaign_id')).toBe(false)

    const results = screen.getByRole('table', { name: 'Results by campaign' })
    const rows = within(results).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByRole('link', { name: 'Eid sale 2026' })).toHaveAttribute('href', '/marketing/campaigns/cmp-1')
    expect(rows[0]).toHaveTextContent('9,450.50')
    expect(rows[1]).toHaveTextContent('Direct / other')
    expect(rows[1]).toHaveTextContent('30%')

    const list = await screen.findByRole('table', { name: 'Campaigns' })
    expect(within(list).getByText('eid-sale-2026')).toBeInTheDocument()
    expect(within(list).getByText('/p/eid-sale')).toBeInTheDocument()
    expect(within(list).getByText('1 Nov – 30 Nov 2026')).toBeInTheDocument()
    expect(within(list).getByText('No end date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Winter launch' })).toBeInTheDocument()
  })

  it('is read-only for viewers', async () => {
    mockApi({
      'GET /auth/me': ok(marketingViewer()),
      'GET /marketing/stats': ok(stats()),
      'GET /marketing/campaigns': paged([campaign()]),
    })
    renderRoutes(routes, '/marketing/campaigns')

    expect(await screen.findByRole('table', { name: 'Campaigns' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New campaign/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Eid sale 2026' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive Eid sale 2026' })).not.toBeInTheDocument()
  })

  it('creates a campaign and opens its results', async () => {
    const user = userEvent.setup()
    const posted: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/stats': ok(stats({ by_campaign: [] })),
      'GET /marketing/campaigns': paged([]),
      'GET /marketing/landing-pages': ok([landingPage]),
      'POST /marketing/campaigns': (init) => {
        posted.push(body(init))
        return { status: 201, body: { success: true, data: campaign({ id: 'cmp-9', name: 'Puja offer', landing_document: null }), meta: { request_id: 't' } } }
      },
      'GET /marketing/campaigns/cmp-9': ok(campaign({ id: 'cmp-9', name: 'Puja offer', landing_document: null })),
      'GET /marketing/short-links': paged([]),
    })
    const { router } = renderRoutes(routes, '/marketing/campaigns')

    expect(await screen.findByText('No campaigns yet')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /New campaign/ })[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'New campaign' })
    await user.click(within(dialog).getByRole('button', { name: 'Create campaign' }))
    expect(await within(dialog).findByText('Give the campaign a name.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Name'), 'Puja offer')
    expect(within(dialog).getByText(/utm_campaign=puja-offer/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Starts (optional)'), '2026-11-20')
    await user.click(within(dialog).getByRole('button', { name: 'Create campaign' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/marketing/campaigns/cmp-9'))
    expect(posted).toEqual([{ name: 'Puja offer', landing_document_id: null, starts_at: '2026-11-20', ends_at: null }])
    expect(toastSuccess).toHaveBeenCalledWith('Campaign “Puja offer” created.')
  })

  it('shows the server’s field errors', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/stats': ok(stats()),
      'GET /marketing/campaigns': paged([campaign()]),
      'GET /marketing/landing-pages': ok([landingPage]),
      'PATCH /marketing/campaigns/cmp-1': fail(422, 'VALIDATION_FAILED', 'Invalid', { utm_campaign: ['This tag is used by another campaign.'] }),
    })
    renderRoutes(routes, '/marketing/campaigns')

    await user.click(await screen.findByRole('button', { name: 'Edit Eid sale 2026' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Eid sale 2026' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Eid sale 2026')
    expect(within(dialog).getByLabelText('Starts (optional)')).toHaveValue('2026-11-01')
    await user.clear(within(dialog).getByLabelText('Link tag'))
    await user.type(within(dialog).getByLabelText('Link tag'), 'winter')
    await user.click(within(dialog).getByRole('button', { name: 'Save campaign' }))
    expect(await within(dialog).findByText('This tag is used by another campaign.')).toBeInTheDocument()
  })

  it('archives a campaign', async () => {
    const user = userEvent.setup()
    const patched: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/stats': ok(stats()),
      'GET /marketing/campaigns': paged([campaign()]),
      'PATCH /marketing/campaigns/cmp-1': (init) => {
        patched.push(body(init))
        return ok(campaign({ status: 'archived' }))
      },
    })
    renderRoutes(routes, '/marketing/campaigns')

    await user.click(await screen.findByRole('button', { name: 'Archive Eid sale 2026' }))
    await waitFor(() => expect(patched).toEqual([{ status: 'archived' }]))
    expect(toastSuccess).toHaveBeenCalledWith('Eid sale 2026 archived. Its links keep working and its figures stay.')
  })
})

describe('campaign results page', () => {
  it('shows the figures, the day chart with its table, sources, pages and short links', async () => {
    const user = userEvent.setup()
    const statsUrls: URL[] = []
    const linkUrls: URL[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/campaigns/cmp-1': ok(campaign()),
      'GET /marketing/stats': (_init, url) => {
        statsUrls.push(url)
        return ok(stats({ campaign: campaign(), by_campaign: [] }))
      },
      'GET /marketing/short-links': (_init, url) => {
        linkUrls.push(url)
        return paged([shortLink()])
      },
    })
    renderRoutes(routes, '/marketing/campaigns/cmp-1?from=2026-11-12&to=2026-11-14')

    expect(await screen.findByRole('heading', { name: 'Eid sale 2026' })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    await waitFor(() => expect(statsUrls[0]?.searchParams.get('campaign_id')).toBe('cmp-1'))
    expect(linkUrls[0]?.searchParams.get('campaign_id')).toBe('cmp-1')

    const chart = await screen.findByRole('group', { name: /Visits by day/ })
    const points = within(chart).getAllByRole('img')
    expect(points).toHaveLength(3)
    expect(points[1]).toHaveAccessibleName('Fri, 13 Nov 2026: Visits 0')

    await user.click(screen.getByRole('tab', { name: 'Revenue' }))
    const revenueChart = await screen.findByRole('group', { name: /Revenue by day/ })
    expect(within(revenueChart).getAllByRole('img')[2]).toHaveAccessibleName('Sat, 14 Nov 2026: Revenue BDT 10,550.50')

    const days = screen.getByRole('table', { name: 'Figures by day' })
    expect(within(days).getAllByRole('row')).toHaveLength(4)
    expect(within(days).getByText('Thu, 12 Nov 2026').closest('tr')).toHaveTextContent('2,900.00')

    const sources = screen.getByRole('table', { name: 'Visits and orders by source' })
    expect(within(sources).getByText('facebook / paid')).toBeInTheDocument()
    expect(within(sources).getByText('Direct / other')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Top landing pages' })).toHaveTextContent('/p/eid-sale')

    const links = screen.getByRole('table', { name: 'Short links' })
    expect(within(links).getByText('/go/eid-fb')).toBeInTheDocument()
    expect(within(links).getByText('1,250')).toBeInTheDocument()
  })

  it('creates a short link for the campaign with its page filled in', async () => {
    const user = userEvent.setup()
    const posted: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/campaigns/cmp-1': ok(campaign()),
      'GET /marketing/stats': ok(stats({ by_campaign: [] })),
      'GET /marketing/short-links': paged([]),
      'GET /marketing/campaigns': paged([campaign()]),
      'GET /marketing/landing-pages': ok([landingPage]),
      'POST /marketing/short-links': (init) => {
        posted.push(body(init))
        return { status: 201, body: { success: true, data: shortLink({ code: 'k3x9pz' }), meta: { request_id: 't' } } }
      },
    })
    renderRoutes(routes, '/marketing/campaigns/cmp-1')

    await user.click(await screen.findByRole('button', { name: 'New short link' }))
    const dialog = await screen.findByRole('dialog', { name: 'New short link' })
    expect(within(dialog).getByLabelText('Page it opens')).toHaveValue('/p/eid-sale')
    await user.type(within(dialog).getByLabelText('Where you share it (source)'), 'Facebook')
    await user.type(within(dialog).getByLabelText('Kind of post (medium)'), 'paid')
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({ target_path: '/p/eid-sale', campaign_id: 'cmp-1', utm: { source: 'facebook', medium: 'paid', content: null }, active: true })
    expect(toastSuccess).toHaveBeenCalledWith('Short link /go/k3x9pz created.')
  })
})

describe('short links page', () => {
  it('lists links, copies one and shows its QR code', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/short-links': paged([shortLink(), shortLink({ id: 'sl-2', code: 'no-domain', url: null, campaign: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, clicks: 0, last_clicked_at: null, active: false })]),
    })
    renderRoutes(routes, '/marketing/short-links')

    const table = await screen.findByRole('table', { name: 'Short links' })
    const first = within(table).getByTestId('short-link-eid-fb')
    expect(first).toHaveTextContent('https://berry.example.com/go/eid-fb')
    expect(first).toHaveTextContent('facebook / paid')
    expect(within(first).getByRole('link', { name: 'Eid sale 2026' })).toHaveAttribute('href', '/marketing/campaigns/cmp-1')
    const second = within(table).getByTestId('short-link-no-domain')
    expect(second).toHaveTextContent('Off')
    expect(second).toHaveTextContent('Add a store domain to share it.')
    expect(within(second).getByRole('button', { name: 'Copy /go/no-domain' })).toBeDisabled()

    await user.click(within(first).getByRole('button', { name: 'Copy /go/eid-fb' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Link copied.'))
    expect(await navigator.clipboard.readText()).toBe('https://berry.example.com/go/eid-fb')

    await user.click(within(first).getByRole('button', { name: 'QR code for /go/eid-fb' }))
    const dialog = await screen.findByRole('dialog', { name: 'QR code' })
    expect(within(dialog).getByRole('img', { name: 'QR code for https://berry.example.com/go/eid-fb' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Download SVG/ })).toHaveAttribute('download', 'qr-eid-fb.svg')
  })

  it('creates a link with a random code, validates the page, and deletes', async () => {
    const user = userEvent.setup()
    const posted: Record<string, unknown>[] = []
    const deleted: string[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/short-links': paged([shortLink()]),
      'GET /marketing/campaigns': paged([campaign()]),
      'GET /marketing/landing-pages': ok([landingPage]),
      'POST /marketing/short-links': (init) => {
        posted.push(body(init))
        return fail(422, 'VALIDATION_FAILED', 'Invalid', { code: ['This code is taken.'] })
      },
      'DELETE /marketing/short-links/sl-1': (_init, url) => {
        deleted.push(url.pathname)
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/marketing/short-links')

    await user.click(await screen.findByRole('button', { name: /New short link/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New short link' })
    await user.type(within(dialog).getByLabelText('Page it opens'), 'https://other.test')
    await user.type(within(dialog).getByLabelText('Link code (optional)'), 'EID')
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))
    expect(await within(dialog).findByText('Start with “/”, e.g. /p/eid-sale.')).toBeInTheDocument()
    expect(posted).toHaveLength(0)

    await user.clear(within(dialog).getByLabelText('Page it opens'))
    await user.type(within(dialog).getByLabelText('Page it opens'), '/p/eid-sale')
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))
    expect(await within(dialog).findByText('This code is taken.')).toBeInTheDocument()
    expect(posted[0]).toEqual({ target_path: '/p/eid-sale', campaign_id: null, utm: { source: null, medium: null, content: null }, active: true, code: 'eid' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Delete /go/eid-fb' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete /go/eid-fb?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleted).toEqual(['/api/v1/marketing/short-links/sl-1']))
  })

  it('needs marketing.view', async () => {
    mockApi({ 'GET /auth/me': ok(makeNoMarketing()) })
    renderRoutes(routes, '/marketing/short-links')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})

function makeNoMarketing() {
  return { ...marketingViewer(), permissions: ['web_orders.view'] }
}
