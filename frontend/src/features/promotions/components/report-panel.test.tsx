import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { PromotionReport } from '@/features/promotions/api'
import { defaultReportRange, formatDay, rangeError, shiftDate, todayIn } from '@/features/promotions/report'
import { promotion, promotionViewer } from '@/features/promotions/test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const report = (overrides: Partial<PromotionReport> = {}): PromotionReport => ({
  redemptions: 5,
  orders: 5,
  discount_total: '250.00',
  order_revenue: '7400.50',
  average_discount: '50.00',
  by_day: [
    { date: '2026-10-30', redemptions: 2, discount: '100.00' },
    { date: '2026-10-31', redemptions: 3, discount: '150.00' },
  ],
  ...overrides,
})

describe('report dates', () => {
  it('uses the organization day, not the browser day', () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in Dhaka (UTC+6).
    const now = new Date('2026-10-31T20:00:00Z')
    expect(todayIn('Asia/Dhaka', now)).toBe('2026-11-01')
    expect(todayIn('UTC', now)).toBe('2026-10-31')
    expect(defaultReportRange('Asia/Dhaka', now)).toEqual({ from: '2026-10-03', to: '2026-11-01' })
  })

  it('shifts across months and years and checks the range', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(rangeError('2026-10-01', '2026-10-31')).toBeNull()
    expect(rangeError('2026-11-01', '2026-10-31')).toMatch(/on or before/)
    expect(rangeError('', '2026-10-31')).toBe('Choose both dates.')
    expect(formatDay('2026-11-01')).toBe(new Date(Date.UTC(2026, 10, 1)).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'medium' }))
  })
})

describe('promotion report tab', () => {
  it('shows KPIs and a per-day table for the chosen range', async () => {
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(promotionViewer()),
      'GET /promotions/pr-1': ok(promotion()),
      'GET /promotions/pr-1/report': (_init, url) => {
        queries.push(url.searchParams)
        return ok(url.searchParams.get('date_from') === '2026-10-31' ? report({ redemptions: 3, orders: 3, discount_total: '150.00', by_day: [report().by_day[1]!] }) : report())
      },
    })
    renderRoutes(routes, '/promotions/pr-1?tab=report')

    expect(await screen.findByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('kpi-redemptions')).toHaveTextContent('5')
    expect(screen.getByTestId('kpi-orders')).toHaveTextContent('5')
    expect(screen.getByTestId('kpi-discount')).toHaveTextContent('BDT 250.00')
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('BDT 7,400.50')
    expect(screen.getByTestId('kpi-average')).toHaveTextContent('BDT 50.00')
    const table = screen.getByRole('table', { name: 'Redemptions per day' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('150.00')).toBeInTheDocument()
    const first = queries[0]!
    expect(rangeError(first.get('date_from') ?? '', first.get('date_to') ?? '')).toBeNull()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-31' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    await waitFor(() => expect(screen.getByTestId('kpi-redemptions')).toHaveTextContent('3'))
    expect(queries.at(-1)?.get('date_to')).toBe('2026-10-31')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-05' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('The start date must be on or before the end date.')
  })

  it('says when nothing was redeemed in the period', async () => {
    mockApi({
      'GET /auth/me': ok(promotionViewer()),
      'GET /promotions/pr-1': ok(promotion()),
      'GET /promotions/pr-1/report': ok(report({ redemptions: 0, orders: 0, discount_total: '0.00', order_revenue: '0.00', average_discount: null, by_day: [] })),
    })
    renderRoutes(routes, '/promotions/pr-1?tab=report')

    expect(await screen.findByText('No redemptions in this period')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-average')).toHaveTextContent('—')
  })
})
