import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BanknoteIcon, ExternalLinkIcon } from 'lucide-react'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { displayQuantity } from '../cart/quantity'
import { ProductImage } from '../catalog/product-image'
import { etaLabel, formatDateTime } from '../checkout/delivery'
import { SummaryTotals } from '../checkout/summary-totals'
import { useLocale } from '../i18n/locale'
import { orderStatusLabel } from './returns-api'
import { rich } from '../i18n/rich'
import type { Translate } from '../i18n/translate'
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
  const { t } = useLocale()
  if (!order.payment_instructions) return null
  return (
    <section aria-labelledby="order-payment-instructions" className="mt-6 flex flex-col gap-3 rounded-sf-card border-2 border-sf-primary bg-sf-surface p-5 md:p-6" data-testid="payment-instructions">
      <h2 id="order-payment-instructions" className={cn(orderHeadingClass, 'flex items-center gap-2')}>
        <BanknoteIcon aria-hidden className="size-5" />
        {t('orders.payment.title')}
      </h2>
      <p>
        {rich(t('orders.payment.transfer'), {
          amount: <strong className="text-sf-heading">{formatPrice(order.total, order.currency)}</strong>,
          number: <strong className="text-sf-heading">{order.number}</strong>,
        })}
      </p>
      <p className="rounded-lg bg-sf-canvas px-4 py-3 whitespace-pre-line text-sf-heading">{order.payment_instructions}</p>
      {order.expires_at && (
        <p className="text-sm" data-testid="payment-deadline">
          {rich(t('orders.payment.deadline'), {
            date: (
              <time dateTime={order.expires_at} className="font-semibold text-sf-heading">
                {formatDateTime(order.expires_at)}
              </time>
            ),
          })}
        </p>
      )}
    </section>
  )
}

/** The ordered items; `lineActions` adds controls under a line (e.g. "Write a review"). */
export function OrderItemsCard<L extends Line>({ lines, currency, lineActions }: { lines: L[]; currency: string | null; lineActions?: (line: L) => ReactNode }) {
  const { t, formatNumber } = useLocale()
  const price = (amount: string) => formatPrice(amount, currency)
  return (
    <section aria-labelledby="order-items" className={orderCardClass}>
      <h2 id="order-items" className={orderHeadingClass}>
        {t('orders.items.title')}
      </h2>
      <ul className="flex flex-col divide-y" aria-label={t('orders.items.listLabel')}>
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
              <p className="text-xs">{t('orders.items.sku', { sku: line.sku })}</p>
              <p className="text-xs">
                {formatNumber(displayQuantity(line.quantity))} × {price(line.unit_price)}
              </p>
              {!isZeroDecimal(line.discount_amount ?? '0') && (
                <p className="text-xs font-semibold text-sf-sale" data-testid="order-line-discount">
                  {t('orders.items.discount', { amount: formatDiscount(line.discount_amount, currency) })}
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
  const { t } = useLocale()
  return (
    <section aria-labelledby="order-address" className={orderCardClass}>
      <h2 id="order-address" className={orderHeadingClass}>
        {t('orders.address.title')}
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
  const { t } = useLocale()
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
      {t('orders.track.link')} <ExternalLinkIcon aria-hidden className="size-3.5" />
      <span className="sr-only">{t('orders.track.newTab')}</span>
    </a>
  )
}

function paymentStateLabel(order: Pick<OrderView, 'payment_status' | 'payment_method'>, t: Translate): string {
  return t(order.payment_status === 'paid' ? 'orders.paymentState.paid' : order.payment_method === 'cod' ? 'orders.paymentState.cod' : 'orders.paymentState.awaiting')
}

/** `showCourier: false` when the timeline shows the courier and tracking number instead. */
export function OrderDeliveryCard({ order, showCourier = true }: { order: (OrderView | Omit<OrderView, 'lines'>) & Tracking; showCourier?: boolean }) {
  const { t } = useLocale()
  const eta = etaLabel(order.eta_min_days, order.eta_max_days, t)
  return (
    <section aria-labelledby="order-delivery" className={orderCardClass}>
      <h2 id="order-delivery" className={orderHeadingClass}>
        {t('orders.delivery.title')}
      </h2>
      <dl className="flex flex-col gap-2 text-sm">
        {order.shipping_method_name && (
          <div>
            <dt className="font-medium text-sf-heading">{t('orders.delivery.delivery')}</dt>
            <dd>
              {order.shipping_method_name}
              {eta ? ` ${t('orders.delivery.usually', { eta })}` : ''}
            </dd>
          </div>
        )}
        {showCourier && order.courier_name && (
          <div>
            <dt className="font-medium text-sf-heading">{t('orders.delivery.courier')}</dt>
            <dd data-testid="order-courier">
              {order.courier_name}
              {order.tracking_number ? t('orders.delivery.trackingNumber', { number: order.tracking_number }) : ''}
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
          <dt className="font-medium text-sf-heading">{t('orders.delivery.payment')}</dt>
          <dd data-testid="order-payment">
            {order.payment_method_label} · {paymentStateLabel(order, t)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-sf-heading">{t('orders.delivery.contact')}</dt>
          <dd>
            {order.contact.name} · {order.contact.phone} · {order.contact.email}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function OrderTotalsCard({ order }: { order: OrderView | Omit<OrderView, 'lines'> }) {
  const { t } = useLocale()
  return (
    <section aria-labelledby="order-totals" className={orderCardClass}>
      <h2 id="order-totals" className={orderHeadingClass}>
        {t('orders.totals.title')}
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
  const { t } = useLocale()
  if (order.history.length === 0) return null
  return (
    <section aria-labelledby="order-history" className={orderCardClass}>
      <h2 id="order-history" className={orderHeadingClass}>
        {t('orders.timeline.title')}
      </h2>
      <ol className="flex flex-col gap-3 border-l-2 border-sf-border pl-4" data-testid="order-history">
        {order.history.map((entry, index) => {
          const current = index === order.history.length - 1
          return (
            <li key={`${entry.status}-${entry.at}-${index}`} className="relative text-sm" aria-current={current ? 'step' : undefined}>
              <span aria-hidden className={cn('absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full', current ? 'bg-sf-accent' : 'bg-sf-border')} />
              <span className="block font-semibold text-sf-heading">{orderStatusLabel(t, entry.status, entry.label)}</span>
              <time dateTime={entry.at} className="text-xs">
                {formatDateTime(entry.at)}
              </time>
            </li>
          )
        })}
      </ol>
      {withTracking && order.courier_name && (
        <p className="text-sm" data-testid="order-tracking">
          {rich(t('orders.timeline.shippedWith'), { courier: <strong className="text-sf-heading">{order.courier_name}</strong> })}
          {order.tracking_number ? (
            <>
              {' '}
              {rich(t('orders.timeline.trackingNumber'), { number: <strong className="text-sf-heading">{order.tracking_number}</strong> })}
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
