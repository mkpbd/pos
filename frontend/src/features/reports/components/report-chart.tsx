import { TrendChart } from '@/components/common/charts/trend-chart'
import type { ReportColumn, ReportDefinition, ReportRow } from '@/features/reports/api'
import { chartColumns } from '@/features/reports/columns'
import { longAxisLabel, shortAxisLabel } from '@/features/reports/format'
import { formatMoney } from '@/lib/money'

function periodOf(row: ReportRow, column: ReportColumn): string | null {
  const v = row[column.key]
  return typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(v) ? v : null
}

/**
 * Net sales over the rows on screen, oldest first (the table may be sorted any way). When the
 * report spans more than one page, the caption says the chart covers this page only.
 */
export function ReportTrendChart({ definition, columns, rows, partial }: { definition: ReportDefinition; columns: ReportColumn[]; rows: ReportRow[]; partial: boolean }) {
  const picked = chartColumns(columns)
  if (!picked) return null
  const points = rows
    .map((row) => ({ row, period: periodOf(row, picked.period) }))
    .filter((p): p is { row: ReportRow; period: string } => p.period !== null)
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
  // Several rows per period (e.g. split by channel) cannot be one line; the table says it all.
  if (points.length < 2 || new Set(points.map((p) => p.period)).size !== points.length) return null

  const title = `${picked.value.label} by ${definition.key === 'sales_monthly' || picked.period.key === 'month' ? 'month' : 'day'}${partial ? ' (this page)' : ''}`
  return (
    <section aria-labelledby="report-chart-title" className="rounded-md border bg-card p-3 sm:p-4">
      <h2 id="report-chart-title" className="mb-2 text-xs font-bold tracking-[0.1rem] text-heading uppercase">{title}</h2>
      <TrendChart
        title={title}
        variant="area"
        height={160}
        xHeader={picked.period.label}
        series={[{ key: 'value', label: picked.value.label }]}
        data={points.map(({ row, period }) => ({ key: period, label: shortAxisLabel(period), longLabel: longAxisLabel(period), values: { value: row[picked.value.key] as string | null } }))}
        formatValue={(v) => formatMoney(v)}
      />
    </section>
  )
}
