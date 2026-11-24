import { useState, type FormEvent } from 'react'
import { CheckIcon, CopyIcon, Loader2Icon, SmartphoneIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { copyText } from '@/features/marketing/clipboard'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import type { WebOrder } from '@/features/web-orders/api'
import { formatDateTime, paymentMethodLabel } from '@/features/web-orders/orders'
import { useConfirmPaymentClaimMutation, useRejectPaymentClaimMutation, type PaymentClaim } from '@/features/web-orders/payment-claims-api'
import { ACCOUNT_TYPE_NAMES, claimBadge, claimErrorMessage, isStaleClaimError, purposeLabel, REJECT_REASON_MAX } from '@/features/web-orders/payment-claims'
import { ApiError } from '@/lib/api/client'
import { formatMoney, isZeroDecimal } from '@/lib/money'

type Review = { kind: 'confirm' | 'reject'; claim: PaymentClaim }

function ReviewDialog({ order, review, onClose }: { order: WebOrder; review: Review; onClose: () => void }) {
  const confirm = useConfirmPaymentClaimMutation()
  const reject = useRejectPaymentClaimMutation()
  const idempotency = useIdempotencyKey()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { claim, kind } = review
  const pending = confirm.isPending || reject.isPending
  const amount = formatMoney(claim.amount, order.currency)
  const method = paymentMethodLabel(claim.method)

  const onError = (e: Error) => {
    idempotency.settle(e)
    if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
      setError(e.fieldErrors.reason?.[0] ?? e.message)
      return
    }
    toast.error(claimErrorMessage(e))
    if (isStaleClaimError(e)) onClose()
    else if (isRetryable(e)) toast.message('You can press the button again to retry safely.')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setError(null)
    if (kind === 'confirm') {
      const payload = { orderId: order.id, claimId: claim.id, action: 'confirm' }
      confirm.mutate(
        { orderId: order.id, claimId: claim.id, idempotencyKey: idempotency.keyFor(payload) },
        {
          onSuccess: () => {
            idempotency.settle()
            toast.success(`Payment of ${amount} confirmed for ${order.number}.`)
            onClose()
          },
          onError,
        },
      )
      return
    }
    const text = reason.trim()
    if (!text) {
      setError('Tell the customer why, e.g. “No payment with this TrxID.”')
      return
    }
    const payload = { orderId: order.id, claimId: claim.id, action: 'reject', reason: text }
    reject.mutate(
      { orderId: order.id, claimId: claim.id, reason: text, idempotencyKey: idempotency.keyFor(payload) },
      {
        onSuccess: () => {
          idempotency.settle()
          toast.success(`Transaction ID ${claim.transaction_id} rejected. The customer can send another one.`)
          onClose()
        },
        onError,
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === 'confirm' ? `Confirm ${amount} by ${method}?` : `Reject transaction ID ${claim.transaction_id}?`}</DialogTitle>
          <DialogDescription>
            {kind === 'confirm'
              ? `Only confirm once you see ${amount} from ${claim.sender_phone} with transaction ID ${claim.transaction_id} in your ${method.replace(' (Send Money)', '')} app. The payment is recorded and the order moves to Confirmed.`
              : 'The customer sees the reason on their order page and can send another transaction ID. The order keeps waiting for payment.'}
          </DialogDescription>
        </DialogHeader>
        <form id="payment-claim-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          {kind === 'reject' ? (
            <FormField label="Reason" error={error ?? undefined} hint={`Shown to the customer (max. ${REJECT_REASON_MAX} characters).`}>
              <Textarea autoFocus rows={3} maxLength={REJECT_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No payment with this TrxID in our bKash account" />
            </FormField>
          ) : (
            error && <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Back</Button>
          <Button type="submit" form="payment-claim-form" variant={kind === 'reject' ? 'destructive' : 'default'} disabled={pending}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {kind === 'confirm' ? 'Confirm payment' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClaimItem({ order, claim, timeZone, canReview, onReview }: { order: WebOrder; claim: PaymentClaim; timeZone: string | undefined; canReview: boolean; onReview: (r: Review) => void }) {
  const badge = claimBadge(claim.status)
  return (
    <li className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0" data-testid={`payment-claim-${claim.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{paymentMethodLabel(claim.method)}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="text-xs text-muted-foreground">{purposeLabel(claim.purpose)}</span>
        </span>
        <span className="font-mono font-medium">{formatMoney(claim.amount, order.currency)}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">TrxID</dt>
        <dd className="flex flex-wrap items-center gap-1">
          <span className="font-mono font-semibold tracking-wide" data-testid="claim-trxid">{claim.transaction_id}</span>
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Copy transaction ID ${claim.transaction_id}`} onClick={() => void copyText(claim.transaction_id, 'Transaction ID copied.')}>
            <CopyIcon />
          </Button>
        </dd>
        <dt className="text-muted-foreground">Sent from</dt>
        <dd className="font-mono">{claim.sender_phone}</dd>
        <dt className="text-muted-foreground">Sent</dt>
        <dd>{formatDateTime(claim.submitted_at, timeZone)}</dd>
        {claim.reviewed_at && (
          <>
            <dt className="text-muted-foreground">{claim.status === 'rejected' ? 'Rejected' : 'Checked'}</dt>
            <dd>{formatDateTime(claim.reviewed_at, timeZone)}{claim.reviewed_by?.name && ` · ${claim.reviewed_by.name}`}</dd>
          </>
        )}
        {claim.reject_reason && (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd data-testid="claim-reject-reason">{claim.reject_reason}</dd>
          </>
        )}
      </dl>
      {claim.status === 'submitted' && canReview && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Check transaction ID ${claim.transaction_id}`}>
          <Button size="sm" onClick={() => onReview({ kind: 'confirm', claim })}><CheckIcon data-icon="inline-start" /> Confirm payment</Button>
          <Button size="sm" variant="outline" onClick={() => onReview({ kind: 'reject', claim })}><XIcon data-icon="inline-start" /> Reject</Button>
        </div>
      )}
    </li>
  )
}

/**
 * BD1c: the Send Money payment of an order — what the customer still has to send (the order total, or
 * the advance delivery charge on cash on delivery), and every transaction ID they sent, newest first.
 * Staff with web_orders.manage confirm the money arrived or reject the transaction ID with a reason.
 */
export function PaymentClaimsCard({ order, timeZone, canManage }: { order: WebOrder; timeZone: string | undefined; canManage: boolean }) {
  const [review, setReview] = useState<Review | null>(null)
  const due = order.payment_due ?? null
  const claims = order.payment_claims ?? []
  const methods = due?.methods ?? []
  const advance = !isZeroDecimal(order.advance_amount) ? order.advance_amount ?? null : null
  const canReview = canManage && order.allowed_actions.includes('confirm_payment_claim')

  return (
    <Card data-testid="payment-claims-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SmartphoneIcon className="size-4" aria-hidden /> Send Money payment</CardTitle>
        <CardDescription>Check each transaction ID (TrxID) in your bKash, Nagad or Rocket app before you confirm it.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {due && (
          <div className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 p-3" data-testid="payment-due">
            <p>
              <span className="text-muted-foreground">{due.purpose === 'advance' ? 'Advance delivery charge due' : 'Amount due'}</span>{' '}
              <span className="font-mono text-base font-semibold">{formatMoney(due.amount, due.currency || order.currency)}</span>
            </p>
            {due.expires_at && <p>The order is cancelled automatically if it is not paid by <strong>{formatDateTime(due.expires_at, timeZone)}</strong>.</p>}
            {methods.length > 0 && (
              <p className="text-muted-foreground">
                The customer sends it to{' '}
                {methods.map((m, i) => (
                  <span key={m.code}>
                    {i > 0 && ', '}
                    <span className="text-foreground">{m.display_name}</span>
                    {m.account_number && <span className="font-mono text-foreground"> {m.account_number}</span>}
                    {m.account_type && ` (${ACCOUNT_TYPE_NAMES[m.account_type] ?? m.account_type})`}
                  </span>
                ))}
                .
              </p>
            )}
          </div>
        )}
        {!due && advance && (
          <p data-testid="advance-note">
            Advance delivery charge of <span className="font-mono font-medium">{formatMoney(advance, order.currency)}</span>
            {order.payment_status === 'partially_paid' || order.payment_status === 'paid' ? ' paid; the rest is collected on delivery.' : ' asked before the order is sent.'}
          </p>
        )}
        {claims.length === 0 ? (
          <p className="text-muted-foreground">The customer has not sent a transaction ID yet.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Transaction IDs from the customer">
            {claims.map((c) => <ClaimItem key={c.id} order={order} claim={c} timeZone={timeZone} canReview={canReview} onReview={setReview} />)}
          </ul>
        )}
      </CardContent>
      {review && <ReviewDialog key={`${review.kind}-${review.claim.id}`} order={order} review={review} onClose={() => setReview(null)} />}
    </Card>
  )
}
