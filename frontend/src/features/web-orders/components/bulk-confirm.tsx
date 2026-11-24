import { Link } from 'react-router'
import { Loader2Icon, PhoneCallIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import type { BulkResult } from '@/features/web-orders/api'
import { bulkConfirmErrorLabel, bulkConfirmSummary, useBulkConfirmMutation } from '@/features/web-orders/risk'

export function BulkConfirmResultDialog({ results, onClose }: { results: BulkResult[]; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm orders</DialogTitle>
          <DialogDescription>{bulkConfirmSummary(results)}</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-sm" aria-label="Results per order">
          {results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0">
              {r.number ? <Link to={`/web-orders/${r.id}`} className="font-mono underline-offset-4 hover:underline">{r.number}</Link> : <span className="text-muted-foreground">Unknown order</span>}
              {r.ok ? <Badge variant="info">Confirmed</Badge> : <span className="text-destructive">Not changed: {bulkConfirmErrorLabel(r.error_code, r.message)}</span>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * BD1b: "Confirm" for the selected orders that wait for a call (`ids` = those only). Each order reports
 * back through `onDone` (the page shows them with BulkConfirmResultDialog).
 */
export function BulkConfirmButton({ ids, onDone }: { ids: string[]; onDone: (results: BulkResult[]) => void }) {
  const bulk = useBulkConfirmMutation()
  const idempotency = useIdempotencyKey()

  const confirm = () => {
    if (bulk.isPending || ids.length === 0) return
    const orderIds = [...ids]
    bulk.mutate(
      { orderIds, idempotencyKey: idempotency.keyFor({ confirm: orderIds }) },
      {
        onSuccess: (res) => {
          idempotency.settle()
          onDone(res)
        },
        onError: (e) => {
          idempotency.settle(e)
          toast.error(e.message)
          if (isRetryable(e)) toast.message('You can press the button again to retry safely.')
        },
      },
    )
  }

  if (ids.length === 0) return null
  return (
    <Button size="sm" onClick={confirm} disabled={bulk.isPending}>
      {bulk.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PhoneCallIcon data-icon="inline-start" />} Confirm ({ids.length})
    </Button>
  )
}
