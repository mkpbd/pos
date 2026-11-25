import { useState } from 'react'
import { ShieldCheckIcon, TagIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cartOps, type Cart } from '@/features/pos/cart-store'
import { useManagerApproval } from '@/features/pos/manager-approval-context'
import { ApiError } from '@/lib/api/client'
import { formatMoney } from '@/lib/money'

function lineIndex(error: ApiError): number | null {
  const line = Number(error.details.line)
  return Number.isInteger(line) && line >= 0 ? line : null
}

/**
 * The cart's pricing (or checkout) problem with the way out: a manager's approval, the missing
 * price, or removing the coupon. Other problems show their message only.
 */
export function PricingProblem({
  error,
  cart,
  apply,
  onEnterPrice,
}: {
  error: Error
  cart: Cart
  apply: (change: (cart: Cart) => Cart) => void
  onEnterPrice: (key: string) => void
}) {
  const requestApproval = useManagerApproval()
  const [asking, setAsking] = useState(false)
  const api = error instanceof ApiError ? error : null
  const index = api ? lineIndex(api) : null
  const line = index !== null ? cart.lines[index] : undefined

  const ask = async () => {
    if (!api) return
    setAsking(true)
    try {
      if (api.details.action === 'price_override' && line?.unit_price) {
        const approval = await requestApproval({
          action: 'price_override',
          description: `Sell ${line.label} at ${formatMoney(line.unit_price)} instead of ${formatMoney(line.price)}.`,
          details: { variant_id: line.variant_id, unit_price: line.unit_price },
        })
        if (approval) apply((c) => cartOps.setPrice(c, line.key, line.unit_price ?? null, approval.id))
      } else {
        const approval = await requestApproval({ action: 'discount', description: 'Give the discounts on this sale.', details: { scope: index !== null ? 'line' : 'invoice' } })
        if (approval) apply((c) => ({ ...c, discountApprovalId: approval.id }))
      }
    } finally {
      setAsking(false)
    }
  }

  let action: React.ReactNode = null
  let message = error.message
  if (api?.code === 'APPROVAL_REQUIRED') {
    const price = api.details.action === 'price_override'
    message = price
      ? `${line ? `${line.label}: the` : 'The'} changed price needs a manager's approval.`
      : 'The discount needs a manager’s approval.'
    action = (
      <Button type="button" size="sm" variant="outline" disabled={asking} onClick={() => void ask()}>
        <ShieldCheckIcon data-icon="inline-start" /> Ask a manager
      </Button>
    )
  } else if (api?.code === 'APPROVAL_INVALID') {
    message = 'The manager’s approval has expired or was already used. Ask again.'
    action = (
      <Button type="button" size="sm" variant="outline" onClick={() => apply(cartOps.clearApprovals)}>
        <ShieldCheckIcon data-icon="inline-start" /> Ask again
      </Button>
    )
  } else if (api?.code === 'PRICE_REQUIRED' && line) {
    message = `Enter the price of ${line.label}.`
    action = (
      <Button type="button" size="sm" variant="outline" onClick={() => onEnterPrice(line.key)}>
        <TagIcon data-icon="inline-start" /> Enter price
      </Button>
    )
  } else if (api?.code === 'COUPON_INVALID') {
    action = (
      <Button type="button" size="sm" variant="outline" onClick={() => apply((c) => ({ ...c, couponCode: null }))}>
        <XIcon data-icon="inline-start" /> Remove coupon
      </Button>
    )
  }

  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
      <p>{message}</p>
      {action && <div>{action}</div>}
    </div>
  )
}
