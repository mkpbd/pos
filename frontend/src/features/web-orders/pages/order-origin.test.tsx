import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { filtersFromSearchParams, filtersToSearchParams, hasFilters, toListParams } from '@/features/web-orders/orders'
import { couriers, orderManager, orderRow, orderViewer, webOrder } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** P2a: where an order was placed (online store / campaign page) and the campaign it is credited to. */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const common = { 'GET /shipping/couriers': ok(couriers()), 'GET /geography/districts': ok([]) }

describe('order source filter', () => {
  it('reads and writes ?source and sends it to the list', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('source=landing_page&status=confirmed'))
    expect(filters.source).toBe('landing_page')
    expect(hasFilters(filters, '')).toBe(true)
    expect(toListParams(filters, '')).toEqual({ page: 1, per_page: 25, status: 'confirmed', source: 'landing_page' })
    expect(filtersToSearchParams(filters).toString()).toBe('status=confirmed&source=landing_page')
    expect(filtersFromSearchParams(new URLSearchParams('source=pos')).source).toBeUndefined()
  })
})

describe('web orders list', () => {
  it('marks campaign-page orders and names their campaign', async () => {
    const urls: URL[] = []
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      ...common,
      'GET /web-orders': (_init, url) => {
        urls.push(url)
        return paged([
          orderRow({ source: 'landing_page', campaign: { id: 'cmp-1', name: 'Eid sale 2026' } }),
          orderRow({ id: 'wo-2', number: 'WEB-000002', source: 'storefront', campaign: { id: 'cmp-2', name: 'Winter launch' } }),
          orderRow({ id: 'wo-3', number: 'WEB-000003', source: 'storefront', campaign: null }),
        ])
      },
    })
    renderRoutes(routes, '/web-orders?source=landing_page')

    const table = await screen.findByRole('table', { name: 'Web orders' })
    await waitFor(() => expect(urls[0]?.searchParams.get('source')).toBe('landing_page'))
    const first = within(table).getByTestId('order-origin-wo-1')
    expect(first).toHaveTextContent('Campaign page')
    expect(first).toHaveTextContent('Campaign: Eid sale 2026')
    const second = within(table).getByTestId('order-origin-wo-2')
    expect(second).not.toHaveTextContent('Campaign page')
    expect(second).toHaveTextContent('Winter launch')
    expect(within(table).queryByTestId('order-origin-wo-3')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter by where the order was placed' })).toHaveTextContent('Campaign pages only')
  })
})

describe('web order page', () => {
  it('shows where the order came from, linking the campaign for marketing staff', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['web_orders.view', 'marketing.view'] })),
      'GET /web-orders/wo-1': ok(webOrder({
        source: 'landing_page',
        campaign: { id: 'cmp-1', name: 'Eid sale 2026' },
        attribution: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'eid-sale-2026', utm_content: 'video-1', short_link: 'eid-fb', landing_path: '/p/eid-sale', referrer_host: 'm.facebook.com' },
      })),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const origin = await screen.findByTestId('order-origin')
    expect(origin).toHaveTextContent('Placed onCampaign page')
    expect(within(origin).getByRole('link', { name: 'Eid sale 2026' })).toHaveAttribute('href', '/marketing/campaigns/cmp-1')
    expect(origin).toHaveTextContent('Source / mediumfacebook / paid')
    expect(origin).toHaveTextContent('Ad or postvideo-1')
    expect(origin).toHaveTextContent('Short link/go/eid-fb')
    expect(origin).toHaveTextContent('First page/p/eid-sale')
    expect(origin).toHaveTextContent('Came from sitem.facebook.com')
  })

  it('says direct for store orders without a campaign, and names the campaign as text without marketing access', async () => {
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder({ source: 'storefront', campaign: null, attribution: null })),
      'GET /web-orders/wo-2': ok(webOrder({ id: 'wo-2', source: 'storefront', campaign: { id: 'cmp-1', name: 'Eid sale 2026' }, attribution: { utm_source: 'whatsapp' } })),
    })
    const { router } = renderRoutes(routes, '/web-orders/wo-1')

    const origin = await screen.findByTestId('order-origin')
    expect(origin).toHaveTextContent('Placed onOnline store')
    expect(origin).toHaveTextContent('None (direct / other)')

    await router.navigate('/web-orders/wo-2')
    await waitFor(() => expect(screen.getByTestId('order-origin')).toHaveTextContent('Source / mediumwhatsapp'))
    expect(within(screen.getByTestId('order-origin')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByTestId('order-origin')).toHaveTextContent('Eid sale 2026')
  })

  it('shows nothing for orders from before campaigns', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/wo-1': ok(webOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByTestId('order-origin')).not.toBeInTheDocument()
  })
})
