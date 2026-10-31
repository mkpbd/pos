import { Link } from 'react-router'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { isExcluded } from '../cart/cart-helpers'
import { displayQuantity } from '../cart/quantity'
import { ProductImage } from '../catalog/product-image'
import { formatPrice } from '../money'
import type { CartLine } from '../types'

export type SummaryAmounts = {
  subtotal: string
  tax_total: string
  shipping_total: string
  cod_fee: string
  total: string
  prices_include_tax: boolean
}

/**
 * Subtotal, VAT, delivery, COD fee and total exactly as the server computed them (checkout
 * preview and order page). `deliveryPending`: no address chosen yet, so delivery is unknown.
 */
export function SummaryTotals({ amounts, currency, deliveryPending = false }: { amounts: SummaryAmounts; currency: string | null; deliveryPending?: boolean }) {
  const price = (amount: string) => formatPrice(amount, currency)
  const hasTax = !isZeroDecimal(amounts.tax_total)
  const row = (label: string, value: string, testId: string, muted = false) => (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className={cn('text-right font-semibold', muted ? 'text-sf-text' : 'text-sf-heading')} data-testid={testId}>
        {value}
      </dd>
    </div>
  )

  return (
    <dl className="flex flex-col gap-2 text-sm" data-testid="summary-totals">
      {row('Subtotal', price(amounts.subtotal), 'summary-subtotal')}
      {hasTax && !amounts.prices_include_tax && row('VAT', price(amounts.tax_total), 'summary-tax')}
      {deliveryPending
        ? row('Delivery', 'Choose an address', 'summary-shipping', true)
        : row('Delivery', isZeroDecimal(amounts.shipping_total) ? 'Free' : price(amounts.shipping_total), 'summary-shipping')}
      {!isZeroDecimal(amounts.cod_fee) && row('Cash on delivery fee', price(amounts.cod_fee), 'summary-cod-fee')}
      <div className="flex justify-between gap-4 border-t pt-3 text-base">
        <dt className="font-bold text-sf-heading">Total</dt>
        <dd className="font-heading text-xl font-extrabold text-sf-heading" data-testid="summary-total">
          {price(amounts.total)}
        </dd>
      </div>
      {amounts.prices_include_tax && hasTax && <p className="text-xs">Prices include VAT ({price(amounts.tax_total)}).</p>}
    </dl>
  )
}

function lineDetails(line: CartLine): string | null {
  const options = Object.entries(line.option_values)
  if (options.length > 0) return options.map(([name, value]) => `${name}: ${value}`).join(' · ')
  return line.variant_name
}

/** The cart lines of the checkout summary, read-only (changes happen in the cart). */
export function SummaryLines({ lines, currency }: { lines: CartLine[]; currency: string | null }) {
  return (
    <ul className="flex flex-col divide-y" aria-label="Items in your order">
      {lines.map((line) => {
        const excluded = isExcluded(line)
        const details = lineDetails(line)
        return (
          <li key={line.id} className="flex gap-3 py-3" data-testid="summary-line">
            <div className="relative w-14 shrink-0">
              <ProductImage image={line.product.image} alt={line.product.name} className={cn('rounded-lg border', excluded && 'opacity-50')} />
              <span className="absolute -top-2 -right-2 grid min-w-5 place-items-center rounded-full bg-sf-heading px-1 text-xs font-bold text-sf-surface" aria-hidden>
                {displayQuantity(line.quantity)}
              </span>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <Link to={line.product.url} className="line-clamp-2 font-semibold text-sf-heading hover:text-sf-accent">
                {line.product.name}
              </Link>
              {details && <p className="text-xs">{details}</p>}
              <p className="text-xs">
                <span className="sr-only">Quantity: </span>
                <span aria-hidden>Qty </span>
                {displayQuantity(line.quantity)} × {formatPrice(line.unit_price, currency)}
              </p>
              {excluded ? (
                <p className="text-xs font-semibold text-sf-sale">Not available — not included</p>
              ) : line.exceeds_stock ? (
                <p className="text-xs font-semibold text-sf-sale">Not enough in stock</p>
              ) : null}
            </div>
            <span className="shrink-0 text-sm font-semibold text-sf-heading">{excluded ? '—' : formatPrice(line.line_total, currency)}</span>
          </li>
        )
      })}
    </ul>
  )
}
