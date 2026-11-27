import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { registry, reportViewer, runMeta } from '@/features/reports/test-data'
import { useSessionStore } from '@/stores/session-store'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* VAT1 §3: the Mushak-6.2 / 6.1 registers and the monthly 9.1 summary in the generic report pages. */

beforeEach(() => {
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

const col = (key: string, label: string, type: string) => ({ key, label, type, cost_sensitive: false, sortable: false })
const branch = { name: 'branch_id', label: 'Branch', type: 'entity', required: false, entity: 'branch' }

const salesRegister = {
  key: 'mushak_6_2', title: 'Sales register (Mushak-6.2)', description: 'Every sales line with the buyer, value, supplementary duty and VAT.', group: 'finance', permission: 'reports.view',
  max_range_days: 1827,
  params: [
    { name: 'date_from', label: 'From', type: 'date', required: true }, { name: 'date_to', label: 'To', type: 'date', required: true }, branch,
    { name: 'channel', label: 'Channel', type: 'enum', required: false, default: 'all', options: [{ value: 'all', label: 'All channels' }, { value: 'pos', label: 'POS' }, { value: 'online', label: 'Online' }] },
  ],
  columns: [
    col('date', 'Date', 'date'), col('type', 'Type', 'text'), col('invoice_number', 'Invoice no.', 'text'), col('buyer_name', "Buyer's name", 'text'), col('buyer_bin', "Buyer's BIN", 'text'),
    col('description', 'Description of goods / services', 'text'), col('quantity', 'Quantity', 'quantity'), col('value', 'Value (excl. VAT)', 'money'), col('sd', 'Supplementary duty', 'money'),
    col('vat_rate', 'VAT rate %', 'percent'), col('vat', 'VAT', 'money'), col('total', 'Total value', 'money'),
  ],
  default_sort: null, totals: true, paginated: true, omitted_columns: [],
}

const vatSummary = {
  key: 'mushak_9_1', title: 'Monthly VAT summary (for Mushak-9.1)', description: 'A working summary to fill the Mushak-9.1 return, not the return form.', group: 'finance', permission: 'reports.financial',
  max_range_days: null,
  params: [{ name: 'month', label: 'Month', type: 'month', required: true }, branch],
  columns: [col('label', 'Line', 'text'), col('vat_rate', 'VAT rate %', 'percent'), col('value', 'Value (excl. VAT)', 'money'), col('sd', 'Supplementary duty', 'money'), col('vat', 'VAT', 'money')],
  default_sort: null, totals: false, paginated: false, omitted_columns: [],
}

function runCalls(fetchMock: ReturnType<typeof vi.fn>, key: string): Record<string, string>[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((u) => u.pathname === `/api/v1/reports/${key}`)
    .map((u) => Object.fromEntries(u.searchParams))
}

describe('Mushak-6.2 sales register', () => {
  it('lists sales and negative return rows with the channel filter and the totals row', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(reportViewer()),
      'GET /reports': ok([...registry(), salesRegister]),
      'GET /reports/mushak_6_2': ok([
        { date: '2026-11-02', type: 'Sale', invoice_number: 'INV-MAIN-000001', buyer_name: 'Rina Traders', buyer_bin: '000999888-0202', description: 'Mango Juice — 1 L', quantity: '2.000', value: '190.00', sd: '0.00', vat_rate: '15.00', vat: '28.50', total: '218.50' },
        { date: '2026-11-03', type: 'Return', invoice_number: 'RET-000001', buyer_name: 'Walk-in customer', buyer_bin: null, description: 'Mango Juice — 1 L', quantity: '-1.000', value: '-95.00', sd: '0.00', vat_rate: '15.00', vat: '-14.25', total: '-109.25' },
      ], runMeta({ totals: { value: '95.00', sd: '0.00', vat: '14.25', total: '109.25' }, pagination: { current_page: 1, per_page: 50, total: 2, last_page: 1 } })),
    })
    renderRoutes(routes, '/reports/mushak_6_2?date_from=2026-11-01&date_to=2026-11-30&channel=pos')

    const table = await screen.findByRole('table', { name: 'Sales register (Mushak-6.2)' })
    expect(within(table).getByRole('row', { name: /RET-000001/ })).toHaveTextContent('-109.25')
    expect(within(table).getByRole('row', { name: /INV-MAIN-000001/ })).toHaveTextContent('000999888-0202')
    const totals = screen.getByTestId('report-totals')
    expect(within(totals).getAllByRole('cell').map((c) => c.textContent)).toContain('109.25')
    expect(runCalls(fetchMock, 'mushak_6_2').at(-1)).toMatchObject({ date_from: '2026-11-01', date_to: '2026-11-30', channel: 'pos' })
  })
})

describe('Mushak-9.1 monthly VAT summary', () => {
  it('takes a month, this month by default, and runs for the month chosen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-07T04:00:00Z'))
    try {
      const fetchMock = mockApi({
        'GET /auth/me': ok(reportViewer(['reports.financial'])),
        'GET /reports': ok([...registry(), vatSummary]),
        'GET /reports/mushak_9_1': ok([
          { key: 'output:15.00', section: 'output', kind: 'line', label: 'Sales', vat_rate: '15.00', value: '190.00', sd: '0.00', vat: '28.50' },
          { key: 'output_total', section: 'output', kind: 'total', label: 'Total output VAT', vat_rate: null, value: '190.00', sd: '0.00', vat: '28.50' },
          { key: 'net_payable', section: 'net', kind: 'total', label: 'Net VAT payable', vat_rate: null, value: null, sd: null, vat: '28.50' },
        ], runMeta({ totals: null, pagination: null, params: { month: '2026-11' } })),
      })
      renderRoutes(routes, '/reports/mushak_9_1')

      const table = await screen.findByRole('table', { name: 'Monthly VAT summary (for Mushak-9.1)' })
      const net = within(table).getByRole('row', { name: /Net VAT payable/ })
      expect(net).toHaveTextContent('28.50')
      // Total lines are emphasised; ordinary lines are not.
      expect(net).toHaveAttribute('data-kind', 'total')
      expect(within(net).getAllByRole('cell').every((c) => c.classList.contains('font-bold'))).toBe(true)
      const sales = within(table).getByRole('row', { name: /^Sales/ })
      expect(sales).not.toHaveAttribute('data-kind')
      expect(within(sales).getAllByRole('cell').some((c) => c.classList.contains('font-bold'))).toBe(false)
      const month = screen.getByLabelText('Month')
      expect(month).toHaveAttribute('type', 'month')
      expect(month).toHaveValue('2026-11')
      expect(runCalls(fetchMock, 'mushak_9_1').at(-1)).toMatchObject({ month: '2026-11' })

      fireEvent.change(month, { target: { value: '2026-10' } })
      await waitFor(() => expect(runCalls(fetchMock, 'mushak_9_1').at(-1)).toMatchObject({ month: '2026-10' }))
    } finally {
      vi.useRealTimers()
    }
  })
})
