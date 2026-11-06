import { describe, expect, it } from 'vitest'
import { normalizeDefinition, type ReportRun } from '@/features/reports/api'
import { chartColumns, visibleColumns } from '@/features/reports/columns'
import { formatCell, formatChange, formatQuantity, percentChange } from '@/features/reports/format'
import { defaultValues, matchPreset, paramsProblem, presetRange, rangeDays, runQuery, withChanges } from '@/features/reports/params'
import { toStatement } from '@/features/reports/statement'
import { pnlLines, profitAndLossDefinition, salesByProductDefinition, salesDailyDefinition } from '@/features/reports/test-data'

// 2026-11-07 10:00 in Dhaka (UTC+6) — a Saturday.
const NOW = new Date('2026-11-07T04:00:00Z')
const TZ = 'Asia/Dhaka'

const run = (overrides: Partial<ReportRun> = {}): ReportRun => ({
  rows: [], pagination: null, totals: null, params: {}, generated_at: null, omitted_columns: [], columns: null, labels: {}, currency: null, raw: [], meta: {}, ...overrides,
})

describe('report definitions', () => {
  it('reads the registry shape: params by name, entity params, defaults and limits', () => {
    const def = normalizeDefinition(salesByProductDefinition)
    expect(def).toMatchObject({ key: 'sales_by_product', group: 'sales', layout: 'table', paginated: true, default_sort: '-net_sales', has_totals: true, max_range_days: 1827 })
    expect(def.params.map((p) => [p.key, p.type, p.entity])).toEqual([
      ['date_from', 'date', null], ['date_to', 'date', null], ['branch_id', 'id', 'branch'], ['product_id', 'id', 'product'], ['category_id', 'id', 'category'], ['channel', 'enum', null],
    ])
    expect(def.params.find((p) => p.key === 'channel')).toMatchObject({ default: 'all', options: [{ value: 'all', label: 'All channels' }, { value: 'pos', label: 'POS' }, { value: 'online', label: 'Online' }] })
    expect(def.columns.filter((c) => c.cost_sensitive).map((c) => c.key)).toEqual(['gross_profit', 'margin'])
  })

  it('accepts Laravel-style rules and keyed maps, and sends booleans as 1 / 0', () => {
    const def = normalizeDefinition({
      key: 'expiry', title: 'Expiry', group: 'inventory',
      params: { days: { type: 'integer', min: 1, max: 365, default: 30, label: 'Within days' }, include_expired: { type: 'boolean', default: true }, status: 'nullable|in:expired,expiring' },
      columns: ['product'],
    })
    expect(def.params.map((p) => [p.key, p.type, p.default])).toEqual([['days', 'integer', '30'], ['include_expired', 'boolean', '1'], ['status', 'enum', null]])
    expect(def.params[2]?.options.map((o) => o.value)).toEqual(['expired', 'expiring'])
    expect(normalizeDefinition(profitAndLossDefinition)).toMatchObject({ layout: 'statement', paginated: false })
  })

  it('hides cost columns without products.view_cost, and those the server omitted', () => {
    const def = normalizeDefinition(salesDailyDefinition)
    expect(visibleColumns(def, undefined, true).columns.map((c) => c.key)).toEqual(['date', 'orders', 'gross_sales', 'net_sales', 'cost', 'gross_profit'])
    const hidden = visibleColumns(def, undefined, false)
    expect(hidden.columns.map((c) => c.key)).toEqual(['date', 'orders', 'gross_sales', 'net_sales'])
    expect(hidden.hiddenCost.map((c) => c.label)).toEqual(['Cost', 'Gross profit'])
    expect(visibleColumns(def, run({ omitted_columns: ['cost'], labels: { date: 'Day' } }), true).columns.map((c) => c.label)).toEqual(['Day', 'Orders', 'Gross sales', 'Net sales', 'Gross profit'])
  })

  it('charts the period column against net sales', () => {
    const picked = chartColumns(normalizeDefinition(salesDailyDefinition).columns)
    expect([picked?.period.key, picked?.value.key]).toEqual(['date', 'net_sales'])
  })
})

describe('report params', () => {
  it('resolves presets in the organization calendar (weeks start Monday)', () => {
    expect(presetRange('today', TZ, NOW)).toEqual({ from: '2026-11-07', to: '2026-11-07' })
    expect(presetRange('yesterday', TZ, NOW)).toEqual({ from: '2026-11-06', to: '2026-11-06' })
    expect(presetRange('this_week', TZ, NOW)).toEqual({ from: '2026-11-02', to: '2026-11-07' })
    expect(presetRange('this_month', TZ, NOW)).toEqual({ from: '2026-11-01', to: '2026-11-07' })
    expect(presetRange('last_month', TZ, NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetRange('this_year', TZ, NOW)).toEqual({ from: '2026-01-01', to: '2026-11-07' })
    expect(presetRange('last_30_days', TZ, NOW)).toEqual({ from: '2026-10-09', to: '2026-11-07' })
    expect(presetRange('last_month', TZ, new Date('2026-01-15T04:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(matchPreset('2026-10-01', '2026-10-31', TZ, NOW)).toBe('last_month')
    expect(matchPreset('2026-10-02', '2026-10-31', TZ, NOW)).toBeNull()
  })

  it('defaults to this month plus the definition defaults, and builds the run query from the URL', () => {
    const def = normalizeDefinition(salesDailyDefinition)
    expect(defaultValues(def, TZ, NOW)).toEqual({ channel: 'all', date_from: '2026-11-01', date_to: '2026-11-07' })

    const search = new URLSearchParams('date_from=2026-10-01&date_to=2026-10-31&channel=online&branch_id=b-2&sort=-net_sales&page=2&per_page=50&junk=1')
    expect(runQuery(def, search, TZ, NOW)).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31', channel: 'online', branch_id: 'b-2', sort: '-net_sales', page: '2', per_page: '50' })
    expect(runQuery(def, new URLSearchParams(), TZ, NOW)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-07', channel: 'all', sort: 'date', page: '1', per_page: '50' })
    // Statements are not paged.
    expect(runQuery(normalizeDefinition(profitAndLossDefinition), new URLSearchParams('page=3'), TZ, NOW)).not.toHaveProperty('page')
  })

  it('restarts paging when a filter changes', () => {
    expect(withChanges(new URLSearchParams('page=3&channel=pos'), { channel: null }).toString()).toBe('')
    expect(withChanges(new URLSearchParams('channel=pos'), { page: '2' }).toString()).toBe('channel=pos&page=2')
  })

  it('checks the range before asking the server', () => {
    const daily = normalizeDefinition(salesDailyDefinition)
    expect(rangeDays('2026-01-01', '2026-12-31')).toBe(365)
    expect(paramsProblem(daily, { date_from: '2026-11-05', date_to: '2026-11-01' })).toBe('The start date must be on or before the end date.')
    expect(paramsProblem(daily, { date_from: '2025-01-01', date_to: '2026-11-07' })).toMatch(/at most 366 days \(this one is 676\)/)
    expect(paramsProblem(daily, { date_from: '2026-01-01', date_to: '2026-11-07' })).toBeNull()
    const monthly = normalizeDefinition({ ...salesDailyDefinition, key: 'sales_monthly', max_range_days: 1827, params: [...salesDailyDefinition.params, { name: 'group_by', label: 'Group by', type: 'enum', options: [{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }], default: 'month' }] })
    expect(paramsProblem(monthly, { date_from: '2024-01-01', date_to: '2026-11-07', group_by: 'month' })).toBeNull()
    expect(paramsProblem(monthly, { date_from: '2024-01-01', date_to: '2026-11-07', group_by: 'day' })).toMatch(/or group by month/)
  })
})

describe('report formatting', () => {
  it('formats cells by column type without float arithmetic', () => {
    expect(formatCell('money', '1234567.5')).toBe('1,234,567.50')
    expect(formatCell('quantity', '1500.250')).toBe('1,500.25')
    expect(formatQuantity('-3.000')).toBe('-3')
    expect(formatCell('number', 12345)).toBe('12,345')
    expect(formatCell('percent', '12.50')).toBe('12.5%')
    expect(formatCell('text', { id: 'p-1', name: 'Mango Juice' })).toBe('Mango Juice')
    expect(formatCell('money', null)).toBe('—')
    expect(formatCell('date', '2026-11')).toMatch(/Nov 2026/)
  })

  it('computes period-over-period change exactly', () => {
    expect(percentChange('125000.00', '100000.00')).toBe('25')
    expect(percentChange('100.00', '300.00')).toBe('-66.7')
    expect(percentChange('0.10', '0.30')).toBe('-66.7')
    expect(percentChange('5.00', '0.00')).toBeNull()
    expect(percentChange('-50.00', '-100.00')).toBe('50')
    expect(formatChange('25')).toBe('+25%')
    expect(formatChange('-66.7')).toBe('−66.7%')
    expect(formatChange('0.00')).toBe('0%')
  })
})

describe('profit and loss statement', () => {
  it('reads the P&L rows (sections become headings) with the previous period and change', () => {
    const statement = toStatement(run({ raw: pnlLines(), params: { date_from: '2026-11-01', date_to: '2026-11-07' }, meta: { previous_period: { date_from: '2026-10-25', date_to: '2026-10-31' } } }))
    expect(statement.hasComparison).toBe(true)
    expect(statement.period).toEqual({ from: '2026-11-01', to: '2026-11-07' })
    expect(statement.previousPeriod).toEqual({ from: '2026-10-25', to: '2026-10-31' })
    expect(statement.lines.map((l) => [l.label, l.kind, l.depth, l.change])).toEqual([
      ['Revenue', 'heading', 0, null], ['Gross sales', 'line', 0, '28.05'], ['Discounts', 'line', 0, '-50.00'], ['Returns', 'line', 0, null], ['Net sales', 'subtotal', 0, '25.00'],
      ['Cost of goods sold', 'line', 0, '-20.00'], ['Gross profit', 'subtotal', 0, '33.33'],
      ['Operating expenses', 'heading', 0, null], ['Rent', 'line', 1, '0.00'], ['Total operating expenses', 'subtotal', 0, '0.00'],
      ['Other income', 'heading', 0, null], ['Total other income', 'subtotal', 0, null], ['Net profit', 'total', 0, '66.67'],
    ])
    expect(statement.lines.find((l) => l.key === 'discounts')).toMatchObject({ amount: '-300.00', previous: '-200.00' })
  })

  it('also reads sections with lines and totals', () => {
    const statement = toStatement(run({
      raw: {
        sections: [
          { key: 'revenue', label: 'Revenue', lines: [{ label: 'Sales', amount: '100.00', previous: '80.00' }], total: { amount: '100.00', previous: '80.00' } },
          { key: 'gross_profit', label: 'Gross profit', amount: '40.00', previous: '30.00' },
        ],
        net_profit: { amount: '25.00', previous: '20.00' },
      },
    }))
    expect(statement.lines.map((l) => [l.label, l.kind, l.depth, l.amount])).toEqual([
      ['Revenue', 'heading', 0, null], ['Sales', 'line', 1, '100.00'], ['Total revenue', 'subtotal', 0, '100.00'], ['Gross profit', 'subtotal', 0, '40.00'], ['Net profit', 'total', 0, '25.00'],
    ])
  })
})
