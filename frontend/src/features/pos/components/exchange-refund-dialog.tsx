import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PricedCart } from '@/features/pos/api'
import { refundProblemText, refundSettlement, type ExchangeDraft } from '@/features/pos/exchange'
import type { RefundInput } from '@/features/returns/api'
import { RefundsEditor } from '@/features/returns/components/refunds-editor'
import { newRefundKey, refundsProblem, toRefundInput, type RefundRow } from '@/features/returns/refunds'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal } from '@/lib/money'

/** One cash row for the whole difference (the cashier may split it over the invoice's other methods). */
const cashRow = (amount: string): RefundRow[] => (isZeroDecimal(amount) ? [] : [{ key: newRefundKey(), method: 'cash', amount, reference: '' }])

/**
 * POS1c: settles an exchange whose returned value covers the new items — the difference is
 * refunded (cash from the drawer, card / mobile up to what the invoice was paid that way, store
 * credit, a new credit note), or there is nothing to pay at all.
 */
export function ExchangeRefundDialog({
  open,
  onOpenChange,
  draft,
  priced,
  applied,
  refundDue,
  error,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: ExchangeDraft
  priced: PricedCart
  /** A: the part of the returned value that pays the new items. */
  applied: string
  /** V − A (or the server's figure after a REFUND_MISMATCH). */
  refundDue: string
  error: unknown
  pending: boolean
  onSubmit: (refunds: RefundInput[]) => void
}) {
  const c = priced.currency
  const [rows, setRows] = useState<RefundRow[]>(() => cashRow(refundDue))
  const [rowsFor, setRowsFor] = useState(refundDue)
  const [touched, setTouched] = useState(false)
  // A changed refund due (the server's after a mismatch) starts over with one cash row.
  if (rowsFor !== refundDue) {
    setRowsFor(refundDue)
    setRows(cashRow(refundDue))
  }
  const refunding = !isZeroDecimal(refundDue)
  const settlement = refundSettlement(draft, refundDue)
  const problem = refunding ? refundsProblem(rows, settlement, c) : null
  const serverProblem = refundProblemText(error, c, formatMoney)
  const fieldErrors = serverProblem ? fieldErrorMap(error) : {}

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (problem || pending) return
    onSubmit(refunding ? toRefundInput(rows) : [])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Exchange</DialogTitle>
          <DialogDescription>Items returned from <span className="font-mono">{draft.invoice.number}</span>{priced.customer && ` · ${priced.customer.name}`}</DialogDescription>
        </DialogHeader>
        <form id="exchange-refund-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-md border p-3 text-sm">
            <dt className="text-muted-foreground">New items</dt>
            <dd className="text-right font-mono">{formatMoney(priced.total, c)}</dd>
            <dt className="text-muted-foreground">Exchange credit</dt>
            <dd className="text-right font-mono" data-testid="exchange-credit">−{formatMoney(applied, c)}</dd>
            {refunding ? (
              <>
                <dt className="font-medium">Refund to customer</dt>
                <dd className="text-right font-mono text-lg font-semibold" data-testid="exchange-refund">{formatMoney(refundDue, c)}</dd>
              </>
            ) : (
              <dd className="col-span-2 pt-1 text-center font-medium" data-testid="exchange-even">Nothing to pay</dd>
            )}
          </dl>
          {refunding && <RefundsEditor settlement={settlement} currency={c} rows={rows} onChange={setRows} errors={fieldErrors} disabled={pending} />}
          {serverProblem && <p role="alert" className="text-sm text-destructive">{serverProblem}</p>}
          {touched && problem && !serverProblem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Back to cart</Button>
          <Button type="submit" form="exchange-refund-form" disabled={pending}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Complete exchange
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
