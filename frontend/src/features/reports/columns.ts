import type { ReportColumn, ReportDefinition, ReportRun } from '@/features/reports/api'

/** Reports that get a small trend chart above their table. */
export const CHARTED_REPORTS = new Set(['sales_daily', 'sales_monthly'])

const PERIOD_KEYS = ['date', 'day', 'month', 'period']
const VALUE_KEYS = ['net_sales', 'net', 'total', 'revenue']

/** Picks the period column and the money measure of a daily / monthly sales report. */
export function chartColumns(columns: ReportColumn[]): { period: ReportColumn; value: ReportColumn } | null {
  const period = columns.find((c) => PERIOD_KEYS.includes(c.key)) ?? columns.find((c) => c.type === 'date')
  const value = VALUE_KEYS.map((k) => columns.find((c) => c.key === k && c.type === 'money')).find(Boolean) ?? columns.find((c) => c.type === 'money')
  return period && value ? { period, value } : null
}

/** Columns this user sees: the server's list for the run, minus cost columns without products.view_cost. */
export function visibleColumns(definition: ReportDefinition, run: ReportRun | undefined, canViewCost: boolean): { columns: ReportColumn[]; hiddenCost: ReportColumn[] } {
  const labels = run?.labels ?? {}
  const all = (run?.columns ?? definition.columns).map((c) => (labels[c.key] ? { ...c, label: labels[c.key] as string } : c))
  const omitted = new Set([...definition.omitted_columns, ...(run?.omitted_columns ?? [])])
  const hidden = (c: ReportColumn) => omitted.has(c.key) || (c.cost_sensitive && !canViewCost)
  return { columns: all.filter((c) => !hidden(c)), hiddenCost: all.filter(hidden) }
}
