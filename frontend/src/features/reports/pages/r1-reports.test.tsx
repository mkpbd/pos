import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { deadStockDefinition, LOSS_EVENTS, LOSS_SUMMARY, lossColumns, lossPreventionDefinition, registry, reportViewer, runMeta } from '@/features/reports/test-data'
import { useSessionStore } from '@/stores/session-store'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* R1 §4: the loss prevention, returns and dead stock reports render in the generic report pages. */

beforeEach(() => {
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

const RANGE = 'date_from=2026-11-01&date_to=2026-11-07'

function runCalls(fetchMock: ReturnType<typeof vi.fn>, key: string): Record<string, string>[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((u) => u.pathname === `/api/v1/reports/${key}`)
    .map((u) => Object.fromEntries(u.searchParams))
}

const summaryRows = () => [
  { cashier_id: 'u-2', cashier: 'Karim', cancelled_count: 2, cancelled_value: '900.00', discounts: '150.00', overrides_count: 1, overrides_value: '40.00', no_sales: 3, returns_count: 1, returns_value: '250.00', exchanges: 1 },
]
const eventRows = () => [
  { date: '2026-11-03T04:15:00Z', cashier_id: 'u-2', cashier: 'Karim', event: 'Cancelled sale', document_type: 'sale', document_id: 'sa-9', document: 'INV-MAIN-000009', amount: '900.00', reason: 'Wrong items · approved by Rahim' },
  { date: '2026-11-04T05:00:00Z', cashier_id: 'u-2', cashier: 'Karim', event: 'Return', document_type: 'sale_return', document_id: 'rt-4', document: 'RET-000004', amount: '250.00', reason: 'Damaged' },
  { date: '2026-11-05T06:00:00Z', cashier_id: 'u-2', cashier: 'Karim', event: 'No sale', document_type: 'register_session', document_id: 'rs-1', document: 'Till 1', amount: null, reason: 'Change for a note' },
]

function lossRun(_init: RequestInit, url: URL) {
  return url.searchParams.get('show') === 'events'
    ? ok(eventRows(), runMeta({ totals: null, columns: lossColumns(LOSS_EVENTS), pagination: { current_page: 1, per_page: 50, total: 3, last_page: 1 } }))
    : ok(summaryRows(), runMeta({
      totals: { cancelled_count: 2, cancelled_value: '900.00', discounts: '150.00', overrides_count: 1, overrides_value: '40.00', no_sales: 3, returns_count: 1, returns_value: '250.00', exchanges: 1 },
      columns: lossColumns(LOSS_SUMMARY), pagination: { current_page: 1, per_page: 50, total: 1, last_page: 1 },
    }))
}

const headers = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((h) => h.textContent?.replace(/, sort.*$/, ''))

describe('loss prevention report (R1)', () => {
  it('shows the summary per cashier, then every event with links to the documents', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(reportViewer(['sales.view', 'returns.view', 'cash_registers.view', 'users.view'])),
      'GET /reports': ok([...registry(), lossPreventionDefinition, deadStockDefinition]),
      'GET /reports/loss_prevention': lossRun,
      'GET /users': ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }),
    })
    renderRoutes(routes, `/reports/loss_prevention?${RANGE}`)

    const table = await screen.findByRole('table', { name: 'Loss prevention' })
    expect(headers(table)).toEqual(['Cashier', 'Cancelled sales', 'Cancelled value', 'Discounts given', 'Price overrides', 'Given away by overrides', 'No-sale openings', 'Returns', 'Refunded', 'Exchanges'])
    expect(within(table).getByRole('row', { name: /Karim/ })).toHaveTextContent('900.00')
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('Total')
    expect(runCalls(fetchMock, 'loss_prevention').at(-1)).toMatchObject({ date_from: '2026-11-01', date_to: '2026-11-07', show: 'summary' })

    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: 'Every event' }))

    await waitFor(() => expect(runCalls(fetchMock, 'loss_prevention').at(-1)).toMatchObject({ show: 'events' }))
    await waitFor(() => expect(headers(screen.getByRole('table', { name: 'Loss prevention' }))).toEqual(['Date', 'Cashier', 'Type', 'Document', 'Amount', 'Reason']))
    const events = screen.getByRole('table', { name: 'Loss prevention' })
    expect(within(events).getByRole('link', { name: 'INV-MAIN-000009' })).toHaveAttribute('href', '/sales/sa-9')
    expect(within(events).getByRole('link', { name: 'RET-000004' })).toHaveAttribute('href', '/returns/rt-4')
    expect(within(events).getByRole('link', { name: 'Till 1' })).toHaveAttribute('href', '/cash-registers/sessions/rs-1')
    expect(within(events).getByRole('row', { name: /Wrong items/ })).toHaveTextContent('approved by Rahim')
  })

  it('shows document numbers as text without the right to open them', async () => {
    mockApi({
      'GET /auth/me': ok(reportViewer()),
      'GET /reports': ok([...registry(), lossPreventionDefinition]),
      'GET /reports/loss_prevention': lossRun,
    })
    renderRoutes(routes, `/reports/loss_prevention?${RANGE}&show=events`)
    const table = await screen.findByRole('table', { name: 'Loss prevention' })
    await within(table).findByText('INV-MAIN-000009')
    expect(within(table).queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('dead stock report (R1)', () => {
  const aging = (withValue: boolean) =>
    [['days_0_30', 1, '4.000', '400.00'], ['days_31_60', 0, '0.000', '0.00'], ['days_61_90', 0, '0.000', '0.00'], ['days_91_180', 2, '10.000', '1500.00'], ['days_over_180', 1, '3.000', '90.00']].map(
      ([key, items, quantity, value]) => ({ key, items, quantity, ...(withValue ? { value } : {}) }),
    )
  const rows = [{ variant_id: 'v-1', product_id: 'p-1', product: 'Blue Kettle', sku: 'KET-1', on_hand: '6.000', value: '1200.00', last_sold_on: null, days_since_sold: null, last_received_on: '2026-06-01' }]

  it('takes the days and shows the aging buckets by value', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(reportViewer(['inventory.view', 'products.view_cost'])),
      'GET /reports': ok([...registry(), deadStockDefinition]),
      'GET /reports/dead_stock': ok(rows, runMeta({ totals: { on_hand: '6.000', value: '1200.00', items: 1 }, aging: aging(true), columns: deadStockDefinition.columns })),
      'GET /categories': ok([]),
    })
    renderRoutes(routes, '/reports/dead_stock')

    const table = await screen.findByRole('table', { name: 'Dead stock' })
    expect(within(table).getByRole('row', { name: /Blue Kettle/ })).toHaveTextContent('1,200.00')
    expect(runCalls(fetchMock, 'dead_stock').at(-1)).toMatchObject({ days: '90', sort: '-value' })
    expect(screen.getByLabelText('Not sold for (days)')).toHaveValue(90)
    const summary = screen.getByLabelText('Stock aging by last received')
    expect(within(summary).getByTestId('aging-days_91_180')).toHaveTextContent('91–180 days')
    expect(within(summary).getByTestId('aging-days_91_180')).toHaveTextContent('1,500.00')
    expect(within(summary).getByTestId('aging-days_over_180')).toHaveTextContent('1 item')
  })

  it('shows quantities in the buckets without cost permission', async () => {
    mockApi({
      'GET /auth/me': ok(reportViewer(['inventory.view'])),
      'GET /reports': ok([...registry(), { ...deadStockDefinition, omitted_columns: ['value'] }]),
      'GET /reports/dead_stock': ok(rows.map(({ value: _v, ...r }) => r), runMeta({ totals: { on_hand: '6.000', items: 1 }, aging: aging(false), omitted_columns: ['value'] })),
      'GET /categories': ok([]),
    })
    renderRoutes(routes, '/reports/dead_stock')
    await screen.findByRole('table', { name: 'Dead stock' })
    expect(screen.getByTestId('aging-days_91_180')).toHaveTextContent('10')
    expect(screen.getByTestId('aging-days_91_180')).not.toHaveTextContent('1,500')
    expect(screen.getByTestId('cost-hidden-note')).toHaveTextContent('Value is hidden')
  })
})
