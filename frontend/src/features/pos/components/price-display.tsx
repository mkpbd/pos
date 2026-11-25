import { EllipsisVerticalIcon, TagIcon, UndoIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { PricedCart, PricedLine } from '@/features/pos/api'
import type { CartLine } from '@/features/pos/cart-store'
import { formatMoney, isZeroDecimal } from '@/lib/money'

/** A line's unit price: the list price struck through when changed, and an open-price badge. */
export function LinePriceInfo({ line, priced }: { line: CartLine; priced: PricedLine | undefined }) {
  const open = priced?.open_price ?? line.open_price === true
  if (open && !line.unit_price) return <span className="font-medium text-destructive">Price needed</span>

  const unit = priced?.unit_price ?? line.unit_price ?? line.price
  const overridden = priced ? priced.price_source === 'override' : !!line.unit_price && !open
  const list = priced?.list_price ?? line.price

  return (
    <>
      {overridden && list && (
        <s className="mr-1" aria-label={`List price ${formatMoney(list)}`}>{formatMoney(list)}</s>
      )}
      <span className={overridden ? 'font-medium text-foreground' : undefined}>{formatMoney(unit)}</span>
      {open && <Badge variant="outline" className="ml-1">Open price</Badge>}
    </>
  )
}

/** Who approved a changed price, and the line's promotion. */
export function LineNotes({ priced }: { priced: PricedLine | undefined }) {
  if (!priced) return null
  const changed = priced.price_source === 'override'
  if (!changed && !priced.promotion) return null

  return (
    <div className="flex flex-col text-xs">
      {changed && (
        <span className="text-muted-foreground">{priced.price_approved_by ? `Approved by ${priced.price_approved_by.name}` : 'Price changed'}</span>
      )}
      {priced.promotion && (
        <span className="flex items-center gap-1 text-success-soft-foreground" data-testid="line-promotion">
          <TagIcon className="size-3" aria-hidden /> {priced.promotion.name} −{formatMoney(priced.promotion.amount)}
        </span>
      )}
    </div>
  )
}

/** Line options: change (or enter) the price, or go back to the list price. */
export function LineMenu({ line, onChangePrice, onListPrice }: { line: CartLine; onChangePrice: () => void; onListPrice: () => void }) {
  const open = line.open_price === true

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Options for ${line.label}`}>
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onChangePrice}>
          <TagIcon /> {open ? 'Enter price' : 'Change price'}
        </DropdownMenuItem>
        {!open && line.unit_price && (
          <DropdownMenuItem onSelect={onListPrice}>
            <UndoIcon /> Back to list price
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Till promotions applied to the cart (already counted in the discounts above). */
export function OffersApplied({ priced }: { priced: PricedCart }) {
  const offers = (priced.promotions ?? []).filter((o) => !isZeroDecimal(o.amount))
  if (offers.length === 0) return null

  return (
    <>
      <dt className="col-span-2 pt-1 text-xs font-medium text-muted-foreground">Offers applied</dt>
      {offers.map((o, i) => (
        <div key={`${o.name}-${i}`} className="contents" data-testid="cart-promotion">
          <dt className="flex items-center gap-1 pl-2 text-xs text-success-soft-foreground"><TagIcon className="size-3" aria-hidden /> {o.name}</dt>
          <dd className="text-right font-mono text-xs text-success-soft-foreground">−{formatMoney(o.amount)}</dd>
        </div>
      ))}
    </>
  )
}

/** “You save …”: list prices minus what is charged, plus every discount. */
export function SavingsRow({ priced }: { priced: PricedCart }) {
  if (!priced.savings_total || isZeroDecimal(priced.savings_total) || priced.savings_total.startsWith('-')) return null

  return (
    <>
      <dt className="font-medium text-success-soft-foreground">You save</dt>
      <dd className="text-right font-mono font-semibold text-success-soft-foreground" data-testid="cart-savings">{formatMoney(priced.savings_total, priced.currency)}</dd>
    </>
  )
}
