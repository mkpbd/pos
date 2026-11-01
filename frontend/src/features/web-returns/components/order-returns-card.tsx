import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Loader2Icon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import type { WebOrder, WebOrderLine } from '@/features/web-orders/api'
import { formatDateTime } from '@/features/web-orders/orders'
import { useCreateWebReturnMutation, WEB_RETURN_REASONS, type CreateReturnInput, type WebReturnReason } from '@/features/web-returns/api'
import { quantityError, REASON_LABELS, returnableLines, returnErrorMessage, returnStatusBadge, returnsClosed, trimQuantity } from '@/features/web-returns/returns'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal } from '@/lib/money'

function lineLabel(l: WebOrderLine): string {
  return l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name
}

/** Staff-created return: pick quantities per line, a reason, and override the window with a note when needed. */
function CreateReturnDialog({ order, timeZone, onClose }: { order: WebOrder; timeZone: string | undefined; onClose: () => void }) {
  const navigate = useNavigate()
  const mutation = useCreateWebReturnMutation()
  const idempotency = useIdempotencyKey()
  const lines = returnableLines(order)
  const closed = returnsClosed(order)
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, '0'])))
  const [reason, setReason] = useState<WebReturnReason | ''>('')
  const [note, setNote] = useState('')
  const [override, setOverride] = useState(closed)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const qtyErrors = Object.fromEntries(lines.map((l) => [l.id, quantityError(quantities[l.id] ?? '', l.max)]))
  const chosen = lines.filter((l) => !qtyErrors[l.id] && !isZeroDecimal(quantities[l.id]))
  const noteRequired = override
  const invalid = Object.values(qtyErrors).some(Boolean) || chosen.length === 0 || !reason || (noteRequired && !note.trim()) || (closed && !override)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (invalid || mutation.isPending) return
    const input: CreateReturnInput = {
      reason_code: reason as WebReturnReason,
      note: note.trim() || null,
      lines: chosen.map((l) => ({ order_line_id: l.id, quantity: (quantities[l.id] ?? '0').trim() })),
      ...(override ? { override_window: true } : {}),
    }
    setErrors({})
    mutation.mutate(
      { orderId: order.id, input, idempotencyKey: idempotency.keyFor({ orderId: order.id, input }) },
      {
        onSuccess: (ret) => {
          idempotency.settle()
          toast.success(`Return ${ret.number} created.`)
          onClose()
          navigate(`/web-returns/${ret.id}`)
        },
        onError: (error) => {
          idempotency.settle(error)
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            setErrors(fieldErrorMap(error))
            return
          }
          const message = returnErrorMessage(error)
          if (error instanceof ApiError && error.code === 'RETURN_NOT_ALLOWED' && error.details.reason === 'window_closed') {
            setErrors({ form: message })
            return
          }
          toast.error(message)
          if (isRetryable(error)) toast.message('You can press the button again to retry safely.')
          else if (error instanceof ApiError && (error.code === 'QUANTITY_EXCEEDS_RETURNABLE' || error.code === 'RETURN_NOT_ALLOWED')) onClose()
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a return for {order.number}</DialogTitle>
          <DialogDescription>
            Record items the customer is sending back. The return starts as requested; approve it next.
            {order.return_deadline ? (
              <> The return window {closed ? 'closed' : 'closes'} {formatDateTime(order.return_deadline, timeZone)}.</>
            ) : (
              closed && ' Customers can no longer return this order.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form id="create-return-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Items to return">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-28 text-right">Return</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const id = `return-qty-${l.id}`
                  const err = qtyErrors[l.id]
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">
                        <Label htmlFor={id} className="font-medium">{lineLabel(l)}</Label>
                        <div className="text-xs text-muted-foreground">Up to {l.max} of {trimQuantity(l.quantity)}</div>
                        {err && <p id={`${id}-error`} className="text-xs text-destructive">{err}</p>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={l.max}
                          step={1}
                          className="ml-auto w-20 text-right"
                          value={quantities[l.id] ?? ''}
                          aria-invalid={err ? true : undefined}
                          aria-describedby={err ? `${id}-error` : undefined}
                          onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {errors.lines && <p role="alert" className="text-sm text-destructive">{errors.lines}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return-reason">Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as WebReturnReason)}>
              <SelectTrigger id="return-reason" className="w-full" aria-invalid={errors.reason_code ? true : undefined}>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {WEB_RETURN_REASONS.map((r) => <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.reason_code && <p className="text-sm text-destructive">{errors.reason_code}</p>}
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="return-override" checked={override} onCheckedChange={(v) => setOverride(v === true)} />
            <Label htmlFor="return-override" className="flex flex-col items-start gap-0.5 font-normal">
              <span className="font-medium">Accept after the return window</span>
              <span className="text-xs text-muted-foreground">{closed ? 'Customers can no longer return this order: an override is needed and is recorded in the audit log.' : 'Only needed once the window has closed. Recorded in the audit log.'}</span>
            </Label>
          </div>
          <FormField label={noteRequired ? 'Note (required for an override)' : 'Note (optional)'} error={errors.note} hint="Kept on the return as the staff note (max. 500 characters).">
            <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={override ? 'e.g. approved by the manager — parcel was delayed' : undefined} />
          </FormField>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Back</Button>
          <Button type="submit" form="create-return-form" disabled={mutation.isPending || invalid}>
            {mutation.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Create return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Returns on a web order, and "Create return" when the server allows it and the user may refund. */
export function OrderReturnsCard({ order, timeZone }: { order: WebOrder; timeZone: string | undefined }) {
  const can = useCan()
  const [creating, setCreating] = useState(false)
  const returns = order.returns ?? []
  const canCreate = can('web_orders.refund') && order.allowed_actions.includes('create_return') && returnableLines(order).length > 0

  if (returns.length === 0 && !canCreate) return null

  return (
    <Card role="region" aria-labelledby="order-returns-title">
      <CardHeader>
        <CardTitle id="order-returns-title">Returns</CardTitle>
        {order.return_deadline && (
          <CardDescription>
            Customer return window {returnsClosed(order) ? 'closed' : 'open until'} {formatDateTime(order.return_deadline, timeZone)}
          </CardDescription>
        )}
        {canCreate && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Undo2Icon data-icon="inline-start" /> Create return</Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {returns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No returns on this order.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" aria-label="Returns on this order">
            {returns.map((r) => {
              const badge = returnStatusBadge(r.status, r.status_label)
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 first:border-0 first:pt-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link to={`/web-returns/${r.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{r.number}</Link>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at, timeZone)}</span>
                  </span>
                  <span className="font-mono">{formatMoney(r.refund_amount, order.currency)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      {creating && <CreateReturnDialog order={order} timeZone={timeZone} onClose={() => setCreating(false)} />}
    </Card>
  )
}
