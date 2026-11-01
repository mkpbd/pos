import { useState, type FormEvent } from 'react'
import { ExternalLinkIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { useShipmentEventMutation, type Shipment, type ShipmentEventInput, type WebOrder } from '@/features/web-orders/api'
import { actionErrorMessage, eventActor, formatDateTime, isStaleOrderError, nextShipmentEvents, safeHttpUrl, shipmentBadge } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal } from '@/lib/money'

const EVENT_CHOICES: Record<ShipmentEventInput['status'], { label: string; hint: string }> = {
  in_transit: { label: 'In transit', hint: 'The courier reports the parcel on its way.' },
  delivered: { label: 'Delivered', hint: 'The customer received the parcel; the order is marked delivered.' },
  returned: { label: 'Returned to sender', hint: 'The parcel came back (e.g. refused). You can then cancel the order to restock it.' },
}

type DialogProps = { order: WebOrder; shipment: Shipment; onClose: () => void }

/** Records a courier update. Render with a `key` so each opening starts empty. */
function ShipmentEventDialog({ order, shipment, onClose }: DialogProps) {
  const mutation = useShipmentEventMutation()
  const idempotency = useIdempotencyKey()
  const choices = nextShipmentEvents(shipment)
  const [status, setStatus] = useState<ShipmentEventInput['status'] | null>(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!status || mutation.isPending) return
    const input: ShipmentEventInput = { status, note: note.trim() || null }
    setErrors({})
    mutation.mutate(
      { id: order.id, input, idempotencyKey: idempotency.keyFor({ id: order.id, ...input }) },
      {
        onSuccess: () => {
          idempotency.settle()
          toast.success(`${order.number}: ${EVENT_CHOICES[status].label.toLowerCase()} recorded.`)
          onClose()
        },
        onError: (error) => {
          idempotency.settle(error)
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            setErrors(fieldErrorMap(error))
            return
          }
          toast.error(actionErrorMessage(error))
          if (isStaleOrderError(error)) onClose()
          else if (isRetryable(error)) toast.message('You can press the button again to retry safely.')
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tracking update for {order.number}</DialogTitle>
          <DialogDescription>What the courier reports about the parcel. Customers see the order status.</DialogDescription>
        </DialogHeader>
        <form id="shipment-event-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Update</legend>
            {choices.map((c) => (
              <div key={c} className="flex items-start gap-2 rounded-md border p-2">
                <input
                  type="radio"
                  id={`event-${c}`}
                  name="shipment-event"
                  value={c}
                  checked={status === c}
                  onChange={() => setStatus(c)}
                  className="mt-1 accent-primary"
                  aria-describedby={`event-${c}-hint`}
                />
                <Label htmlFor={`event-${c}`} className="flex flex-col items-start gap-0.5 font-normal">
                  <span className="font-medium">{EVENT_CHOICES[c].label}</span>
                  <span id={`event-${c}-hint`} className="text-xs text-muted-foreground">{EVENT_CHOICES[c].hint}</span>
                </Label>
              </div>
            ))}
            {errors.status && <p className="text-sm text-destructive">{errors.status}</p>}
          </fieldset>
          <FormField label="Note (optional)" error={errors.note} hint="Max. 200 characters.">
            <Textarea rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer refused, wrong size" />
          </FormField>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Back</Button>
          <Button type="submit" form="shipment-event-form" disabled={mutation.isPending || !status}>
            {mutation.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Record update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Props = { order: WebOrder; shipment: Shipment; timeZone: string | undefined; canManage: boolean }

/** The parcel: courier, tracking link, COD to collect and the courier's updates, newest last. */
export function ShipmentCard({ order, shipment, timeZone, canManage }: Props) {
  const [adding, setAdding] = useState(false)
  const badge = shipmentBadge(shipment.status)
  const link = safeHttpUrl(shipment.tracking_url)
  // The server says when updates are allowed (`add_shipment_event`); the shipment status decides which.
  const canAdd = canManage && (order.allowed_actions as string[]).includes('add_shipment_event') && nextShipmentEvents(shipment).length > 0

  return (
    <Card data-testid="shipment-card">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          Shipment <Badge variant={badge.variant}>{shipment.status_label || badge.label}</Badge>
        </CardTitle>
        {canAdd && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" /> Add tracking update
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 text-sm md:grid-cols-2">
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-muted-foreground">Courier</dt>
            <dd className="font-medium">{shipment.courier_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tracking number</dt>
            <dd className="font-mono">
              {shipment.tracking_number ?? '—'}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 font-sans text-primary underline-offset-4 hover:underline">
                  Track parcel <ExternalLinkIcon className="size-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cash to collect</dt>
            <dd className="font-mono" data-testid="shipment-cod">{isZeroDecimal(shipment.cod_amount) ? 'None (prepaid)' : formatMoney(shipment.cod_amount, order.currency)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Handed over</dt>
            <dd>{formatDateTime(shipment.shipped_at, timeZone)}</dd>
          </div>
        </dl>
        <ol className="flex flex-col gap-3 border-l pl-4" aria-label="Tracking updates">
          {shipment.events.map((ev, i) => {
            const by = eventActor(ev)
            return (
              <li key={ev.id ?? i} className="relative">
                <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
                <div className="font-medium">{ev.status_label || shipmentBadge(ev.status).label}</div>
                <div className="text-xs text-muted-foreground">{formatDateTime(ev.occurred_at, timeZone)}{by && ` · ${by}`}</div>
                {ev.note && <div className="text-xs">{ev.note}</div>}
              </li>
            )
          })}
        </ol>
        {shipment.status === 'returned' && order.status === 'shipped' && (
          <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-2 md:col-span-2">
            The parcel came back. {order.allowed_actions.includes('cancel') ? 'Cancel the order to put its items back into stock.' : 'A paid order needs a refund instead of a cancellation.'}
          </p>
        )}
      </CardContent>
      {adding && <ShipmentEventDialog order={order} shipment={shipment} onClose={() => setAdding(false)} />}
    </Card>
  )
}
