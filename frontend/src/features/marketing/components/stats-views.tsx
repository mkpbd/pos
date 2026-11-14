import { useState } from 'react'
import { EyeIcon, PercentIcon, ReceiptIcon, ShoppingBagIcon, WalletIcon, type LucideIcon } from 'lucide-react'
import { TrendChart } from '@/components/common/charts/trend-chart'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DayRow, LandingPageRow, MarketingStats, SourceRow } from '@/features/marketing/api'
import { formatCount, formatPercent, sourceLabel, STATS_METRICS, type StatsMetric } from '@/features/marketing/marketing'
import { formatQuantity, longAxisLabel, shortAxisLabel } from '@/features/reports/format'
import { formatMoney } from '@/lib/money'

type Tile = { key: string; label: string; icon: LucideIcon; value: string; currency?: string | null; detail: string; hint?: string }

/** Headline figures of the range: plain numbers with one line of context each (no colour coding). */
export function StatTiles({ stats }: { stats: MarketingStats }) {
  const t = stats.totals
  const cancelled = t.cancelled_orders ?? 0
  const tiles: Tile[] = [
    { key: 'visits', label: 'Visits', icon: EyeIcon, value: formatCount(t.visits), detail: `${formatCount(t.unique_visitors)} different visitors` },
    {
      key: 'orders',
      label: 'Orders',
      icon: ShoppingBagIcon,
      value: formatCount(t.orders),
      detail: `${formatQuantity(String(t.items))} items${cancelled > 0 ? ` · ${formatCount(cancelled)} cancelled not counted` : ''}`,
    },
    { key: 'revenue', label: 'Revenue', icon: WalletIcon, value: formatMoney(t.revenue), currency: stats.currency, detail: 'Order totals, cancelled orders left out' },
    {
      key: 'conversion',
      label: 'Conversion rate',
      icon: PercentIcon,
      value: formatPercent(t.conversion_rate),
      detail: t.conversion_rate === null ? 'No visitors yet' : 'Orders for every 100 visitors',
      hint: 'Orders divided by different visitors.',
    },
    {
      key: 'aov',
      label: 'Average order',
      icon: ReceiptIcon,
      value: t.average_order_value === null ? '—' : formatMoney(t.average_order_value),
      currency: t.average_order_value === null ? null : stats.currency,
      detail: t.average_order_value === null ? 'No orders yet' : 'Revenue per order',
    },
  ]

  return (
    <section aria-label="Key figures">
      <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Card size="sm" className="h-full" data-testid={`stat-${tile.key}`}>
              <CardContent className="flex h-full flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-bold tracking-[0.08rem] text-heading uppercase" title={tile.hint}>{tile.label}</h3>
                  <tile.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </div>
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-foreground">
                  {tile.currency && <span className="text-xs font-medium text-muted-foreground">{tile.currency}</span>}
                  <span className="font-mono text-xl font-bold whitespace-nowrap">{tile.value}</span>
                </p>
                <p className="text-xs text-muted-foreground">{tile.detail}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}

const metricValue = (row: DayRow, metric: StatsMetric) => (metric === 'revenue' ? row.revenue : row[metric])

/**
 * One measure per day on one axis: the owner switches between visits, orders and revenue
 * (different scales never share a chart). The table underneath has every figure.
 */
export function DayChart({ days, currency }: { days: DayRow[]; currency: string | null }) {
  const [metric, setMetric] = useState<StatsMetric>('visits')
  const label = STATS_METRICS.find((m) => m.key === metric)?.label ?? metric
  const title = `${label} by day`
  const format = (v: string) => (metric === 'revenue' ? formatMoney(v, currency ?? undefined) : formatCount(v))

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle><h2>By day</h2></CardTitle>
          <CardDescription>Every day of the period, including days without visits.</CardDescription>
        </div>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as StatsMetric)}>
          <TabsList aria-label="Figure shown in the chart">
            {STATS_METRICS.map((m) => <TabsTrigger key={m.key} value={m.key}>{m.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TrendChart
          key={metric}
          title={title}
          variant="area"
          height={200}
          xHeader="Day"
          series={[{ key: 'value', label }]}
          data={days.map((d) => ({ key: d.date, label: shortAxisLabel(d.date), longLabel: longAxisLabel(d.date), values: { value: metricValue(d, metric) } }))}
          formatValue={format}
          emptyText="No days in this period."
        />
        <details className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Day-by-day table</summary>
          <div className="max-h-96 overflow-auto border-t">
            <Table aria-label="Figures by day">
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Different visitors</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="whitespace-nowrap">{longAxisLabel(d.date)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(d.visits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(d.unique_visitors)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(d.orders)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(d.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

export function SourcesCard({ rows }: { rows: SourceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Where visitors came from</h2></CardTitle>
        <CardDescription>The source and medium in the link they clicked (for example facebook / paid).</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visits or orders in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Visits and orders by source">
              <TableHeader>
                <TableRow>
                  <TableHead>Source / medium</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.source ?? ''}|${r.medium ?? ''}`}>
                    <TableCell className={r.source || r.medium ? 'font-medium' : 'text-muted-foreground'}>{sourceLabel(r.source, r.medium)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(r.visits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(r.orders)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(r.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function LandingPagesCard({ rows }: { rows: LandingPageRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Top landing pages</h2></CardTitle>
        <CardDescription>The first page visitors opened on the store.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visits in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Top landing pages">
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.path}>
                    <TableCell className="font-mono text-xs break-all">{r.path}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(r.visits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(r.orders)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(r.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
