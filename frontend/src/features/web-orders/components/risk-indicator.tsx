import { Badge } from '@/components/ui/badge'
import { SuccessRate } from '@/features/web-orders/components/delivery-history-card'
import type { OrderRisk } from '@/features/web-orders/risk'

/**
 * BD1b: the list row's risk summary of the contact number — its delivery success rate (coloured dot)
 * or "New" when no earlier order was delivered or returned, and a "Blocked" badge.
 */
export function RiskIndicator({ risk, orderNumber }: { risk: OrderRisk | null | undefined; orderNumber: string }) {
  if (!risk) return null
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs" data-testid={`order-risk-${orderNumber}`}>
      <span className="sr-only">Delivery record of this number: </span>
      {risk.success_rate === null ? (
        <span className="text-muted-foreground" title="No earlier delivered or returned orders">New</span>
      ) : (
        <SuccessRate rate={risk.success_rate} className="text-muted-foreground" />
      )}
      {risk.blocked && <Badge variant="destructive">Blocked</Badge>}
    </div>
  )
}
