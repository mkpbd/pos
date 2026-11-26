import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCan } from '@/features/auth/use-auth'
import type { CartInput, PricedCart } from '@/features/pos/api'
import { cartOps, type Cart } from '@/features/pos/cart-store'
import { ExchangeRefundDialog } from '@/features/pos/components/exchange-refund-dialog'
import { PaymentDialog, type LoyaltyTender, type StoreCreditTender } from '@/features/pos/components/payment-dialog'
import {
  exchangeAmounts,
  exchangeFingerprint,
  exchangeInput,
  invoiceProblemText,
  isInvoiceProblem,
  isReturnApprovalProblem,
  type ExchangePayment,
} from '@/features/pos/exchange'
import { useExchangeMutation, type ExchangeResult } from '@/features/pos/exchange-api'
import { useManagerApproval } from '@/features/pos/manager-approval-context'
import { storeCreditKey, tenderProblem } from '@/features/pos/stored-value-api'
import { isTillProblem } from '@/features/pos/till-helpers'
import { isRetryable, type RefundInput } from '@/features/returns/api'
import { CreditNoteDialog } from '@/features/returns/components/credit-note-dialog'
import { TillReceiptDialog } from '@/features/pos/components/till-receipt-dialog'
import { tookCash } from '@/features/pos/printing/receipt-document'
import { ApiError } from '@/lib/api/client'
import { formatMoney, isZeroDecimal, sumDecimals, trimDecimal } from '@/lib/money'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  cart: Cart
  apply: (change: (cart: Cart) => Cart) => void
  cartInput: CartInput | null
  priced: PricedCart | undefined
  canCredit: boolean
  loyalty: LoyaltyTender | null
  storeCredit: StoreCreditTender | null
  /** Price / discount approvals and the coupon are sorted out in the cart (as at checkout). */
  onTillProblem: (error: ApiError) => void
  /** The register session closed meanwhile. */
  onSessionLost: () => void
  /** The completed exchange's receipt was closed. */
  onFinished: () => void
}

/**
 * POS1c: pays or refunds the difference of the exchange in progress and submits it
 * (`POST /pos/exchanges`, one Idempotency-Key per payload, kept across retries). A cashier
 * without `returns.approve` gets a manager's PIN approval of the return first. Then the new
 * sale's receipt, the refund paid out, and a credit note's code (shown once).
 */
export function ExchangeCheckout({ open, onOpenChange, cart, apply, cartInput, priced, canCredit, loyalty, storeCredit, onTillProblem, onSessionLost, onFinished }: Props) {
  const can = useCan()
  const queryClient = useQueryClient()
  const requestApproval = useManagerApproval()
  const exchange = useExchangeMutation()
  const [asking, setAsking] = useState(false)
  // The server wants an approval even though this user can approve (e.g. the role changed).
  const [approvalDemanded, setApprovalDemanded] = useState(false)
  const [refundDue, setRefundDue] = useState<{ key: string; due: string } | null>(null)
  const [completed, setCompleted] = useState<{ result: ExchangeResult; noteOpen: boolean } | null>(null)

  const draft = cart.exchange ?? null
  const amounts = draft && priced ? exchangeAmounts(draft.value, priced.total) : null
  const otherApprovals = !!cart.discountApprovalId || cart.lines.some((l) => !!l.price_approval_id)

  const submit = async (payments: ExchangePayment[], refunds: RefundInput[], forceApproval = false) => {
    if (!cartInput || !draft || asking || exchange.isPending) return
    let approvalId = forceApproval ? null : draft.approvalId ?? null
    if (!approvalId && (forceApproval || approvalDemanded || !can('returns.approve'))) {
      setAsking(true)
      const approval = await requestApproval({
        action: 'return',
        description: `${forceApproval ? 'The earlier approval expired or was already used. ' : ''}Take back ${draft.lines.map((l) => `${l.product_name} × ${trimDecimal(l.quantity)}`).join(', ')} from ${draft.invoice.number} (${formatMoney(draft.value, draft.invoice.currency)}) in an exchange.`,
        details: { sale_id: draft.invoice.id },
      }).finally(() => setAsking(false))
      if (!approval) return
      approvalId = approval.id
      apply((c) => (c.exchange ? { ...c, exchange: { ...c.exchange, approvalId: approval.id } } : c))
    }

    const input = exchangeInput(cartInput, { ...draft, approvalId }, payments, refunds)
    const fingerprint = exchangeFingerprint(input)
    // Retrying the same payload (e.g. after a timeout) reuses its key, so the exchange cannot happen twice.
    const key = cart.pendingCheckout?.fingerprint === fingerprint ? cart.pendingCheckout.key : crypto.randomUUID()
    apply((c) => ({ ...c, pendingCheckout: { fingerprint, key } }))

    exchange.mutate({ input, idempotencyKey: key }, {
      onSuccess: (result) => {
        apply((c) => cartOps.empty(c.storeId))
        setApprovalDemanded(false)
        setRefundDue(null)
        onOpenChange(false)
        setCompleted({ result, noteOpen: !!result.credit_note })
      },
      onError: (error) => {
        const retryable = isRetryable(error)
        if (!retryable) apply((c) => ({ ...c, pendingCheckout: null }))
        if (error instanceof ApiError && error.code === 'CASH_SESSION_REQUIRED') {
          onOpenChange(false)
          onSessionLost()
        }
        if (isReturnApprovalProblem(error, otherApprovals)) {
          // Ask the manager again (the approval expired, was used, or is needed after all), then resend.
          apply((c) => (c.exchange ? { ...c, exchange: { ...c.exchange, approvalId: null } } : c))
          setApprovalDemanded(true)
          void submit(payments, refunds, true)
          return
        }
        if (isInvoiceProblem(error)) {
          onOpenChange(false)
          const problem = invoiceProblemText(error, draft.invoice.number)
          apply((c) => (c.exchange ? { ...c, exchange: { ...c.exchange, problem } } : c))
          toast.error(problem)
          return
        }
        if (isTillProblem(error)) {
          onOpenChange(false)
          onTillProblem(error)
          return
        }
        // Store credit / gift card refusals show at their tender; refund refusals at the refund rows.
        if (tenderProblem(error)) {
          if (cart.customer) void queryClient.invalidateQueries({ queryKey: storeCreditKey(cart.customer.id) })
          return
        }
        if (error instanceof ApiError && error.code === 'REFUND_MISMATCH' && typeof error.details.refund_due === 'string') {
          setRefundDue({ key: JSON.stringify(draft.return), due: error.details.refund_due })
          return
        }
        if (error instanceof ApiError && (error.code === 'INSUFFICIENT_CASH' || (error.code === 'VALIDATION_FAILED' && Object.keys(error.fieldErrors).some((k) => k.startsWith('refunds'))))) return
        toast.error(retryable ? `${error.message} Press “Complete exchange” again to retry safely.` : error.message)
      },
    })
  }

  const close = (o: boolean) => { if (!exchange.isPending && !asking) onOpenChange(o) }
  const result = completed?.result
  const refunded = result ? result.return.refunds.filter((r) => (r.method as string) !== 'exchange') : []
  const note = result?.credit_note

  return (
    <>
      {open && draft && priced && amounts && (amounts.settle === 'pay' ? (
        <PaymentDialog
          open
          onOpenChange={close}
          priced={priced}
          canCredit={canCredit}
          loyalty={loyalty}
          storeCredit={storeCredit}
          checkoutError={exchange.error}
          pending={exchange.isPending || asking}
          onSubmit={(payments) => void submit(payments, [])}
          exchange={{ applied: amounts.applied, number: draft.invoice.number }}
        />
      ) : (
        <ExchangeRefundDialog
          open
          onOpenChange={close}
          draft={draft}
          priced={priced}
          applied={amounts.applied}
          refundDue={refundDue?.key === JSON.stringify(draft.return) ? refundDue.due : amounts.toRefund}
          error={exchange.error}
          pending={exchange.isPending || asking}
          onSubmit={(refunds) => void submit([], refunds)}
        />
      ))}
      <CreditNoteDialog
        note={result && note && completed.noteOpen ? { ...note, currency: result.return.currency, returnNumber: result.return.number, customerName: result.return.customer?.name ?? null } : null}
        onDone={() => {
          setCompleted((c) => c && { ...c, noteOpen: false })
          // The code is not kept anywhere once it has been shown.
          exchange.reset()
        }}
      />
      <TillReceiptDialog
        sale={result?.sale ?? null}
        fresh
        cash={!!result && (tookCash(result.sale) || refunded.some((r) => r.method === 'cash'))}
        open={!!completed && !completed.noteOpen}
        onOpenChange={(o) => { if (!o) { setCompleted(null); onFinished() } }}
        title={result ? `Exchange ${result.sale.number} completed` : 'Exchange completed'}
        description={result && (
          <span className="flex flex-col gap-0.5 text-base">
            <span className="text-sm text-muted-foreground">Returned {result.return.number} from {result.return.sale.number ?? 'the invoice'}</span>
            {refunded.length > 0 ? (
              <span data-testid="exchange-refunded">
                Refunded to customer: <b className="font-mono">{formatMoney(sumDecimals(refunded.map((r) => r.amount)), result.return.currency)}</b>
                <span className="text-sm text-muted-foreground"> ({refunded.map((r) => `${r.method_label} ${formatMoney(r.amount)}`).join(', ')})</span>
              </span>
            ) : isZeroDecimal(result.sale.due_total) ? (
              <span>Change due: <b className="font-mono">{formatMoney(result.sale.change_total, result.sale.currency)}</b></span>
            ) : (
              <span>Balance due on account: <b className="font-mono">{formatMoney(result.sale.due_total, result.sale.currency)}</b></span>
            )}
          </span>
        )}
        closeLabel="New sale"
      />
    </>
  )
}
