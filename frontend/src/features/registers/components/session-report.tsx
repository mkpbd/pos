import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { varianceTone, type SessionReport } from '@/features/registers/api'
import { formatMoney } from '@/lib/money'

/** X report (open session, live figures) or Z report (closed, frozen figures). */
export function SessionReportView({ report }: { report: SessionReport }) {
  const c = report.currency
  const tone = varianceTone(report.cash.variance)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-4">
          <div><span className="text-muted-foreground">Register</span><div className="font-medium">{report.register?.name ?? '—'} · {report.branch?.name}</div></div>
          <div><span className="text-muted-foreground">Opened</span><div className="font-medium">{new Date(report.opened_at).toLocaleString()} by {report.opened_by.name ?? '—'}</div></div>
          <div>
            <span className="text-muted-foreground">Closed</span>
            <div className="font-medium">{report.closed_at ? `${new Date(report.closed_at).toLocaleString()} by ${report.closed_by?.name ?? '—'}` : 'Still open'}</div>
          </div>
          <div><span className="text-muted-foreground">Report</span><div className="font-medium">{report.status === 'open' ? 'X report (live)' : 'Z report (final)'}</div></div>
          {report.closing_notes && <div className="sm:col-span-4"><span className="text-muted-foreground">Notes</span><div>{report.closing_notes}</div></div>}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cash in the drawer</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm" aria-label="Cash reconciliation">
              <dt className="text-muted-foreground">Opening float</dt><dd className="text-right font-mono">{formatMoney(report.cash.opening_float)}</dd>
              <dt className="text-muted-foreground">Cash in</dt><dd className="text-right font-mono">+{formatMoney(report.cash.cash_in)}</dd>
              <dt className="text-muted-foreground">Cash out</dt><dd className="text-right font-mono">−{formatMoney(report.cash.cash_out)}</dd>
              <dt className="font-semibold">Expected</dt><dd className="text-right font-mono font-semibold" data-testid="expected-cash">{formatMoney(report.cash.expected, c)}</dd>
              {report.cash.counted !== null && (
                <>
                  <dt className="text-muted-foreground">Counted</dt><dd className="text-right font-mono">{formatMoney(report.cash.counted, c)}</dd>
                  <dt className="text-muted-foreground">Variance</dt>
                  <dd className="flex items-center justify-end gap-2 font-mono">
                    {formatMoney(report.cash.variance, c)}
                    {tone && <Badge variant={tone.variant}>{tone.label}</Badge>}
                  </dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By payment method</CardTitle></CardHeader>
          <CardContent>
            {report.by_method.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.by_method.map((m) => (
                    <TableRow key={m.method}>
                      <TableCell>{m.label}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(m.in)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(m.out)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatMoney(m.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {report.by_source.length > 0 && (
        <Card>
          <CardHeader><CardTitle>By transaction type</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.by_source.map((s) => (
                  <TableRow key={s.source_type}>
                    <TableCell>{s.label}</TableCell>
                    <TableCell className="text-right">{s.entries}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(s.in)}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(s.out)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Entries</CardTitle></CardHeader>
        <CardContent>
          {report.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in this session yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm whitespace-nowrap">{new Date(e.created_at).toLocaleTimeString()}</TableCell>
                      <TableCell className="text-sm">
                        {e.source_label} {e.source_number && <span className="font-mono text-xs text-muted-foreground">{e.source_number}</span>}
                        {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{e.method_label}</TableCell>
                      <TableCell className={`text-right font-mono ${e.direction === 'out' ? 'text-destructive' : ''}`}>
                        {e.direction === 'out' ? '−' : '+'}{formatMoney(e.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
