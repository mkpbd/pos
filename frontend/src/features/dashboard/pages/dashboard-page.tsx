import { Link, useSearchParams } from 'react-router'
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, BanknoteIcon, MinusIcon, PackageXIcon, ReceiptTextIcon, ShoppingBagIcon, TrendingUpIcon, Undo2Icon, WalletIcon, type LucideIcon } from 'lucide-react'
import { BarChart } from '@/components/common/charts/bar-chart'
import { SERIES_COLORS } from '@/components/common/charts/chart-utils'
import { TrendChart } from '@/components/common/charts/trend-chart'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useDashboardQuery, type Dashboard, type Kpi, type KpiKey } from '@/features/dashboard/api'
import { formatDay } from '@/features/promotions/report'
import { DateRangeFilter } from '@/features/reports/components/date-range-filter'
import { changeDirection, formatChange, formatDateCell, formatQuantity, longAxisLabel, percentChange, shortAxisLabel } from '@/features/reports/format'
import { presetRange, type DatePreset } from '@/features/reports/params'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

const DASHBOARD_PRESETS: readonly DatePreset[] = ['today', 'yesterday', 'this_week', 'last_30_days', 'this_month', 'last_month', 'this_year']
const ALL = '__all__'

type KpiSpec = { key: KpiKey; label: string; icon: LucideIcon; kind: 'money' | 'count'; /** An increase is bad news (returns). */ inverse?: boolean; hint: string; cost?: boolean }

const KPIS: KpiSpec[] = [
  { key: 'total_sales', label: 'Net sales', icon: BanknoteIcon, kind: 'money', hint: 'POS and delivered online orders, after discounts and returns, excluding tax.' },
  { key: 'today_revenue', label: "Today's revenue", icon: WalletIcon, kind: 'money', hint: 'Net sales today, compared with yesterday.' },
  { key: 'orders_count', label: 'Orders', icon: ReceiptTextIcon, kind: 'count', hint: 'POS sales plus delivered web orders.' },
  { key: 'gross_profit', label: 'Gross profit', icon: TrendingUpIcon, kind: 'money', cost: true, hint: 'Net sales minus the cost of goods sold.' },
  { key: 'average_ticket', label: 'Average ticket', icon: ShoppingBagIcon, kind: 'money', hint: 'Net sales per order.' },
  { key: 'returns_amount', label: 'Returns', icon: Undo2Icon, kind: 'money', inverse: true, hint: 'POS returns and online refunds in the period.' },
]

const rangeText = (r: { from: string; to: string } | null) => (r ? (r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`) : null)

/** / (for roles with dashboard.view) and /dashboard — the organization's day and period at a glance. */
export function DashboardPage() {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const [search, setSearch] = useSearchParams()
  const fallback = presetRange('last_30_days', timeZone)
  const from = search.get('date_from') || fallback.from
  const to = search.get('date_to') || fallback.to
  const branchId = search.get('branch_id') ?? ''
  const query = { date_from: from, date_to: to, ...(branchId ? { branch_id: branchId } : {}) }
  const { data, error, isPending, isFetching, refetch } = useDashboardQuery(query)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setSearch(next, { replace: true })
  }
  const canReports = can('reports.view') || can('reports.financial')
  const branchName = branchId ? me.branches.find((b) => b.id === branchId)?.name : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={`Sales and stock ${branchName ? `for ${branchName}` : me.branches.length > 1 ? 'across your branches' : 'at a glance'}.`}
        actions={canReports ? <Button asChild variant="outline"><Link to="/reports">All reports <ArrowRightIcon data-icon="inline-end" /></Link></Button> : undefined}
      />
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Dashboard filters">
        <DateRangeFilter key={`${from}|${to}`} idPrefix="dashboard" from={from} to={to} timeZone={timeZone} presets={DASHBOARD_PRESETS} onChange={(r) => update({ date_from: r.from, date_to: r.to })} />
        {me.branches.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-branch">Branch</Label>
            <Select value={branchId || ALL} onValueChange={(v) => update({ branch_id: v === ALL ? null : v })}>
              <SelectTrigger id="dashboard-branch" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {me.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading dashboard" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className={cn('flex flex-col gap-6 transition-opacity', isFetching && 'opacity-60')} aria-busy={isFetching}>
          <DashboardBody data={data} currency={data.currency ?? me.organization?.base_currency ?? null} />
        </div>
      )}
    </div>
  )
}

function DashboardBody({ data, currency }: { data: Dashboard; currency: string | null }) {
  const can = useCan()
  const canCost = can('products.view_cost')
  const kpis = KPIS.filter((k) => {
    const kpi = data.kpis[k.key]
    if (!kpi) return false
    return !k.cost || (canCost && kpi.value !== null)
  })
  const previous = rangeText(data.previousRange)
  const money = (v: string) => formatMoney(v, currency ?? undefined)
  const hasSplit = data.trend.some((p) => p.pos !== null || p.online !== null)

  return (
    <>
      <section aria-label="Key figures">
        <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
          {kpis.map((spec) => <KpiCard key={spec.key} spec={spec} kpi={data.kpis[spec.key] as Kpi} currency={currency} previousLabel={spec.key === 'today_revenue' ? 'yesterday' : previous ? `previous period (${previous})` : 'previous period'} />)}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle><h2>Sales trend</h2></CardTitle>
            <CardDescription>{hasSplit ? 'Daily net sales, POS and online stacked.' : 'Daily net sales.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart
              title="Daily net sales"
              variant="area"
              stacked={hasSplit}
              data={data.trend.map((p) => ({ key: p.date, label: shortAxisLabel(p.date), longLabel: longAxisLabel(p.date), values: { pos: p.pos, online: p.online, net_sales: p.net_sales, orders: p.orders } }))}
              series={hasSplit ? [{ key: 'pos', label: 'POS' }, { key: 'online', label: 'Online' }] : [{ key: 'net_sales', label: 'Net sales' }]}
              total={hasSplit ? { key: 'net_sales', label: 'Net sales' } : undefined}
              formatValue={money}
              emptyText="No sales in this period."
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle><h2>Sales by channel</h2></CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                title="Net sales by channel"
                categoryHeader="Channel"
                valueHeader="Net sales"
                formatValue={money}
                data={data.byChannel.map((c, i) => ({
                  key: c.channel,
                  label: c.label,
                  value: c.net_sales,
                  color: c.channel === 'pos' ? SERIES_COLORS[0] : c.channel === 'online' ? SERIES_COLORS[1] : SERIES_COLORS[i % SERIES_COLORS.length],
                  details: c.orders !== null ? [{ label: 'Orders', value: c.orders.toLocaleString('en-US') }] : undefined,
                }))}
                emptyText="No sales in this period."
              />
            </CardContent>
          </Card>
          {data.byBranch && data.byBranch.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle><h2>Sales by branch</h2></CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart
                  title="Net sales by branch"
                  categoryHeader="Branch"
                  valueHeader="Net sales"
                  formatValue={money}
                  data={data.byBranch.map((b) => ({ key: b.id, label: b.name, value: b.net_sales, details: b.orders !== null ? [{ label: 'Orders', value: b.orders.toLocaleString('en-US') }] : undefined }))}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <TopProductsCard data={data} money={money} />
        <LowStockCard data={data} />
        <RecentCard data={data} currency={currency} />
      </div>
    </>
  )
}

function KpiCard({ spec, kpi, currency, previousLabel }: { spec: KpiSpec; kpi: Kpi; currency: string | null; previousLabel: string }) {
  const format = (v: string | null) => (spec.kind === 'money' ? formatMoney(v, currency ?? undefined) : v === null ? '—' : formatQuantity(v))
  const figure = spec.kind === 'money' ? formatMoney(kpi.value) : format(kpi.value)
  const change = kpi.change ?? percentChange(kpi.value, kpi.previous)
  const direction = changeDirection(change)
  const good = direction === 'flat' || direction === null ? null : (direction === 'up') !== !!spec.inverse
  const Icon = direction === 'up' ? ArrowUpRightIcon : direction === 'down' ? ArrowDownRightIcon : MinusIcon
  const previous = kpi.previous !== null ? `${format(kpi.previous)} ${previousLabel}` : null

  return (
    <li>
      <Card size="sm" className="h-full" data-testid={`kpi-${spec.key}`}>
        <CardContent className="flex h-full flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-xs font-bold tracking-[0.08rem] text-heading uppercase" title={spec.hint}>{spec.label}</h3>
            <spec.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-foreground" aria-label={format(kpi.value)}>
            {spec.kind === 'money' && currency && kpi.value !== null && <span className="text-xs font-medium text-muted-foreground" aria-hidden>{currency}</span>}{' '}
            <span className="font-mono text-xl font-bold whitespace-nowrap" aria-hidden>{figure}</span>
          </p>
          {change !== null ? (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className={cn('inline-flex items-center gap-0.5 font-semibold', good === true && 'text-success-soft-foreground', good === false && 'text-destructive-soft-foreground')}>
                <Icon className="size-3.5" aria-hidden />
                {formatChange(change)}
              </span>
              <span>vs {previousLabel.startsWith('previous') ? 'previous period' : previousLabel}</span>
              {previous && <span className="sr-only">({previous})</span>}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{kpi.previous !== null ? `${format(kpi.previous)} ${previousLabel}` : 'No earlier figures to compare'}</p>
          )}
        </CardContent>
      </Card>
    </li>
  )
}

function TopProductsCard({ data, money }: { data: Dashboard; money: (v: string) => string }) {
  const can = useCan()
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Top products</h2></CardTitle>
        <CardDescription>By net sales in the period.</CardDescription>
        {(can('reports.view') || can('reports.financial')) && (
          <CardAction><Button asChild variant="link" size="sm" className="px-0"><Link to="/reports/sales_by_product">Full report</Link></Button></CardAction>
        )}
      </CardHeader>
      <CardContent>
        <BarChart
          title="Top products by net sales"
          categoryHeader="Product"
          valueHeader="Net sales"
          formatValue={money}
          data={data.topProducts.map((p) => ({ key: p.key, label: p.name, value: p.net_sales, details: [{ label: 'Quantity', value: formatQuantity(p.quantity) }, ...(p.orders !== null ? [{ label: 'Orders', value: p.orders.toLocaleString('en-US') }] : []), ...(p.sku ? [{ label: 'SKU', value: p.sku }] : [])] }))}
          emptyText="No products sold in this period."
        />
      </CardContent>
    </Card>
  )
}

function LowStockCard({ data }: { data: Dashboard }) {
  const can = useCan()
  const canReorder = can('purchases.view')
  const { count, items } = data.lowStock
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Low stock</h2></CardTitle>
        <CardDescription>{count === 0 ? 'Everything is above its reorder point.' : `${count.toLocaleString('en-US')} ${count === 1 ? 'item is' : 'items are'} at or below the reorder point.`}</CardDescription>
        {canReorder && count > 0 && (
          <CardAction><Button asChild variant="link" size="sm" className="px-0"><Link to="/purchasing/reorder">Reorder</Link></Button></CardAction>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><PackageXIcon className="size-4" aria-hidden /> No low stock.</p>
        ) : (
          <ul className="flex flex-col divide-y" aria-label="Low stock items">
            {items.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[item.sku, item.store].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right">
                  <Badge variant={/^-|^0*(\.0*)?$/.test(item.on_hand) ? 'destructive' : 'warning'} className="font-mono">{formatQuantity(item.on_hand)} on hand</Badge>
                  {item.reorder_point !== null && <span className="block text-xs text-muted-foreground">reorder at {formatQuantity(item.reorder_point)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canReorder && count > 0 && (
          <Button asChild variant="outline" size="sm" className="mt-4 w-full"><Link to="/purchasing/reorder">Open reorder suggestions</Link></Button>
        )}
      </CardContent>
    </Card>
  )
}

function RecentCard({ data, currency }: { data: Dashboard; currency: string | null }) {
  const me = useAuth()
  const can = useCan()
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Recent transactions</h2></CardTitle>
        <CardDescription>Latest POS sales and web orders.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y" aria-label="Recent transactions">
            {data.recent.map((t) => {
              const href = t.kind === 'sale' ? (can('sales.view') && t.id ? `/sales/${t.id}` : null) : can('web_orders.view') && t.id ? `/web-orders/${t.id}` : null
              const label = t.kind === 'sale' ? 'POS sale' : 'Web order'
              return (
                <li key={t.key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {href ? (
                        <Link to={href} className="truncate font-mono text-sm font-medium underline-offset-4 hover:underline" aria-label={`${label} ${t.number}`}>{t.number}</Link>
                      ) : (
                        <span className="truncate font-mono text-sm font-medium">{t.number}</span>
                      )}
                      <Badge variant={t.kind === 'sale' ? 'soft' : 'info'}>{t.kind === 'sale' ? 'POS' : 'Online'}</Badge>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{[t.customer, t.at ? formatDateCell(t.at, me.organization?.timezone) : null, t.status?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm">{formatMoney(t.total, currency ?? undefined)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
