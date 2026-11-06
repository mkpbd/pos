import { useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { useSupplierPerformanceQuery, type PerformanceMetrics } from '@/features/supplier-performance/api'
import { PerformanceFilters, type FilterValues } from '@/features/supplier-performance/components/performance-filters'
import { ScoreBadge } from '@/features/supplier-performance/components/score-badge'
import { defaultPerformanceRange, formatDays, formatMonth, formatPriceChange, formatRate, METRIC_HELP } from '@/features/supplier-performance/performance'
import { formatMoney, trimDecimal } from '@/lib/money'

function Kpi({ label, value, help, testId }: { label: string; value: string; help: string; testId?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground" title={help}>{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold" data-testid={testId}>{value}</dd>
    </div>
  )
}

function KpiCards({ metrics, currency }: { metrics: PerformanceMetrics; currency?: string }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Performance indicators">
      <div className="rounded-lg border p-3">
        <dt className="text-xs text-muted-foreground" title={METRIC_HELP.score}>Score</dt>
        <dd className="mt-1"><ScoreBadge score={metrics.score} /></dd>
      </div>
      <Kpi label="On-time delivery" value={formatRate(metrics.on_time_rate)} help={METRIC_HELP.on_time_rate} testId="kpi-on-time" />
      <Kpi label="Fill rate" value={formatRate(metrics.fill_rate)} help={METRIC_HELP.fill_rate} testId="kpi-fill" />
      <Kpi label="Average lead time" value={formatDays(metrics.avg_lead_days)} help={METRIC_HELP.avg_lead_days} />
      <Kpi label="Return rate" value={formatRate(metrics.return_rate)} help={METRIC_HELP.return_rate} />
      <Kpi label="Price change" value={formatPriceChange(metrics.price_change_pct)} help={METRIC_HELP.price_change_pct} />
      <Kpi label="Quote response" value={`${formatRate(metrics.quote_response_rate)}${metrics.quotes_won ? ` · ${metrics.quotes_won} won` : ''}`} help={METRIC_HELP.quote_response_rate} />
      <Kpi label={`Spend · ${metrics.orders} ${metrics.orders === 1 ? 'order' : 'orders'}`} value={formatMoney(metrics.spend, currency)} help={METRIC_HELP.spend} testId="kpi-spend" />
    </dl>
  )
}

/** Supplier page → Performance: KPI cards for the period, a 12-month trend and late or short deliveries. */
export function SupplierPerformanceTab({ supplierId }: { supplierId: string }) {
  const me = useAuth()
  const [filters, setFilters] = useState<FilterValues>(() => ({ ...defaultPerformanceRange(me.organization?.timezone), branch_id: '' }))
  const { data, error, isPending, refetch } = useSupplierPerformanceQuery(supplierId, filters)
  const currency = data?.currency ?? me.organization?.base_currency

  return (
    <div className="flex flex-col gap-6">
      <PerformanceFilters value={filters} onChange={setFilters} />
      {isPending ? (
        <LoadingState rows={4} label="Loading performance" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <KpiCards metrics={data.metrics} currency={currency} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Last 12 months</CardTitle>
                <CardDescription>Orders, spend, on-time delivery and fill rate per month.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.trend.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No purchases in the last 12 months.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table aria-label="Monthly trend">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Month</TableHead>
                          <TableHead className="hidden text-right sm:table-cell">Orders</TableHead>
                          <TableHead className="text-right">Spend</TableHead>
                          <TableHead className="text-right">On time</TableHead>
                          <TableHead className="text-right">Fill rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.trend.map((m) => (
                          <TableRow key={m.month}>
                            <TableCell className="text-sm">{formatMonth(m.month)}</TableCell>
                            <TableCell className="hidden text-right font-mono sm:table-cell">{m.orders ?? '—'}</TableCell>
                            <TableCell className="text-right font-mono">{formatMoney(m.spend)}</TableCell>
                            <TableCell className="text-right font-mono">{formatRate(m.on_time_rate)}</TableCell>
                            <TableCell className="text-right font-mono">{formatRate(m.fill_rate)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Late and short deliveries</CardTitle>
                <CardDescription>Recent purchase orders received after the expected date or not in full.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.problem_deliveries.length === 0 ? (
                  <EmptyState title="No late or short deliveries" />
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table aria-label="Late and short deliveries">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead className="hidden sm:table-cell">Expected</TableHead>
                          <TableHead>Received</TableHead>
                          <TableHead className="text-right">Late</TableHead>
                          <TableHead className="text-right">Short</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.problem_deliveries.map((d) => (
                          <TableRow key={d.purchase_order.id}>
                            <TableCell><Link to={`/purchasing/orders/${d.purchase_order.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{d.purchase_order.number}</Link></TableCell>
                            <TableCell className="hidden text-sm sm:table-cell">{d.expected_date ?? '—'}</TableCell>
                            <TableCell className="text-sm">{d.received_date ?? 'Not yet'}</TableCell>
                            <TableCell className="text-right font-mono">{d.days_late ? `${d.days_late} d` : '—'}</TableCell>
                            <TableCell className="text-right font-mono">{d.short_quantity && !/^0*(\.0*)?$/.test(d.short_quantity) ? trimDecimal(d.short_quantity) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
