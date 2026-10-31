import { AlertTriangleIcon, Loader2Icon, MinusIcon, PlusIcon, ShoppingBasketIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PricedCart, PricedLine } from '@/features/pos/api'
import { cartOps, isValidQuantity, type Cart, type CartLine } from '@/features/pos/cart-store'
import { DiscountButton, DiscountPopover, SerialsDialog } from '@/features/pos/components/line-controls'
import { compareDecimal, formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

/** The priced line for a cart line, only while it still describes the same product and quantity. */
function pricedFor(line: CartLine, index: number, priced: PricedCart | undefined): PricedLine | undefined {
  const p = priced?.lines[index]
  return p && p.variant_id === line.variant_id && isValidQuantity(line.quantity) && compareDecimal(trimDecimal(p.quantity), trimDecimal(line.quantity)) === 0 ? p : undefined
}

function discountText(d: { type: 'percent' | 'amount'; value: string }): string {
  return d.type === 'percent' ? `−${trimDecimal(d.value)}%` : `−${formatMoney(d.value)}`
}

export function CartLines({
  cart,
  priced,
  canDiscount,
  apply,
}: {
  cart: Cart
  priced: PricedCart | undefined
  canDiscount: boolean
  apply: (change: (cart: Cart) => Cart) => void
}) {
  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <ShoppingBasketIcon className="size-8" aria-hidden />
        Scan a barcode or pick a product to start a sale.
      </div>
    )
  }

  return (
    <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto" aria-label="Cart">
      {cart.lines.map((line, i) => {
        const p = pricedFor(line, i, priced)
        const short = p?.available != null && compareDecimal(p.available.replace(/^-.*/, '0'), trimDecimal(line.quantity)) < 0
        const update = (patch: Partial<CartLine>) => apply((c) => ({ ...c, lines: c.lines.map((l) => (l.key === line.key ? { ...l, ...patch } : l)) }))

        return (
          <li key={line.key} className="flex flex-col gap-1.5 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{line.label}</div>
                <div className="text-xs text-muted-foreground">
                  {formatMoney(p?.unit_price ?? line.price)}{line.unit_code && ` / ${line.unit_code}`}
                  {line.discount && <Badge variant="secondary" className="ml-1">{discountText(line.discount)}</Badge>}
                </div>
              </div>
              <div className="text-right font-mono text-sm font-semibold" aria-label={`Amount of ${line.label}`}>
                {p ? formatMoney(p.line_total) : <Loader2Icon className="inline size-3 animate-spin" aria-label="Pricing" />}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon-sm" aria-label={`Decrease ${line.label}`} onClick={() => apply((c) => cartOps.step(c, line.key, -1))}><MinusIcon /></Button>
              <Input
                aria-label={`Quantity of ${line.label}`}
                inputMode="decimal"
                className={cn('h-7 w-20 text-center font-mono', !isValidQuantity(line.quantity) && 'border-destructive')}
                value={line.quantity}
                onChange={(e) => update({ quantity: e.target.value })}
                onFocus={(e) => e.target.select()}
              />
              <Button type="button" variant="outline" size="icon-sm" aria-label={`Increase ${line.label}`} onClick={() => apply((c) => cartOps.step(c, line.key, 1))}><PlusIcon /></Button>
              {line.track_serials && <SerialsDialog label={line.label} quantity={trimDecimal(line.quantity)} serials={line.serials} onChange={(serials) => update({ serials })} />}
              <div className="ml-auto flex items-center">
                {canDiscount && (
                  <DiscountPopover
                    value={line.discount}
                    onChange={(discount) => update({ discount })}
                    label={`Discount on ${line.label}`}
                    hint={p?.max_discount_percent ? `At most ${trimDecimal(p.max_discount_percent)}% for this product.` : undefined}
                  >
                    <DiscountButton discount={line.discount} aria-label={`Discount on ${line.label}`} />
                  </DiscountPopover>
                )}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${line.label}`} onClick={() => apply((c) => cartOps.remove(c, line.key))}><Trash2Icon /></Button>
              </div>
            </div>
            {short && (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangleIcon className="size-3" aria-hidden /> Only {trimDecimal(p?.available ?? '0')} in stock
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function CartTotals({ priced, cart, canDiscount, apply }: { priced: PricedCart; cart: Cart; canDiscount: boolean; apply: (change: (cart: Cart) => Cart) => void }) {
  const c = priced.currency
  const invoice = priced.invoice_discount
  const groupPercent = priced.customer && !isZeroDecimal(priced.customer.group_discount_percent) ? priced.customer.group_discount_percent : null

  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
      <dt className="text-muted-foreground">Subtotal</dt>
      <dd className="text-right font-mono">{formatMoney(priced.subtotal)}</dd>
      {!isZeroDecimal(priced.item_discount_total) && (
        <>
          <dt className="text-muted-foreground">Item discounts</dt>
          <dd className="text-right font-mono">−{formatMoney(priced.item_discount_total)}</dd>
        </>
      )}
      <dt className="flex items-center gap-1 text-muted-foreground">
        Invoice discount
        {invoice && <Badge variant="outline">{discountText(invoice)}{invoice.source === 'customer_group' && ' group'}</Badge>}
        {(canDiscount || groupPercent) && (
          <DiscountPopover
            value={invoice ? { type: invoice.type, value: invoice.value } : null}
            onChange={(d) => apply((cart) => ({ ...cart, invoiceDiscount: d }))}
            label="Invoice discount"
            hint={groupPercent ? `${priced.customer?.name} gets ${trimDecimal(groupPercent)}% as a group member.${canDiscount ? '' : ' You can only remove it.'}` : undefined}
          >
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">{invoice ? 'Change' : 'Add'}</Button>
          </DiscountPopover>
        )}
        {cart.invoiceDiscount !== undefined && groupPercent && (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => apply((cart) => ({ ...cart, invoiceDiscount: undefined }))}>Reset</Button>
        )}
      </dt>
      <dd className="text-right font-mono">{isZeroDecimal(priced.invoice_discount_total) ? '—' : `−${formatMoney(priced.invoice_discount_total)}`}</dd>
      <dt className="text-muted-foreground">{priced.tax_mode === 'inclusive' ? 'Tax (included)' : 'Tax'}</dt>
      <dd className="text-right font-mono">{formatMoney(priced.tax_total)}</dd>
      <dt className="pt-1 text-lg font-semibold">Total</dt>
      <dd className="pt-1 text-right font-mono text-2xl font-bold" data-testid="cart-total">{formatMoney(priced.total, c)}</dd>
    </dl>
  )
}
