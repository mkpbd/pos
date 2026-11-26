import { MailIcon, MessageSquareIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ReceiptDeliveryStatus, SaleReceiptDelivery } from '@/features/sales/api'

const STATUS: Record<ReceiptDeliveryStatus, { label: string; variant: 'success' | 'secondary' | 'destructive' }> = {
  queued: { label: 'Sent', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
}

/** POS1d: the receipt sends of a sale (newest first), recipients masked as the server gives them. */
export function ReceiptDeliveriesCard({ deliveries }: { deliveries: SaleReceiptDelivery[] }) {
  if (deliveries.length === 0) return null
  return (
    <Card role="region" aria-label="Receipt sent">
      <CardHeader><CardTitle>Receipt sent</CardTitle></CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {deliveries.map((d, i) => {
            const status = STATUS[d.status] ?? { label: d.status, variant: 'secondary' as const }
            const Icon = d.channel === 'email' ? MailIcon : MessageSquareIcon
            return (
              <li key={`${d.created_at}-${i}`} className="flex flex-wrap items-center justify-between gap-2" data-testid="receipt-delivery">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">{d.channel === 'email' ? 'E-mail' : 'SMS'}</span>
                  <span className="font-mono break-all">{d.recipient_masked}</span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </span>
                <span className="text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()}{d.created_by_name ? ` by ${d.created_by_name}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
