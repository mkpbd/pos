import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { EXPORTABLE_LISTS, type ExportListKey } from '@/features/exports/lists'
import { useSessionStore } from '@/stores/session-store'
import { makeCurrentUser } from '@/test/fixtures'
import { renderRoutes } from '@/test/utils'

/** A platform admin passes every permission check, so each page renders its full header. */
const admin = makeCurrentUser({ user: { id: 'u-9', name: 'Platform Admin', email: 'admin@pos.test', phone: null, is_platform_admin: true, last_login_at: null } })

const salesSummary = {
  date: '2026-11-05', timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 0, gross_sales: '0.00', discounts: '0.00', net_sales: '0.00',
  tax: '0.00', total: '0.00', average_sale: '0.00', cost: null, gross_profit: null, paid: '0.00', due: '0.00', cancelled_count: 0, cancelled_total: '0.00', payments: [],
}

const envelope = (data: unknown, meta: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: true, data, meta: { request_id: 'test', ...meta } }), { status: 200, headers: { 'Content-Type': 'application/json' } })

/** Every list answers empty; the few object endpoints these pages read get a minimal object. */
function stubEmptyApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '')
    if (path === '/auth/me') return envelope(admin)
    if (path === '/sales/summary') return envelope(salesSummary)
    if (path === '/notifications/unread-count') return envelope({ count: 0 })
    if (path === '/loyalty/settings') return envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 })
    return envelope([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } })
  })
  vi.stubGlobal('fetch', fetchMock)
}

const pageLists = (Object.entries(EXPORTABLE_LISTS) as [ExportListKey, (typeof EXPORTABLE_LISTS)[ExportListKey]][]).filter(([, l]) => l.route !== null)

describe('EXPORTABLE_LISTS', () => {
  beforeEach(() => useSessionStore.setState({ activeBranchId: null }))

  it.each(pageLists)('%s: its page shows the Export menu, disabled while the list is empty', async (key, list) => {
    stubEmptyApi()
    renderRoutes(routes, list.route as string)

    const button = await screen.findByRole('button', { name: 'Export' })
    expect(button).toHaveAttribute('data-export-list', key)
    expect(button).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Export' })).toHaveLength(1)
  })

  it('wires every list somewhere in the admin, and nothing outside the map', () => {
    const sources = import.meta.glob<string>('/src/features/**/*.tsx', { query: '?raw', import: 'default', eager: true })
    const used = new Set<string>()
    for (const [file, source] of Object.entries(sources)) {
      if (file.endsWith('.test.tsx')) continue
      for (const match of source.matchAll(/<ExportMenu\b[^>]*?\blist="([A-Za-z]+)"/g)) used.add(match[1] as string)
    }
    expect([...used].sort()).toEqual(Object.keys(EXPORTABLE_LISTS).sort())
  })

  it('lists embedded exports with the screen that hosts them', () => {
    for (const list of Object.values(EXPORTABLE_LISTS)) {
      if (list.route === null) expect('screen' in list && list.screen).toBeTruthy()
      expect(list.endpoint.startsWith('/')).toBe(true)
    }
  })
})
