import { useState } from 'react'
import { TicketPercentIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PricedCoupon } from '@/features/pos/api'
import { normalizeCoupon } from '@/features/pos/till-helpers'
import { cn } from '@/lib/utils'

/**
 * Coupon code on the till's cart. The preview says whether it applies; a coupon that does not
 * stays on the cart with the reason until removed (checkout refuses it with COUPON_INVALID).
 */
export function CouponField({
  code,
  coupon,
  onApply,
  onRemove,
}: {
  code: string | null
  /** The coupon's state from the last preview (null while pricing). */
  coupon: PricedCoupon | null | undefined
  onApply: (code: string) => void
  onRemove: () => void
}) {
  const [entry, setEntry] = useState('')

  if (code) {
    const status = coupon && normalizeCoupon(coupon.code) === normalizeCoupon(code) ? coupon : null
    const applied = status?.status === 'applied'
    return (
      <div className="flex flex-col gap-1" data-testid="coupon">
        <div className="flex items-center gap-2 text-sm">
          <TicketPercentIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-mono font-medium">{code}</span>
          <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Remove coupon ${code}`} onClick={onRemove}>
            <XIcon />
          </Button>
        </div>
        {status && (
          <p
            role="status"
            className={cn('text-xs', applied ? 'text-success-soft-foreground' : 'text-amber-600 dark:text-amber-400')}
          >
            {status.message || (applied ? 'Coupon applied.' : status.status === 'not_applicable' ? 'This coupon does not apply to this sale.' : 'This coupon is not valid.')}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const value = normalizeCoupon(entry)
        if (!value) return
        onApply(value)
        setEntry('')
      }}
    >
      <Input aria-label="Coupon code" placeholder="Coupon code" className="h-8 font-mono uppercase" maxLength={40} value={entry} onChange={(e) => setEntry(e.target.value)} />
      <Button type="submit" variant="outline" size="sm" disabled={normalizeCoupon(entry) === ''}>Apply</Button>
    </form>
  )
}
