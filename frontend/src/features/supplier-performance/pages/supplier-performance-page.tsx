import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { performanceListQuery, useSupplierPerformanceListQuery, type PerformanceSort, type SupplierPerformanceRow } from '@/features/supplier-performance/api'
import { PerformanceFilters, type FilterValues } from '@/features/supplier-performance/components/performance-filters'
import { ScoreBadge } from '@/features/supplier-performance/components/score-badge'
import { defaultPerformanceRange, formatDays, formatPriceChange, formatRate, METRIC_HELP } from '@/features/supplier-performance/performance'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

type Column = { key: PerformanceSort; label: string; className?: string; cell: (row: SupplierPerformanceRow, currency?: string) => string }

const COLUMNS: Column[] = [
  { key: 'orders', label: 'Orders', className: 'hidden md:table-cell', cell: (r) => String(r.orders) },
  { key: 'spend', label: 'Spend', cell: (r, currency) => formatMoney(r.spend, currency) },
  { key: 'on_time_rate', label: 'On time', cell: (r) => formatRate(r.on_time_rate) },
  { key: 'fill_rate', label: 'Fill rate', className: 'hidden sm:table-cell', cell: (r) => formatRate(r.fill_rate) },
  { key: 'avg_lead_days', label: 'Lead time', className: 'hidden lg:table-cell', cell: (r) => formatDays(r.avg_lead_days) },
  { key: 'return_rate', label: 'Returns', className: 'hidden md:table-cell', cell: (r) => formatRate(r.return_rate) },
  { key: 'price_change_pct', label: 'Price change', className: 'hidden lg:table-cell', cell: (r) => formatPriceChange(r.price_change_pct) },
  { key: 'quote_response_rate', label: 'Quote response', className: 'hidden xl:table-cell', cell: (r) => formatRate(r.quote_response_rate) },
  { key: 'quotes_won', label: 'Quotes won', className: 'hidden xl:table-cell', cell: (r) => String(r.quotes_won) },
]

const SORT_KEYS: PerformanceSort[] = ['score', ...COLUMNS.map((c) => c.key)]
/** Lower is better for these; the first click sorts them ascending. */
const ASCENDING_FIRST: PerformanceSort[] = ['avg_lead_days', 'return_rate', 'price_change_pct']

function parseSort(value: string | null): { key: PerformanceSort; desc: boolean } {
  const desc = value?.startsWith('-') ?? false
  const key = (value ?? '').replace(/^-/, '') as PerformanceSort
  return SORT_KEYS.includes(key) ? { key, desc } : { key: 'score', desc: true }
}

function SortHeader({ label, column, sort, onSort, className, help }: {
  label: string
  column: PerformanceSort
  sort: { key: PerformanceSort; desc: boolean }
  onSort: (column: PerformanceSort) => void
  className?: string
  help: string
}) {
  const active = sort.key === column
  const Icon = !active ? ArrowUpDownIcon : sort.desc ? ArrowDownIcon : ArrowUpIcon
  return (
    <TableHead className={cn('text-right', className)} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" title={help} onClick={() => onSort(column)}>
        {label}
        <Icon className={cn('size-3.5', !active && 'text-muted-foreground/60')} aria-hidden />
        <span className="sr-only">{active ? (sort.desc ? ', sorted high to low' : ', sorted low to high') : ', sort'}</span>
      </button>
    </TableHead>
  )
}

/** /purchasing/supplier-performance — every supplier's delivery, price and quote record with a score. */
export function SupplierPerformancePage() {
  const me = useAuth()
  const currency = me.organization?.base_currency
  const [params, setParams] = useSearchParams()
  const fallback = defaultPerformanceRange(me.organization?.timezone)
  const filters: FilterValues = {
    date_from: params.get('date_from') ?? fallback.date_from,
    date_to: params.get('date_to') ?? fallback.date_to,
    branch_id: params.get('branch_id') ?? '',
  }
  const sort = parseSort(params.get('sort'))
  const [page, setPage] = useState(1)
  const query = performanceListQuery(filters, sort)
  const { data, error, isPending, refetch } = useSupplierPerformanceListQuery({ ...query, page })

  const update = (next: Partial<FilterValues> & { sort?: string }) => {
    const merged = { ...filters, sort: params.get('sort') ?? '', ...next }
    const out = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) if (v) out.set(k, v)
    setParams(out, { replace: true })
    setPage(1)
  }
  const onSort = (column: PerformanceSort) => {
    const desc = sort.key === column ? !sort.desc : !ASCENDING_FIRST.includes(column)
    update({ sort: `${desc ? '-' : ''}${column}` })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="How suppliers deliver: on time, in full, at stable prices — and how they answer requests for quotation."
        actions={<ExportMenu list="supplierPerformance" query={query} disabled={!data?.items.length} />}
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <PerformanceFilters value={filters} onChange={(v) => update(v)} />
      {isPending ? (
        <LoadingState rows={5} label="Loading supplier performance" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No supplier activity in this period" description="Suppliers appear once they have purchase orders, receipts or RFQ invitations in the chosen dates." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Supplier performance">
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <SortHeader label="Score" column="score" sort={sort} onSort={onSort} help={METRIC_HELP.score} className="text-left" />
                  {COLUMNS.map((c) => <SortHeader key={c.key} label={c.label} column={c.key} sort={sort} onSort={onSort} help={METRIC_HELP[c.key]} className={c.className} />)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.supplier.id}>
                    <TableCell>
                      <Link to={`/suppliers/${row.supplier.id}?tab=performance`} className="font-medium underline-offset-4 hover:underline">{row.supplier.name}</Link>
                      {row.supplier.code && <div className="font-mono text-xs text-muted-foreground">{row.supplier.code}</div>}
                    </TableCell>
                    <TableCell><ScoreBadge score={row.score} /></TableCell>
                    {COLUMNS.map((c) => <TableCell key={c.key} className={cn('text-right font-mono', c.className)}>{c.cell(row, currency)}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
