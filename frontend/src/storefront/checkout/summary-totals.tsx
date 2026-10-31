import { Link } from 'react-router'
import { TagIcon, TicketPercentIcon } from 'lucide-react'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { isExcluded } from '../cart/cart-helpers'
import { displayQuantity } from '../cart/quantity'
import { ProductImage } from '../catalog/product-image'
import { formatDiscount, formatPrice } from '../money'
import type { AppliedPromotion, CartLine } from '../types'

export type SummaryAmounts = {
  subtotal: string
  tax_total: string
  shipping_total: string
  cod_fee: string
  total: string
  prices_include_tax: boolean
  /** E8b: product and order discounts, the waived delivery fee, the promotions and the coupon used. */
  discount_total?: string
  shipping_discount?: string
  promotions?: AppliedPromotion[]
  coupon_code?: string | null
}

function PromotionList({ promotions, currency, label }: { promotions: AppliedPromotion[]; currency: string | null; label: string }) {
  if (promotions.length === 0) return null
  return (
    <dd className="col-span-2">
      <ul className="flex flex-col gap-0.5 pl-3 text-xs" aria-label={label}>
        {promotions.map((promotion, index) => (
          <li key={`${promotion.kind}-${promotion.name}-${index}`} className="flex justify-between gap-4" data-testid="summary-promotion">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <TagIcon aria-hidden className="size-3 shrink-0" />
              {promotion.name}
            </span>
            <span className="shrink-0">{formatDiscount(promotion.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </dd>
  )
}

/**
 * Subtotal, discounts (with their promotions and the coupon), VAT, delivery (free when a
 * free-shipping promotion waives it), COD fee and total exactly as the server computed them
 * (checkout preview and order page). `deliveryPending`: no address chosen yet, so delivery is unknown.
 */
export function SummaryTotals({ amounts, currency, deliveryPending = false }: { amounts: SummaryAmounts; currency: string | null; deliveryPending?: boolean }) {
  const price = (amount: string) => formatPrice(amount, currency)
  const hasTax = !isZeroDecimal(amounts.tax_total)
  const discount = amounts.discount_total ?? '0'
  const shippingDiscount = amounts.shipping_discount ?? '0'
  const promotions = amounts.promotions ?? []
  const goodsPromotions = promotions.filter((p) => p.kind !== 'shipping')
  const shippingPromotions = promotions.filter((p) => p.kind === 'shipping')
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
      {!isZeroDecimal(discount) && (
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>Discounts</dt>
          <dd className="text-right font-semibold text-sf-sale" data-testid="summary-discount">
            {formatDiscount(discount, currency)}
          </dd>
          <PromotionList promotions={goodsPromotions} currency={currency} label="Promotions applied" />
        </div>
      )}
      {amounts.coupon_code && (
        <div className="flex justify-between gap-4">
          <dt className="inline-flex items-center gap-1.5">
            <TicketPercentIcon aria-hidden className="size-4" />
            Coupon
          </dt>
          <dd className="font-semibold tracking-wide text-sf-heading" data-testid="summary-coupon">
            {amounts.coupon_code}
          </dd>
        </div>
      )}
      {hasTax && !amounts.prices_include_tax && row('VAT', price(amounts.tax_total), 'summary-tax')}
      {deliveryPending ? (
        row('Delivery', 'Choose an address', 'summary-shipping', true)
      ) : !isZeroDecimal(shippingDiscount) ? (
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>Delivery</dt>
          <dd className="text-right font-semibold text-sf-heading" data-testid="summary-shipping">
            {!isZeroDecimal(amounts.shipping_total) ? (
              price(amounts.shipping_total)
            ) : (
              <>
                <s className="mr-1.5 font-normal text-sf-text" data-testid="summary-shipping-waived">
                  <span className="sr-only">Was </span>
                  {price(shippingDiscount)}
                </s>
                Free
              </>
            )}
          </dd>
          <PromotionList promotions={shippingPromotions} currency={currency} label="Delivery offers" />
        </div>
      ) : (
        row('Delivery', isZeroDecimal(amounts.shipping_total) ? 'Free' : price(amounts.shipping_total), 'summary-shipping')
      )}
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
              {!excluded && !isZeroDecimal(line.discount_amount ?? '0') && (
                <p className="text-xs font-semibold text-sf-sale" data-testid="summary-line-discount">
                  Discount{line.promotion ? ` (${line.promotion.name})` : ''}: {formatDiscount(line.discount_amount, currency)}
                </p>
              )}
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
