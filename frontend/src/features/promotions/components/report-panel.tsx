import { useState, type ReactNode } from 'react'
import { ExportMenu } from '@/components/common/export-menu'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { usePromotionReportQuery, type Promotion } from '@/features/promotions/api'
import { defaultReportRange, formatDay, rangeError } from '@/features/promotions/report'
import { formatMoney } from '@/lib/money'

function Kpi({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold" data-testid={testId}>{children}</dd>
    </div>
  )
}

/** How the offer performed over a date range: totals and a per-day table (organization-timezone days). */
export function ReportPanel({ promotion }: { promotion: Promotion }) {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const [range, setRange] = useState(() => defaultReportRange(timeZone))
  const invalid = rangeError(range.from, range.to)
  const report = usePromotionReportQuery(promotion.id, { date_from: range.from, date_to: range.to }, !invalid)
  const data = report.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report</CardTitle>
        <CardDescription>Redemptions, discount given and the revenue of the orders that got this offer. Days follow the organization's timezone.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-from">From</Label>
            <Input id="report-from" type="date" className="w-40" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-to">To</Label>
            <Input id="report-to" type="date" className="w-40" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <div className="ml-auto">
            <ExportMenu
              list="promotionReport"
              pathParams={{ id: promotion.id }}
              query={{ date_from: range.from, date_to: range.to }}
              disabled={!!invalid || !data || data.by_day.length === 0}
            />
          </div>
        </div>

        {invalid ? (
          <p role="alert" className="text-sm text-destructive">{invalid}</p>
        ) : report.isPending ? (
          <LoadingState rows={3} label="Loading report" />
        ) : report.error ? (
          <ErrorState error={report.error} onRetry={() => report.refetch()} />
        ) : data ? (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Report totals">
              <Kpi label="Redemptions" testId="kpi-redemptions">{data.redemptions}</Kpi>
              <Kpi label="Orders" testId="kpi-orders">{data.orders}</Kpi>
              <Kpi label="Discount given" testId="kpi-discount">{formatMoney(data.discount_total, currency)}</Kpi>
              <Kpi label="Order revenue" testId="kpi-revenue">{formatMoney(data.order_revenue, currency)}</Kpi>
              <Kpi label="Average discount" testId="kpi-average">{data.average_discount ? formatMoney(data.average_discount, currency) : '—'}</Kpi>
            </dl>
            {data.by_day.length === 0 ? (
              <EmptyState title="No redemptions in this period" description="Try a wider date range." />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table aria-label="Redemptions per day">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Redemptions</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_day.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="whitespace-nowrap"><time dateTime={d.date}>{formatDay(d.date)}</time></TableCell>
                        <TableCell className="text-right tabular-nums">{d.redemptions}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(d.discount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{data.redemptions}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatMoney(data.discount_total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
