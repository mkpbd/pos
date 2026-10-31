import { useState } from 'react'
import { Link } from 'react-router'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useRedemptionsQuery, type Promotion, type Redemption } from '@/features/promotions/api'
import { formatDateTime } from '@/features/web-orders/orders'
import { formatMoney } from '@/lib/money'

/** The customer's name when the order belongs to an account, else null. */
function customerName(r: Redemption): string | null {
  if (r.customer_name) return r.customer_name
  if (!r.customer) return null
  return typeof r.customer === 'string' ? r.customer : r.customer.name
}

/** Orders that used the offer (recorded at placement; append-only). */
export function RedemptionsPanel({ promotion }: { promotion: Promotion }) {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const [page, setPage] = useState(1)
  const redemptions = useRedemptionsQuery(promotion.id, page)
  const canOpenOrders = can('web_orders.view')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redemptions</CardTitle>
        <CardDescription>Every order that received this offer, with the discount it got. Cancelled orders keep their redemption.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {redemptions.isPending ? (
          <LoadingState label="Loading redemptions" />
        ) : redemptions.error ? (
          <ErrorState error={redemptions.error} onRetry={() => redemptions.refetch()} />
        ) : redemptions.data.items.length === 0 ? (
          <EmptyState title="Not used yet" description="Orders that get this offer appear here." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Redemptions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {redemptions.data.items.map((r, i) => {
                    const name = customerName(r)
                    return (
                      <TableRow key={r.id ?? `${r.order_id}-${i}`}>
                        <TableCell>
                          {canOpenOrders ? (
                            <Link to={`/web-orders/${r.order_id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.order_number}</Link>
                          ) : (
                            <span className="font-mono text-sm">{r.order_number}</span>
                          )}
                          {r.coupon_code && <div className="font-mono text-xs text-muted-foreground">{r.coupon_code}</div>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {name ?? <span className="text-muted-foreground">Guest</span>}
                          {r.email && <div className="text-xs break-all text-muted-foreground">{r.email}</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(r.amount, currency)}</TableCell>
                        <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{formatDateTime(r.created_at, timeZone)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={redemptions.data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
