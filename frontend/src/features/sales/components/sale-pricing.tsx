import { BadgePercentIcon, TicketIcon, UserCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Sale, SaleLine, SalePerson } from '@/features/sales/api'
import { promotionKindLabel } from '@/features/sales/promotion-kind'
import { compareDecimal, formatMoney, isZeroDecimal } from '@/lib/money'

/**
 * POS1a on the admin sale page: list price → charged price with who changed or approved it, the
 * till promotion per line, and the sale's promotions, coupon, approved discount and savings.
 * Sales from before POS1a have none of these fields and render as before.
 */

const personName = (person: SalePerson | null | undefined) => person?.name ?? null

/** The Price cell: charged price; an overridden one with the list price struck through and who allowed it. */
export function LinePrice({ line, cashierName }: { line: SaleLine; cashierName: string | null }) {
  const charged = <span className="font-mono">{formatMoney(line.unit_price)}</span>

  if (line.price_source === 'open') {
    return (
      <div className="flex flex-col items-end">
        {charged}
        <span className="text-xs text-muted-foreground">Open price</span>
      </div>
    )
  }

  if (line.price_source === 'override') {
    const approver = personName(line.price_approved_by)
    const by = approver ? `Approved by ${approver}` : cashierName ? `Changed by ${cashierName}` : 'Changed at the till'
    const showList = line.list_price != null && compareDecimal(line.list_price, line.unit_price) !== 0
    return (
      <div className="flex flex-col items-end" data-testid="line-price-override">
        <span className="flex flex-wrap items-baseline justify-end gap-x-1.5">
          {showList && (
            <s className="font-mono text-xs text-muted-foreground" aria-label={`List price ${formatMoney(line.list_price)}`}>
              {formatMoney(line.list_price)}
            </s>
          )}
          {charged}
        </span>
        <span className="text-xs text-muted-foreground">{by}</span>
      </div>
    )
  }

  return charged
}

/** Under the item name: the till promotion the line got. */
export function LinePromotion({ line }: { line: SaleLine }) {
  if (!line.promotion || isZeroDecimal(line.promotion.amount)) return null
  return (
    <div className="flex items-center gap-1 text-xs text-success-soft-foreground">
      <BadgePercentIcon className="size-3 shrink-0" aria-hidden />
      <span>{line.promotion.name} −{formatMoney(line.promotion.amount)}</span>
    </div>
  )
}

/** Promotions, coupon, approved discount and savings of the sale; nothing when it had none. */
export function SaleOffersCard({ sale }: { sale: Sale }) {
  const promotions = sale.promotions ?? []
  const approver = personName(sale.discount_approved_by)
  const savings = sale.savings_total && !isZeroDecimal(sale.savings_total) && !sale.savings_total.startsWith('-') ? sale.savings_total : null
  if (promotions.length === 0 && !sale.coupon_code && !approver && !savings) return null

  return (
    <Card>
      <CardHeader><CardTitle>Offers & approvals</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {promotions.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Promotions">
            {promotions.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <BadgePercentIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {p.name}
                  <Badge variant="outline" className="font-normal">{promotionKindLabel(p.kind)}</Badge>
                </span>
                <span className="font-mono">−{formatMoney(p.amount, sale.currency)}</span>
              </li>
            ))}
          </ul>
        )}
        {sale.coupon_code && (
          <p className="flex items-center gap-2" data-testid="sale-coupon">
            <TicketIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Coupon <span className="font-mono font-medium">{sale.coupon_code}</span>
          </p>
        )}
        {approver && (
          <p className="flex items-center gap-2">
            <UserCheckIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Discount approved by {approver}
          </p>
        )}
        {savings && (
          <p className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 font-medium" data-testid="sale-savings">
            <span>Customer saved</span>
            <span className="font-mono">{formatMoney(savings, sale.currency)}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
