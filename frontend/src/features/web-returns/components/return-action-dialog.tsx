import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import {
  useWebReturnActionMutation,
  WEB_REFUND_METHODS,
  type WebRefundMethod,
  type WebReturn,
  type WebReturnAction,
  type WebReturnActionInput,
} from '@/features/web-returns/api'
import {
  approvableQuantity,
  approveBody,
  isStaleReturnError,
  lineName,
  quantityError,
  REFUND_METHOD_LABELS,
  returnErrorMessage,
  shippingCap,
  shippingRefundError,
  trimQuantity,
} from '@/features/web-returns/returns'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney } from '@/lib/money'

type Copy = { title: string; description: string; submit: string; success: string }

function copyFor(action: WebReturnAction, ret: WebReturn): Copy {
  switch (action) {
    case 'approve':
      return {
        title: `Approve ${ret.number}`,
        description: 'Accept the return. You may lower quantities and give back part or all of the delivery charge; the refund amount is recalculated from what the customer paid.',
        submit: 'Approve return',
        success: `${ret.number} approved. The customer has been told.`,
      }
    case 'reject':
      return {
        title: `Reject ${ret.number}?`,
        description: 'The customer is e-mailed the reason. This cannot be undone.',
        submit: 'Reject return',
        success: `${ret.number} rejected.`,
      }
    case 'receive':
      return {
        title: `Receive goods for ${ret.number}`,
        description: 'Tick the items that go back on the shelf; they return to the batches they were sold from. Unticked items are written off without stock.',
        submit: 'Mark received',
        success: `${ret.number} received.`,
      }
    case 'refund':
      return {
        title: `Record refund for ${ret.number}`,
        description: `Record the ${formatMoney(ret.refund_amount, ret.currency)} paid back to the customer. It is booked in the payments ledger and the order's payment status is updated.`,
        submit: 'Record refund',
        success: `Refund for ${ret.number} recorded.`,
      }
  }
}

/** Render with `key={action}` so each opening starts fresh. */
type Props = { ret: WebReturn; action: WebReturnAction; onClose: () => void }

/** One dialog per staff step; each submit carries an Idempotency-Key reused on a safe retry. */
export function ReturnActionDialog({ ret, action, onClose }: Props) {
  const mutation = useWebReturnActionMutation()
  const idempotency = useIdempotencyKey()
  const copy = copyFor(action, ret)
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(ret.lines.map((l) => [l.order_line_id, approvableQuantity(l)])))
  const [shippingRefund, setShippingRefund] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState<Record<string, boolean>>(() => Object.fromEntries(ret.lines.map((l) => [l.order_line_id, l.restock ?? true])))
  const [method, setMethod] = useState<WebRefundMethod | ''>('')
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const cap = shippingCap(ret)

  const qtyErrors = Object.fromEntries(ret.lines.map((l) => [l.order_line_id, quantityError(quantities[l.order_line_id] ?? '', approvableQuantity(l))]))
  const allZero = ret.lines.every((l) => /^0+$/.test((quantities[l.order_line_id] ?? '').trim()))
  const shippingError = shippingRefundError(shippingRefund, cap)
  const invalid =
    action === 'approve' ? Object.values(qtyErrors).some(Boolean) || allZero || !!shippingError
    : action === 'reject' ? !reason.trim()
    : action === 'refund' ? !method
    : false

  const buildInput = (): WebReturnActionInput => {
    const base = { id: ret.id, idempotencyKey: '' }
    switch (action) {
      case 'approve':
        return { ...base, action, body: approveBody(ret, quantities, shippingRefund, note) }
      case 'reject':
        return { ...base, action, body: { reason: reason.trim() } }
      case 'receive':
        return { ...base, action, body: { lines: ret.lines.map((l) => ({ order_line_id: l.order_line_id, restock: restock[l.order_line_id] ?? true })) } }
      case 'refund':
        return { ...base, action, body: reference.trim() ? { method: method as WebRefundMethod, reference: reference.trim() } : { method: method as WebRefundMethod } }
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (invalid || mutation.isPending) return
    const input = buildInput()
    input.idempotencyKey = idempotency.keyFor({ id: ret.id, action, body: input.body })
    setErrors({})
    mutation.mutate(input, {
      onSuccess: () => {
        idempotency.settle()
        toast.success(copy.success)
        onClose()
      },
      onError: (error) => {
        idempotency.settle(error)
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
          setErrors(fieldErrorMap(error))
          return
        }
        toast.error(returnErrorMessage(error))
        if (isStaleReturnError(error)) onClose()
        else if (isRetryable(error)) toast.message('You can press the button again to retry safely.')
      },
    })
  }

  const destructive = action === 'reject'
  const lineErrors = Object.entries(errors).filter(([k]) => k.startsWith('lines'))

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form id="return-action-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          {action === 'approve' && (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table aria-label="Quantities to accept">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-28 text-right">Accept</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ret.lines.map((l) => {
                      const id = `approve-qty-${l.order_line_id}`
                      const err = qtyErrors[l.order_line_id]
                      return (
                        <TableRow key={l.order_line_id}>
                          <TableCell className="text-sm">
                            <Label htmlFor={id} className="font-medium">{lineName(l)}</Label>
                            <div className="text-xs text-muted-foreground">Requested {approvableQuantity(l)} · 0 drops the line</div>
                            {err && <p id={`${id}-error`} className="text-xs text-destructive">{err}</p>}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              id={id}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={approvableQuantity(l)}
                              step={1}
                              className="ml-auto w-20 text-right"
                              value={quantities[l.order_line_id] ?? ''}
                              aria-invalid={err ? true : undefined}
                              aria-describedby={err ? `${id}-error` : undefined}
                              onChange={(e) => setQuantities((q) => ({ ...q, [l.order_line_id]: e.target.value }))}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              {allZero && <p role="alert" className="text-sm text-destructive">Accept at least one item, or reject the return instead.</p>}
              <FormField
                label="Delivery charge to refund (optional)"
                error={shippingError ?? errors.shipping_refund}
                hint={cap ? `Up to ${formatMoney(cap, ret.currency)}. Delivery and COD fees are not refunded otherwise.` : 'Delivery and COD fees are not refunded otherwise.'}
              >
                <Input inputMode="decimal" className="w-40" value={shippingRefund} onChange={(e) => setShippingRefund(e.target.value)} placeholder="0.00" />
              </FormField>
              <FormField label="Note (optional)" error={errors.note} hint="Kept on the return (max. 500 characters).">
                <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </>
          )}
          {action === 'reject' && (
            <FormField label="Reason" error={errors.reason} hint="Sent to the customer (max. 200 characters).">
              <Textarea autoFocus rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the item shows signs of use" />
            </FormField>
          )}
          {action === 'receive' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Put back into stock</legend>
              {ret.lines.map((l) => {
                const id = `restock-${l.order_line_id}`
                return (
                  <div key={l.order_line_id} className="flex items-start gap-2 rounded-md border p-2">
                    <Checkbox id={id} checked={restock[l.order_line_id] ?? true} onCheckedChange={(v) => setRestock((r) => ({ ...r, [l.order_line_id]: v === true }))} />
                    <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
                      <span className="font-medium">Restock {lineName(l)}</span>
                      <span className="text-xs text-muted-foreground">{trimQuantity(l.quantity)} {trimQuantity(l.quantity) === '1' ? 'unit' : 'units'} · untick to write off</span>
                    </Label>
                  </div>
                )
              })}
            </fieldset>
          )}
          {action === 'refund' && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="refund-method">Paid back by</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as WebRefundMethod)}>
                  <SelectTrigger id="refund-method" className="w-full" aria-invalid={errors.method ? true : undefined}>
                    <SelectValue placeholder="Choose a method" />
                  </SelectTrigger>
                  <SelectContent>
                    {WEB_REFUND_METHODS.map((m) => <SelectItem key={m} value={m}>{REFUND_METHOD_LABELS[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.method && <p className="text-sm text-destructive">{errors.method}</p>}
              </div>
              <FormField label="Reference (optional)" error={errors.reference} hint="e.g. the bank or bKash transaction ID.">
                <Input maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
              </FormField>
              <p className="text-sm">
                Refund amount <span className="font-mono font-semibold" data-testid="refund-due">{formatMoney(ret.refund_amount, ret.currency)}</span>
              </p>
            </>
          )}
          {lineErrors.length > 0 && <p role="alert" className="text-sm text-destructive">{lineErrors[0]?.[1]}</p>}
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Back</Button>
          <Button type="submit" form="return-action-form" variant={destructive ? 'destructive' : 'default'} disabled={mutation.isPending || invalid}>
            {mutation.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
