import { useId, useState } from 'react'
import { Link } from 'react-router'
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, MinusIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { aiEnabledFor, useInsightsQuery, type InsightKpi, type InsightPeriod, type Insights } from '@/features/ai/api'
import { AiBranchSelect, AiByline, AiOffNotice, NarrativeMissing } from '@/features/ai/components/ai-states'
import { SafeMarkdown } from '@/features/ai/components/safe-markdown'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { formatDay } from '@/features/promotions/report'
import { changeDirection, formatChange, formatDateCell, formatQuantity, percentChange } from '@/features/reports/format'
import { formatRate } from '@/features/supplier-performance/performance'
import { formatMoney, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

const PERIODS: { value: InsightPeriod; label: string; description: string }[] = [
  { value: 'daily', label: 'Daily', description: 'Yesterday compared with the day before' },
  { value: 'monthly', label: 'Monthly', description: 'This month so far compared with last month' },
]

const rangeText = (r: { from: string; to: string } | null) => (r ? (r.from === r.to ? formatDay(r.from) : `${formatDay(r.from)} – ${formatDay(r.to)}`) : null)

/** Business insights tab: deterministic facts (always), plus the AI narrative when AI is on. */
export function BusinessInsights() {
  const me = useAuth()
  const id = useId()
  const [period, setPeriod] = useState<InsightPeriod>('daily')
  const [branchId, setBranchId] = useState<string | null>(null)
  const { data, error, isPending, isFetching, refetch } = useInsightsQuery(period, branchId)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-period`} className="text-sm leading-none font-medium">Period</span>
          <div role="group" aria-labelledby={`${id}-period`} className="inline-flex rounded-lg bg-muted p-[3px]">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                type="button"
                size="sm"
                variant={period === p.value ? 'default' : 'ghost'}
                aria-pressed={period === p.value}
                title={p.description}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <AiBranchSelect id={`${id}-branch`} value={branchId} onChange={setBranchId} />
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading insights" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className={cn('flex flex-col gap-6 transition-opacity', isFetching && 'opacity-60')} aria-busy={isFetching}>
          <InsightsBody data={data} aiOn={data.aiEnabled ?? aiEnabledFor(me)} currency={data.facts.currency ?? me.organization?.base_currency ?? null} />
        </div>
      )}
    </div>
  )
}

function InsightsBody({ data, aiOn, currency }: { data: Insights; aiOn: boolean; currency: string | null }) {
  const me = useAuth()
  const can = useCan()
  const { facts } = data
  const money = (v: string | null) => formatMoney(v, currency ?? undefined)
  const current = rangeText(facts.range)
  const previous = rangeText(facts.previousRange)
  const shortage = facts.shortageRisk
  const slow = facts.slowMovers

  return (
    <>
      <section aria-labelledby="insights-summary">
        <h2 id="insights-summary" className="sr-only">Summary</h2>
        {data.narrative ? (
          <Card data-testid="insights-narrative">
            <CardHeader>
              <CardTitle><h3>Summary{current ? ` · ${current}` : ''}</h3></CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SafeMarkdown text={data.narrative} />
              <AiByline generatedAt={data.generatedAt} />
            </CardContent>
          </Card>
        ) : !aiOn || data.narrativeStatus === 'disabled' ? (
          <AiOffNotice />
        ) : (
          <NarrativeMissing status={data.narrativeStatus} />
        )}
      </section>

      <section aria-labelledby="insights-kpis" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="insights-kpis" className="font-heading text-lg font-semibold">Key figures</h2>
          {current && <p className="text-sm text-muted-foreground">{current}{previous ? ` vs ${previous}` : ''}</p>}
        </div>
        {facts.kpis.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales were recorded in this period.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
            {facts.kpis.map((kpi) => <KpiTile key={kpi.key} kpi={kpi} currency={currency} />)}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><h2>Unusual days</h2></CardTitle>
            <CardDescription>Days whose net sales were far from the trailing 28-day average (|z| ≥ 2.5; needs 14 days of history).</CardDescription>
          </CardHeader>
          <CardContent>
            {facts.anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unusual days — sales stayed within the normal range (or there is not enough history yet).</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="insights-anomalies">
                {facts.anomalies.map((a) => (
                  <li key={a.date} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">{formatDay(a.date)}</span>
                      <span className="text-xs text-muted-foreground">
                        Net sales {money(a.net_sales)}{a.mean ? ` vs typical ${money(a.mean)}` : ''}{a.z_score ? ` · z = ${trimDecimal(roundTo(a.z_score, 1))}` : ''}
                      </span>
                    </div>
                    <Badge variant={a.direction === 'high' ? 'success' : 'warning'}>{a.direction === 'high' ? 'Unusually high' : 'Unusually low'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle><h2>Margins and returns</h2></CardTitle>
            <CardDescription>Drops in gross margin and spikes in returns compared with the previous period.</CardDescription>
          </CardHeader>
          <CardContent>
            {facts.signals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No margin drops or return spikes in this period.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="insights-signals">
                {facts.signals.map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.kind === 'margin' ? 'Margin' : 'Return rate'} {formatRate(s.value)}{s.previous ? ` (was ${formatRate(s.previous)})` : ''}
                        {s.amount ? ` · ${money(s.amount)} returned` : ''}
                      </span>
                    </div>
                    <Badge variant="warning">{s.kind === 'margin' ? 'Margin drop' : 'Return spike'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {facts.topMovers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle><h2>Top movers</h2></CardTitle>
            <CardDescription>Products whose net sales rose or fell the most against the previous period.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Top movers">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Product</TableHead>
                    <TableHead scope="col" className="text-right">Net sales</TableHead>
                    <TableHead scope="col" className="hidden text-right sm:table-cell">Previous</TableHead>
                    <TableHead scope="col" className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facts.topMovers.map((m) => {
                    const change = m.change_pct ?? percentChange(m.net_sales, m.previous)
                    return (
                      <TableRow key={m.key}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatMoney(m.net_sales)}</TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{formatMoney(m.previous)}</TableCell>
                        <TableCell className="text-right">
                          {change === null && m.direction === 'up' ? <Badge variant="info">New</Badge> : <Change change={change} />}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className={cn('grid gap-6', shortage && 'xl:grid-cols-2')}>
        {/* Shortage risk comes from purchasing data: the server leaves it out without purchases.view. */}
        {shortage && (
          <Card>
            <CardHeader>
              <CardTitle><h2>Shortage risk</h2></CardTitle>
              <CardDescription>Stock that runs out before a new delivery could arrive (days of cover below the supplier lead time).</CardDescription>
              {can('purchases.view') && shortage.items.length > 0 && (
                <CardAction>
                  <Button asChild variant="outline" size="sm"><Link to="/purchasing/reorder">Reorder <ArrowRightIcon data-icon="inline-end" /></Link></Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {shortage.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing is at risk of running out before it can be restocked.</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-md border">
                    <Table aria-label="Shortage risk">
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Product</TableHead>
                          <TableHead scope="col" className="text-right">Cover</TableHead>
                          <TableHead scope="col" className="text-right">Lead time</TableHead>
                          <TableHead scope="col" className="hidden text-right sm:table-cell">Suggested buy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shortage.items.map((r) => (
                          <TableRow key={r.key}>
                            <TableCell>
                              <div className="font-medium">{r.name}</div>
                              <div className="text-xs text-muted-foreground">{[r.sku, r.store, r.supplier].filter(Boolean).join(' · ')}</div>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">{r.days_of_cover !== null ? `${trimDecimal(roundTo(r.days_of_cover, 1))} d` : '—'}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">{r.lead_time_days !== null ? `${r.lead_time_days} d` : '—'}</TableCell>
                            <TableCell className="hidden text-right font-mono sm:table-cell">{r.suggested_purchase ? formatQuantity(r.suggested_purchase) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {shortage.count > shortage.items.length && <p className="text-xs text-muted-foreground">Showing {shortage.items.length} of {shortage.count} items most at risk.</p>}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle><h2>Slow movers</h2></CardTitle>
            <CardDescription>Products in stock with no sales in the last {slow.days} days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {slow.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everything in stock sold at least once in the last {slow.days} days.</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <Table aria-label="Slow movers">
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Product</TableHead>
                        <TableHead scope="col" className="text-right">On hand</TableHead>
                        {slow.items.some((r) => r.stock_value !== null) && <TableHead scope="col" className="text-right">Stock value</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {slow.items.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell>
                            <div className="font-medium">{r.name}</div>
                            {r.variants_in_stock !== null && r.variants_in_stock > 1 && <div className="text-xs text-muted-foreground">{r.variants_in_stock} variants in stock</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatQuantity(r.on_hand)}</TableCell>
                          {slow.items.some((x) => x.stock_value !== null) && <TableCell className="text-right font-mono tabular-nums">{formatMoney(r.stock_value)}</TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {slow.count > slow.items.length && <p className="text-xs text-muted-foreground">Showing {slow.items.length} of {slow.count} slow movers.</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {data.generatedAt && <p className="text-xs text-muted-foreground">Figures calculated {formatDateCell(data.generatedAt, me.organization?.timezone)}.</p>}
    </>
  )
}

/** Rounds a decimal string to `places` (half away from zero) without floats. */
function roundTo(value: string, places: number): string {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) return value
  const [, sign = '', integer = '0', fraction = ''] = match
  const digits = BigInt(integer + (fraction + '0'.repeat(places + 1)).slice(0, places + 1))
  const rounded = (digits + 5n) / 10n
  const text = rounded.toString().padStart(places + 1, '0')
  const out = places > 0 ? `${text.slice(0, -places)}.${text.slice(-places)}` : text
  return `${sign}${out}`
}

function Change({ change, inverse = false }: { change: string | null; inverse?: boolean }) {
  const direction = changeDirection(change)
  if (direction === null) return <span className="text-muted-foreground">—</span>
  const good = direction === 'flat' ? null : (direction === 'up') !== inverse
  const Icon = direction === 'up' ? ArrowUpRightIcon : direction === 'down' ? ArrowDownRightIcon : MinusIcon
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold', good === true && 'text-success-soft-foreground', good === false && 'text-destructive-soft-foreground')}>
      <Icon className="size-3.5" aria-hidden />
      {formatChange(change)}
    </span>
  )
}

function KpiTile({ kpi, currency }: { kpi: InsightKpi; currency: string | null }) {
  const format = (v: string | null) => (v === null ? '—' : kpi.kind === 'money' ? formatMoney(v, currency ?? undefined) : kpi.kind === 'percent' ? formatRate(v) : formatQuantity(v))
  const change = kpi.change ?? (kpi.kind === 'percent' ? null : percentChange(kpi.value, kpi.previous))
  return (
    <li>
      <Card size="sm" className="h-full" data-testid={`insight-kpi-${kpi.key}`}>
        <CardContent className="flex h-full flex-col gap-1.5">
          <h3 className="text-xs font-bold tracking-[0.08rem] text-heading uppercase">{kpi.label}</h3>
          <p className="font-mono text-xl font-bold">{format(kpi.value)}</p>
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {change !== null && <Change change={change} inverse={kpi.inverse} />}
            <span>{kpi.previous !== null ? `${change !== null ? 'vs ' : 'Previous: '}${format(kpi.previous)}` : 'No earlier figures to compare'}</span>
          </p>
        </CardContent>
      </Card>
    </li>
  )
}
