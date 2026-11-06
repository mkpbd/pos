import { useId, useState } from 'react'
import { LightbulbIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { aiEnabledFor, SEGMENT_INFO, useCustomerInsightsQuery, type CustomerInsights as CustomerInsightsData } from '@/features/ai/api'
import { AiBranchSelect, AiByline, AiOffNotice, NarrativeMissing } from '@/features/ai/components/ai-states'
import { SafeMarkdown } from '@/features/ai/components/safe-markdown'
import { useAuth } from '@/features/auth/use-auth'
import { formatDay } from '@/features/promotions/report'
import { formatDateCell } from '@/features/reports/format'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

const SEGMENT_TONE: Record<string, string> = {
  champions: 'border-l-success',
  loyal: 'border-l-success/60',
  potential: 'border-l-info',
  new: 'border-l-info/60',
  at_risk: 'border-l-warning',
  hibernating: 'border-l-muted-foreground/40',
}

const segmentLabel = (key: string) => SEGMENT_INFO[key]?.label ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** Customers tab: RFM segments over the last 12 months, top customers (masked) and loyalty suggestions. */
export function CustomerInsights() {
  const me = useAuth()
  const id = useId()
  const [branchId, setBranchId] = useState<string | null>(null)
  const { data, error, isPending, isFetching, refetch } = useCustomerInsightsQuery(branchId)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <AiBranchSelect id={`${id}-branch`} value={branchId} onChange={setBranchId} />
      </div>
      {isPending ? (
        <LoadingState rows={6} label="Loading customer insights" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className={cn('flex flex-col gap-6 transition-opacity', isFetching && 'opacity-60')} aria-busy={isFetching}>
          <CustomerBody data={data} aiOn={data.aiEnabled ?? aiEnabledFor(me)} currency={data.currency ?? me.organization?.base_currency ?? null} />
        </div>
      )}
    </div>
  )
}

function CustomerBody({ data, aiOn, currency }: { data: CustomerInsightsData; aiOn: boolean; currency: string | null }) {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const period = data.range ? `${formatDay(data.range.from)} – ${formatDay(data.range.to)}` : 'the last 12 months'
  const total = data.totalCustomers ?? data.segments.reduce((sum, s) => sum + s.count, 0)

  if (total === 0 && data.topCustomers.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No customer purchases in {period}. Segments appear once named customers buy at the till or online.
      </p>
    )
  }

  return (
    <>
      {data.narrative ? (
        <Card data-testid="customers-narrative">
          <CardHeader><CardTitle><h2>Summary</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SafeMarkdown text={data.narrative} />
            <AiByline generatedAt={data.generatedAt} />
          </CardContent>
        </Card>
      ) : !aiOn || data.narrativeStatus === 'disabled' ? (
        <AiOffNotice>Segments, top customers and suggestions below are calculated directly from purchase history.</AiOffNotice>
      ) : data.narrativeStatus === 'budget_exceeded' || data.narrativeStatus === 'unavailable' ? (
        <NarrativeMissing status={data.narrativeStatus} />
      ) : null}

      <section aria-labelledby="rfm-segments" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="rfm-segments" className="font-heading text-lg font-semibold">Customer segments</h2>
          <p className="text-sm text-muted-foreground">{total.toLocaleString('en-US')} customers who bought in {period}, by recency, frequency and spend.</p>
        </div>
        <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {data.segments.map((s) => (
            <li key={s.key}>
              <Card size="sm" className={cn('h-full border-l-4', SEGMENT_TONE[s.key] ?? 'border-l-border')} data-testid={`segment-${s.key}`}>
                <CardContent className="flex h-full flex-col gap-1">
                  <h3 className="text-sm font-semibold">{s.label}</h3>
                  <p className="font-mono text-2xl font-bold">{s.count.toLocaleString('en-US')}</p>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  {s.monetary && <p className="text-xs text-muted-foreground">Spent {formatMoney(s.monetary, currency ?? undefined)}</p>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle><h2>Top customers by segment</h2></CardTitle>
            <CardDescription>Contact details are masked; open the customer from Customers for full details.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No customers to list.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table aria-label="Top customers by segment">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Customer</TableHead>
                      <TableHead scope="col">Segment</TableHead>
                      <TableHead scope="col" className="text-right">Orders</TableHead>
                      <TableHead scope="col" className="text-right">Spend</TableHead>
                      <TableHead scope="col" className="hidden text-right sm:table-cell">Last purchase</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topCustomers.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>
                          {c.name ? <div className="font-medium">{c.name}</div> : <div className="text-muted-foreground italic">Name hidden</div>}
                          {c.phone_hint && <div className="font-mono text-xs text-muted-foreground" aria-label={`Phone ending ${c.phone_hint.replace(/\D/g, '')}`}>{c.phone_hint}</div>}
                        </TableCell>
                        <TableCell><Badge variant="outline">{segmentLabel(c.segment)}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{c.orders ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatMoney(c.spend)}</TableCell>
                        <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">
                          {c.last_purchase_at ? formatDateCell(c.last_purchase_at.slice(0, 10), timeZone) : c.recency_days !== null ? `${c.recency_days} days ago` : '—'}
                        </TableCell>
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
            <CardTitle><h2>Loyalty suggestions</h2></CardTitle>
            <CardDescription>Rule-based ideas for each segment.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suggestions right now.</p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="loyalty-suggestions">
                {data.suggestions.map((s) => (
                  <li key={s.key} className="flex gap-2 text-sm">
                    <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="flex flex-col gap-0.5">
                      <span>{s.text}</span>
                      {(s.segment || s.count !== null) && (
                        <span className="text-xs text-muted-foreground">
                          {s.segment ? segmentLabel(s.segment) : ''}
                          {s.segment && s.count !== null ? ' · ' : ''}
                          {s.count !== null ? `${s.count.toLocaleString('en-US')} ${s.count === 1 ? 'customer' : 'customers'}` : ''}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
