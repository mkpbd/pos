import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useWebActivityQuery } from '@/features/customers/api'
import { formatDateTime, paymentBadge, statusBadge } from '@/features/web-orders/orders'
import { formatMoney } from '@/lib/money'

function Stat({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium" data-testid={testId}>{children}</dd>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the customer does on the online store (E10b): orders and spend, returns, reviews, wishlist, cart. */
export function WebActivityCard({ customerId }: { customerId: string }) {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const canOpenOrders = can('web_orders.view')
  const { data, error, isPending, refetch } = useWebActivityQuery(customerId)

  return (
    <Card size="sm" role="region" aria-labelledby="web-activity-title">
      <CardHeader>
        <CardTitle id="web-activity-title">Web activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingState rows={2} label="Loading web activity" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data.account && data.orders.count === 0 ? (
          <p className="text-sm text-muted-foreground">No online store activity yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Stat label="Orders" testId="web-orders-count">{data.orders.count}</Stat>
              <Stat label="Total spent" testId="web-total-spent"><span className="font-mono">{formatMoney(data.orders.total_spent, currency)}</span></Stat>
              <Stat label="Average order"><span className="font-mono">{data.orders.average_order ? formatMoney(data.orders.average_order) : '—'}</span></Stat>
              <Stat label="Last order">{data.orders.last_order_at ? formatDateTime(data.orders.last_order_at, timeZone) : '—'}</Stat>
              <Stat label="Last sign-in">{data.account ? (data.account.last_login_at ? formatDateTime(data.account.last_login_at, timeZone) : 'Never') : 'No account'}</Stat>
              <Stat label="Returns">{data.returns_count}</Stat>
              <Stat label="Reviews">
                {data.reviews.count}
                {data.reviews.pending > 0 && <span className="font-normal text-muted-foreground"> ({data.reviews.pending} pending)</span>}
              </Stat>
              <Stat label="Wishlist">{plural(data.wishlist_count, 'item', 'items')}</Stat>
              <Stat label="Cart">
                {data.cart && data.cart.item_count > 0 ? (
                  <>
                    {plural(data.cart.item_count, 'item', 'items')}
                    {data.cart.updated_at && <span className="block text-xs font-normal text-muted-foreground">updated {formatDateTime(data.cart.updated_at, timeZone)}</span>}
                  </>
                ) : (
                  'Empty'
                )}
              </Stat>
            </dl>
            {data.recent_orders.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Recent orders</h3>
                <ul className="flex flex-col gap-1 text-sm" aria-label="Recent web orders">
                  {data.recent_orders.map((o) => {
                    const status = statusBadge(o.status)
                    return (
                      <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-1 first:border-0 first:pt-0">
                        <span className="flex flex-wrap items-center gap-2">
                          {canOpenOrders ? (
                            <Link to={`/web-orders/${o.id}`} className="font-mono underline-offset-4 hover:underline">{o.number}</Link>
                          ) : (
                            <span className="font-mono">{o.number}</span>
                          )}
                          <Badge variant={status.variant}>{o.status_label || status.label}</Badge>
                          {o.payment_status && o.payment_status !== 'paid' && o.payment_status !== 'unpaid' && <Badge variant={paymentBadge(o.payment_status).variant}>{paymentBadge(o.payment_status).label}</Badge>}
                          <span className="text-xs text-muted-foreground">{formatDateTime(o.placed_at, timeZone)}</span>
                        </span>
                        <span className="font-mono">{formatMoney(o.total, o.currency ?? currency)}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
