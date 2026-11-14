import type { Campaign, MarketingStats, ShortLink } from '@/features/marketing/api'
import { makeCurrentUser } from '@/test/fixtures'

export const marketingManager = () =>
  makeCurrentUser({ roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: null }], permissions: ['marketing.view', 'marketing.manage', 'web_orders.view'] })

export const marketingViewer = () => makeCurrentUser({ roles: [{ id: 'r-10', name: 'Viewer', system_key: null }], permissions: ['marketing.view'] })

export const landingPage = { id: 'doc-1', title: 'Eid offer', slug: 'eid-sale', path: '/p/eid-sale', published: true }

export function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'cmp-1',
    name: 'Eid sale 2026',
    slug: 'eid-sale-2026',
    utm_campaign: 'eid-sale-2026',
    landing_document: landingPage,
    starts_at: '2026-11-01',
    ends_at: '2026-11-30',
    status: 'active',
    short_links_count: 1,
    created_at: '2026-10-25T10:00:00+06:00',
    updated_at: '2026-10-25T10:00:00+06:00',
    ...overrides,
  }
}

export function shortLink(overrides: Partial<ShortLink> = {}): ShortLink {
  return {
    id: 'sl-1',
    code: 'eid-fb',
    target_path: '/p/eid-sale',
    campaign: { id: 'cmp-1', name: 'Eid sale 2026' },
    utm: { source: 'facebook', medium: 'paid', campaign: null, content: 'video-1', term: null },
    clicks: 1250,
    last_clicked_at: '2026-11-13T18:30:00+06:00',
    active: true,
    url: 'https://berry.example.com/go/eid-fb',
    created_at: '2026-10-25T10:00:00+06:00',
    updated_at: '2026-10-25T10:00:00+06:00',
    ...overrides,
  }
}

const day = (date: string, visits: number, orders: number, revenue: string) => ({ date, visits, unique_visitors: Math.max(0, visits - 2), orders, revenue })

export function stats(overrides: Partial<MarketingStats> = {}): MarketingStats {
  return {
    range: { from: '2026-11-12', to: '2026-11-14', timezone: 'Asia/Dhaka' },
    currency: 'BDT',
    campaign: null,
    totals: { visits: 320, unique_visitors: 250, orders: 9, cancelled_orders: 1, items: '11.000', revenue: '13450.50', conversion_rate: '3.60', average_order_value: '1494.50' },
    by_campaign: [
      { campaign: { id: 'cmp-1', name: 'Eid sale 2026', status: 'active' }, visits: 300, unique_visitors: 240, orders: 6, items: '7.000', revenue: '9450.50', conversion_rate: '2.50', average_order_value: '1575.08' },
      { campaign: null, visits: 20, unique_visitors: 10, orders: 3, items: '4.000', revenue: '4000.00', conversion_rate: '30.00', average_order_value: '1333.33' },
    ],
    by_source: [
      { source: 'facebook', medium: 'paid', visits: 280, unique_visitors: 220, orders: 5, items: '6.000', revenue: '8000.00' },
      { source: null, medium: null, visits: 40, unique_visitors: 30, orders: 4, items: '5.000', revenue: '5450.50' },
    ],
    by_day: [day('2026-11-12', 100, 2, '2900.00'), day('2026-11-13', 0, 0, '0.00'), day('2026-11-14', 220, 7, '10550.50')],
    top_landing_pages: [{ path: '/p/eid-sale', visits: 290, orders: 8, revenue: '12000.00' }],
    ...overrides,
  }
}
