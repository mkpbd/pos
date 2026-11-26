import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SessionReport } from '@/features/registers/api'

/**
 * POS1d: "No-sale openings: N" — each time the cash drawer was opened without a sale in the
 * session, who opened it, why, and the manager who approved it by PIN.
 */
export function NoSaleOpeningsCard({ report }: { report: Pick<SessionReport, 'no_sale_count' | 'no_sale_openings'> }) {
  if (report.no_sale_count === undefined) return null
  const openings = report.no_sale_openings ?? []

  return (
    <Card role="region" aria-label="No-sale openings">
      <CardHeader><CardTitle>No-sale openings: <span data-testid="no-sale-count">{report.no_sale_count}</span></CardTitle></CardHeader>
      <CardContent>
        {openings.length === 0 ? (
          <p className="text-sm text-muted-foreground">The drawer was not opened without a sale.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Opened by</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Approved by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openings.map((o, i) => (
                  <TableRow key={`${o.opened_at}-${i}`} data-testid="no-sale-opening">
                    <TableCell className="text-sm whitespace-nowrap">{new Date(o.opened_at).toLocaleTimeString()}</TableCell>
                    <TableCell className="text-sm">{o.user_name ?? '—'}</TableCell>
                    <TableCell className="text-sm whitespace-normal">{o.reason}</TableCell>
                    <TableCell className="text-sm">{o.approved_by_name ?? '—'}</TableCell>
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
