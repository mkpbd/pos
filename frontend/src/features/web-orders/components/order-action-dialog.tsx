import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { useWebOrderActionMutation, type WebOrder, type WebOrderAction } from '@/features/web-orders/api'
import { actionErrorMessage, isStaleOrderError } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney } from '@/lib/money'

type Copy = { title: string; description: string; submit: string; success: string }

function copyFor(action: WebOrderAction, order: WebOrder): Copy {
  const total = formatMoney(order.total, order.currency)
  switch (action) {
    case 'confirm_payment':
      return {
        title: `Confirm payment for ${order.number}`,
        description: `Record the bank transfer of ${total} once it has reached your account. The order moves to Confirmed.`,
        submit: 'Confirm payment',
        success: `Payment for ${order.number} confirmed.`,
      }
    case 'process':
      return {
        title: `Start processing ${order.number}?`,
        description: 'The order moves to Processing while it is picked and packed.',
        submit: 'Start processing',
        success: `${order.number} is being processed.`,
      }
    case 'ship':
      return {
        title: `Ship ${order.number}`,
        description: 'Record who carries the parcel. The tracking number is shown to the customer.',
        submit: 'Mark as shipped',
        success: `${order.number} marked as shipped.`,
      }
    case 'deliver':
      return {
        title: `Mark ${order.number} as delivered?`,
        description: 'Use this once the courier has handed the parcel over.',
        submit: 'Mark as delivered',
        success: `${order.number} marked as delivered.`,
      }
    case 'record_cod_payment':
      return {
        title: `Record cash on delivery for ${order.number}`,
        description: `Record ${total} collected on delivery. The order is marked paid.`,
        submit: 'Record payment',
        success: `Payment for ${order.number} recorded.`,
      }
    case 'cancel':
      return {
        title: `Cancel ${order.number}?`,
        description: 'Its items go back into stock. This cannot be undone.',
        submit: 'Cancel order',
        success: `${order.number} cancelled.`,
      }
  }
}

type Fields = { reference: string; courier_name: string; tracking_number: string; reason: string }
const EMPTY: Fields = { reference: '', courier_name: '', tracking_number: '', reason: '' }

function bodyFor(action: WebOrderAction, f: Fields): Record<string, string | null> | undefined {
  switch (action) {
    case 'confirm_payment':
      return { reference: f.reference.trim() }
    case 'record_cod_payment':
      return { reference: f.reference.trim() || null }
    case 'ship':
      return { courier_name: f.courier_name.trim(), tracking_number: f.tracking_number.trim() || null }
    case 'cancel':
      return { reason: f.reason.trim() }
    default:
      return undefined
  }
}

function missingRequired(action: WebOrderAction, f: Fields): boolean {
  if (action === 'confirm_payment') return !f.reference.trim()
  if (action === 'ship') return !f.courier_name.trim()
  if (action === 'cancel') return !f.reason.trim()
  return false
}

/** Render with `key={action}` so each opening starts with empty fields. */
type Props = { order: WebOrder; action: WebOrderAction; onClose: () => void }

/** One dialog for every staff action; each submit carries an Idempotency-Key reused on a safe retry. */
export function OrderActionDialog({ order, action, onClose }: Props) {
  const mutation = useWebOrderActionMutation()
  const idempotency = useIdempotencyKey()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const copy = copyFor(action, order)
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (missingRequired(action, fields) || mutation.isPending) return
    const body = bodyFor(action, fields)
    setErrors({})
    mutation.mutate(
      { id: order.id, action, body, idempotencyKey: idempotency.keyFor({ id: order.id, action, body }) },
      {
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
          toast.error(actionErrorMessage(error))
          if (isStaleOrderError(error)) onClose()
          else if (isRetryable(error)) toast.message('You can press the button again to retry safely.')
        },
      },
    )
  }

  const destructive = action === 'cancel'

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form id="order-action-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          {(action === 'confirm_payment' || action === 'record_cod_payment') && (
            <FormField
              label={action === 'confirm_payment' ? 'Transaction reference' : 'Reference (optional)'}
              error={errors.reference}
              hint={action === 'confirm_payment' ? 'As shown on the bank statement.' : 'e.g. courier remittance number'}
            >
              <Input autoFocus maxLength={80} value={fields.reference} onChange={(e) => set({ reference: e.target.value })} />
            </FormField>
          )}
          {action === 'ship' && (
            <>
              <FormField label="Courier" error={errors.courier_name}>
                <Input autoFocus maxLength={100} value={fields.courier_name} onChange={(e) => set({ courier_name: e.target.value })} placeholder="e.g. Pathao" />
              </FormField>
              <FormField label="Tracking number (optional)" error={errors.tracking_number}>
                <Input maxLength={100} value={fields.tracking_number} onChange={(e) => set({ tracking_number: e.target.value })} />
              </FormField>
            </>
          )}
          {action === 'cancel' && (
            <FormField label="Reason" error={errors.reason} hint="Kept on the order's history (max. 200 characters).">
              <Textarea autoFocus rows={3} maxLength={200} value={fields.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. customer asked to cancel" />
            </FormField>
          )}
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>{destructive ? 'Keep order' : 'Back'}</Button>
          <Button type="submit" form="order-action-form" variant={destructive ? 'destructive' : 'default'} disabled={mutation.isPending || missingRequired(action, fields)}>
            {mutation.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
