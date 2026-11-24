import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WebOrder } from '@/features/web-orders/api'
import { editDetails, editLineText, editTotalText } from '@/features/web-orders/order-entry'
import { formatDateTime } from '@/features/web-orders/orders'

/** BD1b: what was changed on the order after it was placed, newest first. */
export function OrderEditsCard({ order, timeZone }: { order: WebOrder; timeZone: string | undefined }) {
  const edits = order.edits ?? []
  if (edits.length === 0) return null

  return (
    <Card>
      <CardHeader><CardTitle>Changes</CardTitle></CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4 text-sm" aria-label="Order changes">
          {edits.map((edit) => {
            const details = editDetails(edit)
            return (
              <li key={edit.revision} className="flex flex-col gap-1 border-t pt-3 first:border-0 first:pt-0" data-testid={`order-edit-${edit.revision}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">Revision {edit.revision}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(edit.created_at, timeZone)} · {edit.actor?.name ?? 'Staff'}</span>
                </div>
                {edit.reason && <p><span className="text-muted-foreground">Reason:</span> {edit.reason}</p>}
                <p className="font-mono text-xs sm:text-sm">{editTotalText(edit, order.currency)}</p>
                {edit.lines.length > 0 && (
                  <ul className="list-disc pl-5" aria-label={`Lines changed in revision ${edit.revision}`}>
                    {edit.lines.map((line, i) => <li key={i}>{editLineText(line)}</li>)}
                  </ul>
                )}
                {details.length > 0 && <p className="text-muted-foreground">{details.join(' · ')}</p>}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
