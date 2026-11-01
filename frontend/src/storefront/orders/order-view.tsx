import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BanknoteIcon, ExternalLinkIcon } from 'lucide-react'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { displayQuantity } from '../cart/quantity'
import { ProductImage } from '../catalog/product-image'
import { etaLabel, formatDateTime } from '../checkout/delivery'
import { SummaryTotals } from '../checkout/summary-totals'
import { formatDiscount, formatPrice } from '../money'
import type { OrderView } from '../types'

/**
 * The building blocks of an order's page, shared by the confirmation/status page (/order/:number)
 * and the customer's order detail (/account/orders/:number).
 */

const orderCardClass = 'flex flex-col gap-3 rounded-sf-card bg-sf-surface p-5 md:p-6'
const orderHeadingClass = 'font-heading text-xl font-bold text-sf-heading'

type Line = OrderView['lines'][number]

export function OrderStatusBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn('rounded-full bg-sf-accent px-3 py-0.5 text-xs font-bold text-sf-accent-foreground', className)} data-testid="order-status">
      {label}
    </span>
  )
}

/** Bank transfer details while the order waits for the money. */
export function PaymentInstructionsCard({ order }: { order: Pick<OrderView, 'payment_instructions' | 'total' | 'currency' | 'number' | 'expires_at'> }) {
  if (!order.payment_instructions) return null
  return (
    <section aria-labelledby="order-payment-instructions" className="mt-6 flex flex-col gap-3 rounded-sf-card border-2 border-sf-primary bg-sf-surface p-5 md:p-6" data-testid="payment-instructions">
      <h2 id="order-payment-instructions" className={cn(orderHeadingClass, 'flex items-center gap-2')}>
        <BanknoteIcon aria-hidden className="size-5" />
        Complete your payment
      </h2>
      <p>
        Please transfer <strong className="text-sf-heading">{formatPrice(order.total, order.currency)}</strong> using the details below and mention your order number{' '}
        <strong className="text-sf-heading">{order.number}</strong> as the reference.
      </p>
      <p className="rounded-lg bg-sf-canvas px-4 py-3 whitespace-pre-line text-sf-heading">{order.payment_instructions}</p>
      {order.expires_at && (
        <p className="text-sm" data-testid="payment-deadline">
          We keep your order until <time dateTime={order.expires_at} className="font-semibold text-sf-heading">{formatDateTime(order.expires_at)}</time>. If the payment has not arrived by then, the order is cancelled.
        </p>
      )}
    </section>
  )
}

/** The ordered items; `lineActions` adds controls under a line (e.g. "Write a review"). */
export function OrderItemsCard<L extends Line>({ lines, currency, lineActions }: { lines: L[]; currency: string | null; lineActions?: (line: L) => ReactNode }) {
  const price = (amount: string) => formatPrice(amount, currency)
  return (
    <section aria-labelledby="order-items" className={orderCardClass}>
      <h2 id="order-items" className={orderHeadingClass}>
        Items
      </h2>
      <ul className="flex flex-col divide-y" aria-label="Ordered items">
        {lines.map((line, index) => (
          <li key={`${line.sku}-${index}`} className="flex gap-3 py-3" data-testid="order-line">
            <ProductImage image={line.image_url ? { url: line.image_url, alt: null } : null} alt={line.product_name} className="w-16 shrink-0 self-start rounded-lg border" />
            <div className="min-w-0 flex-1 text-sm">
              {line.product_url ? (
                <Link to={line.product_url} className="font-semibold text-sf-heading hover:text-sf-accent">
                  {line.product_name}
                </Link>
              ) : (
                <span className="font-semibold text-sf-heading">{line.product_name}</span>
              )}
              {line.variant_name && <p>{line.variant_name}</p>}
              <p className="text-xs">SKU: {line.sku}</p>
              <p className="text-xs">
                {displayQuantity(line.quantity)} × {price(line.unit_price)}
              </p>
              {!isZeroDecimal(line.discount_amount ?? '0') && (
                <p className="text-xs font-semibold text-sf-sale" data-testid="order-line-discount">
                  Discount: {formatDiscount(line.discount_amount, currency)}
                </p>
              )}
              {lineActions?.(line)}
            </div>
            <span className="shrink-0 text-sm font-semibold text-sf-heading">{price(line.line_total)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function OrderAddressCard({ address }: { address: OrderView['shipping_address'] }) {
  return (
    <section aria-labelledby="order-address" className={orderCardClass}>
      <h2 id="order-address" className={orderHeadingClass}>
        Delivery address
      </h2>
      <address className="text-sm leading-relaxed not-italic">
        {address.recipient_name}
        <br />
        {address.address_line}
        <br />
        {[address.area, address.district].filter(Boolean).join(', ')}
        {address.postcode ? ` ${address.postcode}` : ''}
        <br />
        {address.division}
        <br />
        {address.phone}
      </address>
    </section>
  )
}

/** E10a: the courier's tracking page for the parcel, when the courier has one (null otherwise). */
type Tracking = { tracking_url?: string | null }

function safeTrackingUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

/** "Track parcel" — opens the courier's tracking page in a new tab. */
export function TrackParcelLink({ url }: { url: string | null | undefined }) {
  const href = safeTrackingUrl(url)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-sf-accent underline-offset-4 hover:underline"
      data-testid="track-parcel"
    >
      Track parcel <ExternalLinkIcon aria-hidden className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

function paymentStateLabel(order: Pick<OrderView, 'payment_status' | 'payment_method'>): string {
  return order.payment_status === 'paid' ? 'Paid' : order.payment_method === 'cod' ? 'Pay on delivery' : 'Awaiting payment'
}

/** `showCourier: false` when the timeline shows the courier and tracking number instead. */
export function OrderDeliveryCard({ order, showCourier = true }: { order: (OrderView | Omit<OrderView, 'lines'>) & Tracking; showCourier?: boolean }) {
  const eta = etaLabel(order.eta_min_days, order.eta_max_days)
  return (
    <section aria-labelledby="order-delivery" className={orderCardClass}>
      <h2 id="order-delivery" className={orderHeadingClass}>
        Delivery and payment
      </h2>
      <dl className="flex flex-col gap-2 text-sm">
        {order.shipping_method_name && (
          <div>
            <dt className="font-medium text-sf-heading">Delivery</dt>
            <dd>
              {order.shipping_method_name}
              {eta ? ` — usually ${eta}` : ''}
            </dd>
          </div>
        )}
        {showCourier && order.courier_name && (
          <div>
            <dt className="font-medium text-sf-heading">Courier</dt>
            <dd data-testid="order-courier">
              {order.courier_name}
              {order.tracking_number ? `, tracking number ${order.tracking_number}` : ''}
              {order.tracking_url && (
                <>
                  {' '}
                  <TrackParcelLink url={order.tracking_url} />
                </>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="font-medium text-sf-heading">Payment</dt>
          <dd data-testid="order-payment">
            {order.payment_method_label} · {paymentStateLabel(order)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-sf-heading">Contact</dt>
          <dd>
            {order.contact.name} · {order.contact.phone} · {order.contact.email}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function OrderTotalsCard({ order }: { order: OrderView | Omit<OrderView, 'lines'> }) {
  return (
    <section aria-labelledby="order-totals" className={orderCardClass}>
      <h2 id="order-totals" className={orderHeadingClass}>
        Order total
      </h2>
      <SummaryTotals amounts={order} currency={order.currency} />
    </section>
  )
}

/**
 * The status history, oldest first, the current status highlighted; `withTracking` adds the
 * courier and tracking number under it once the order is shipped.
 */
export function OrderTimeline({ order, withTracking = false }: { order: Pick<OrderView, 'history' | 'courier_name' | 'tracking_number'> & Tracking; withTracking?: boolean }) {
  if (order.history.length === 0) return null
  return (
    <section aria-labelledby="order-history" className={orderCardClass}>
      <h2 id="order-history" className={orderHeadingClass}>
        Status
      </h2>
      <ol className="flex flex-col gap-3 border-l-2 border-sf-border pl-4" data-testid="order-history">
        {order.history.map((entry, index) => {
          const current = index === order.history.length - 1
          return (
            <li key={`${entry.status}-${entry.at}-${index}`} className="relative text-sm" aria-current={current ? 'step' : undefined}>
              <span aria-hidden className={cn('absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full', current ? 'bg-sf-accent' : 'bg-sf-border')} />
              <span className="block font-semibold text-sf-heading">{entry.label}</span>
              <time dateTime={entry.at} className="text-xs">
                {formatDateTime(entry.at)}
              </time>
            </li>
          )
        })}
      </ol>
      {withTracking && order.courier_name && (
        <p className="text-sm" data-testid="order-tracking">
          Shipped with <strong className="text-sf-heading">{order.courier_name}</strong>
          {order.tracking_number ? (
            <>
              {' '}
              — tracking number <strong className="text-sf-heading">{order.tracking_number}</strong>
            </>
          ) : null}
          {order.tracking_url && (
            <>
              {' '}
              <TrackParcelLink url={order.tracking_url} />
            </>
          )}
        </p>
      )}
    </section>
  )
}
