import { HistoryIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { phoneReportSummary, usePhoneReportQuery } from '@/features/web-orders/risk'

/**
 * How earlier orders to this mobile number went. A blocked number is a warning only:
 * staff spoke with the customer and may still take the order.
 */
export function PhoneHistoryStrip({ phone }: { phone: string | null }) {
  const report = usePhoneReportQuery(phone)
  if (!phone || !report.data) return null
  const r = report.data

  return (
    <div
      role="status"
      aria-label="Delivery history of this number"
      data-testid="phone-history"
      className={`flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm ${r.blocked ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40'}`}
    >
      <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
      <span className="font-medium">{phoneReportSummary(r)}</span>
      {r.blocked && (
        <>
          <Badge variant="destructive">Blocked</Badge>
          <span className="text-destructive">
            {r.block_reason ? `${r.block_reason}. ` : ''}You can still take this order.
          </span>
        </>
      )}
    </div>
  )
}
