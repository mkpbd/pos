import { useState } from 'react'
import { Link } from 'react-router'
import { CircleAlertIcon, TagIcon, Trash2Icon, TruckIcon } from 'lucide-react'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ProductImage } from '../catalog/product-image'
import { formatDiscount, formatPrice } from '../money'
import type { Cart, CartLine } from '../types'
import { useRemoveCartItemMutation, useUpdateCartItemMutation } from './api'
import { isExcluded, useCartCurrency } from './cart-helpers'
import { cartErrorMessage, displayQuantity } from './quantity'
import { QuantityStepper } from './quantity-stepper'

function lineDetails(line: CartLine): string | null {
  const options = Object.entries(line.option_values)
  if (options.length > 0) return options.map(([name, value]) => `${name}: ${value}`).join(' · ')
  return line.variant_name
}

export function CartLines({ cart, compact = false, onNavigate }: { cart: Cart; compact?: boolean; onNavigate?: () => void }) {
  const currency = useCartCurrency(cart)
  return (
    <ul className={cn('flex flex-col', compact ? 'divide-y' : 'gap-4')} aria-label="Cart items">
      {cart.items.map((line) => (
        <CartLineRow key={line.id} line={line} currency={currency} compact={compact} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function CartLineRow({ line, currency, compact, onNavigate }: { line: CartLine; currency: string | null; compact: boolean; onNavigate?: () => void }) {
  const update = useUpdateCartItemMutation()
  const remove = useRemoveCartItemMutation()
  const [error, setError] = useState<string | null>(null)
  const excluded = isExcluded(line)
  const details = lineDetails(line)
  const busy = update.isPending || remove.isPending
  const price = (amount: string) => formatPrice(amount, currency)
  const max = line.max_quantity && !isZeroDecimal(line.max_quantity) ? displayQuantity(line.max_quantity) : null

  const setQuantity = (quantity: string) => {
    setError(null)
    update.mutate({ id: line.id, quantity }, { onError: (e) => setError(cartErrorMessage(e)) })
  }

  return (
    <li
      className={cn('flex gap-3', compact ? 'py-4' : 'rounded-sf-card bg-sf-surface p-4 sm:gap-5', excluded && 'bg-sf-canvas/50')}
      data-testid="cart-line"
      aria-busy={busy || undefined}
    >
      <Link to={line.product.url} onClick={onNavigate} tabIndex={-1} aria-hidden className={cn('shrink-0 self-start overflow-hidden rounded-lg border', compact ? 'w-16' : 'w-20 sm:w-28')}>
        <ProductImage image={line.product.image} alt={line.product.name} className={cn(excluded && 'opacity-50')} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={line.product.url} onClick={onNavigate} className="line-clamp-2 font-semibold text-sf-heading hover:text-sf-accent">
              {line.product.name}
            </Link>
            {details && <p className="text-sm">{details}</p>}
            {!compact && <p className="text-xs">SKU: {line.sku}</p>}
          </div>
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-full text-sf-text transition hover:bg-sf-canvas hover:text-sf-sale disabled:opacity-50"
            aria-label={`Remove ${line.product.name}${line.variant_name ? ` (${line.variant_name})` : ''} from the cart`}
            disabled={busy}
            onClick={() => {
              setError(null)
              remove.mutate(line.id, { onError: (e) => setError(cartErrorMessage(e)) })
            }}
          >
            <Trash2Icon aria-hidden className="size-4" />
          </button>
        </div>

        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-sf-heading">{price(line.unit_price)}</span>
          {line.compare_at_price && (
            <s>
              <span className="sr-only">Original price: </span>
              {price(line.compare_at_price)}
            </s>
          )}
          {!compact && <span className="text-xs">each</span>}
        </p>

        {!excluded && !isZeroDecimal(line.discount_amount ?? '0') && (
          <p className="inline-flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-sf-sale" data-testid="line-discount">
            <TagIcon aria-hidden className="size-3.5 shrink-0" />
            <span>{line.promotion?.name ?? 'Discount'}:</span>
            <span>
              <span className="sr-only">saves </span>
              {formatDiscount(line.discount_amount, currency)}
            </span>
          </p>
        )}

        <LineFlags line={line} max={max} busy={busy} onFix={setQuantity} />

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          {line.purchasable ? (
            <QuantityStepper
              value={line.quantity}
              onChange={setQuantity}
              allowDecimal={line.allow_decimal}
              max={line.max_quantity}
              disabled={busy || !line.in_stock}
              label={`Quantity of ${line.product.name}${line.variant_name ? ` (${line.variant_name})` : ''}`}
              size="sm"
            />
          ) : (
            <span className="text-sm">Quantity: {displayQuantity(line.quantity)}</span>
          )}
          <span className={cn('text-sm font-bold', excluded ? 'text-sf-text' : 'text-sf-heading')} data-testid="line-total">
            {excluded ? 'Not included' : price(line.line_total)}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-sf-sale">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

function LineFlags({ line, max, busy, onFix }: { line: CartLine; max: string | null; busy: boolean; onFix: (quantity: string) => void }) {
  let message: string | null = null
  if (!line.purchasable) message = 'No longer available — not included in the total. Please remove it.'
  else if (!line.in_stock) message = 'Out of stock — not included in the total.'
  else if (line.exceeds_stock && max) message = `Only ${max} left in stock.`
  if (!message) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-sf-sale" data-testid="line-flag">
      <span className="inline-flex items-center gap-1.5">
        <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
        {message}
      </span>
      {line.purchasable && line.in_stock && line.exceeds_stock && max && (
        <button type="button" disabled={busy} onClick={() => onFix(max)} className="text-sf-accent underline underline-offset-4 hover:no-underline disabled:opacity-50">
          Change quantity to {max}
        </button>
      )}
    </div>
  )
}

/**
 * Subtotal (before discounts), the discounts with the promotions behind them, VAT and total as
 * the server computed them (lines that are not available are left out), and the free-delivery
 * note when a free-shipping promotion applies.
 */
export function CartTotals({ cart, compact = false }: { cart: Cart; compact?: boolean }) {
  const currency = useCartCurrency(cart)
  const price = (amount: string) => formatPrice(amount, currency)
  const hasTax = !isZeroDecimal(cart.tax_total)
  const discount = cart.discount_total ?? '0'
  const promotions = cart.promotions ?? []
  const freeShipping = cart.free_shipping ?? null

  return (
    <dl className="flex flex-col gap-2 text-sm" data-testid="cart-totals">
      <div className="flex justify-between gap-4">
        <dt>Subtotal</dt>
        <dd className="font-semibold text-sf-heading" data-testid="cart-subtotal">{price(cart.subtotal)}</dd>
      </div>
      {!isZeroDecimal(discount) && (
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>Discounts</dt>
          <dd className="text-right font-semibold text-sf-sale" data-testid="cart-discount">{formatDiscount(discount, currency)}</dd>
          {promotions.length > 0 && (
            <dd className="col-span-2">
              <ul className="flex flex-col gap-0.5 pl-3 text-xs" aria-label="Promotions applied">
                {promotions.map((promotion) => (
                  <li key={`${promotion.kind}-${promotion.id}`} className="flex justify-between gap-4" data-testid="cart-promotion">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <TagIcon aria-hidden className="size-3 shrink-0" />
                      {promotion.name}
                    </span>
                    <span className="shrink-0">{formatDiscount(promotion.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </dd>
          )}
        </div>
      )}
      {!compact && hasTax && !cart.prices_include_tax && (
        <div className="flex justify-between gap-4">
          <dt>VAT</dt>
          <dd className="font-semibold text-sf-heading" data-testid="cart-tax">{price(cart.tax_total)}</dd>
        </div>
      )}
      {!compact && (
        <div className="flex justify-between gap-4 border-t pt-3 text-base">
          <dt className="font-bold text-sf-heading">Total</dt>
          <dd className="font-heading text-xl font-extrabold text-sf-heading" data-testid="cart-total">{price(cart.total)}</dd>
        </div>
      )}
      {freeShipping && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-sf-highlight" data-testid="free-shipping-note">
          <TruckIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          Free delivery with {freeShipping.name} — applied at checkout.
        </p>
      )}
      {cart.prices_include_tax ? (
        <p className="text-xs" data-testid="vat-note">
          Prices include VAT{hasTax && !compact ? ` (${price(cart.tax_total)})` : ''}.
        </p>
      ) : compact ? (
        <p className="text-xs">Subtotal excludes VAT.</p>
      ) : null}
    </dl>
  )
}
