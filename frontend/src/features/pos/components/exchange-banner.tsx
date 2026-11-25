import { ArrowLeftRightIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PricedCart } from '@/features/pos/api'
import { exchangeAmounts, type ExchangeDraft } from '@/features/pos/exchange'
import { formatMoney, trimDecimal } from '@/lib/money'

/** POS1c: shown above the cart in exchange mode — what came back and how the difference settles. */
export function ExchangeBanner({ draft, priced, onCancel, disabled }: { draft: ExchangeDraft; priced: PricedCart | undefined; onCancel: () => void; disabled?: boolean }) {
  const c = draft.invoice.currency
  const amounts = priced ? exchangeAmounts(draft.value, priced.total) : null

  return (
    <div role="region" aria-label="Exchange" className="flex flex-col gap-1 border-b bg-primary/5 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-medium" data-testid="exchange-banner">
          <ArrowLeftRightIcon className="size-4 shrink-0" aria-hidden />
          <span>Exchange for <span className="font-mono">{draft.invoice.number}</span> · returned {formatMoney(draft.value, c)}</span>
        </p>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>
          <XIcon data-icon="inline-start" /> Cancel exchange
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {draft.lines.map((l) => `${l.product_name} × ${trimDecimal(l.quantity)}`).join(', ')}
      </p>
      {draft.problem && <p role="alert" className="text-xs font-medium text-destructive">{draft.problem}</p>}
      {amounts && (
        <p className="text-xs" data-testid="exchange-difference">
          {amounts.settle === 'pay' && <>Customer pays {formatMoney(amounts.toPay, c)} more</>}
          {amounts.settle === 'refund' && <>Refund to customer {formatMoney(amounts.toRefund, c)}</>}
          {amounts.settle === 'even' && <>Even exchange — nothing to pay</>}
        </p>
      )}
    </div>
  )
}

/** The Pay button's words in exchange mode. */
export function ExchangePayLabel({ value, priced }: { value: string; priced: PricedCart | undefined }) {
  if (!priced) return <>Complete exchange</>
  const amounts = exchangeAmounts(value, priced.total)
  if (amounts.settle === 'pay') return <>Pay {formatMoney(amounts.toPay, priced.currency)}</>
  if (amounts.settle === 'refund') return <>Refund {formatMoney(amounts.toRefund, priced.currency)}</>
  return <>Complete exchange</>
}
