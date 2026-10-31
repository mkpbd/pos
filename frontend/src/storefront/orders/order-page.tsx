import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { BanknoteIcon, CircleCheckIcon, PackageSearchIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useCustomer } from '../account/api'
import { Spinner, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { loginPathFor } from '../account/safe-next'
import { displayQuantity } from '../cart/quantity'
import { ProductImage } from '../catalog/product-image'
import { useOrderQuery } from '../checkout/api'
import { etaLabel, formatDateTime } from '../checkout/delivery'
import { readOrderToken, rememberOrderToken } from '../checkout/order-token'
import { SummaryTotals } from '../checkout/summary-totals'
import { formatDiscount, formatPrice } from '../money'
import type { OrderView } from '../types'
import { useDocumentTitle } from '../use-document-title'

/**
 * /order/:number — the confirmation page right after placing an order ("Thank you…") and the
 * order's status page afterwards. Guests open it with the access token (?token= from the
 * confirmation e-mail, or kept for this tab after placing the order): the token is moved into
 * sessionStorage and taken out of the address bar (a replace navigation, so it is not left in
 * the history or a shared link). A wrong or missing token is a 404, shown as "not found".
 */
export function OrderPage() {
  const { number = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const urlToken = params.get('token')
  const placedState = (location.state as { placed?: boolean } | null)?.placed === true
  // The thank-you heading is for the first view only; a reload shows the status page.
  const [thankYou] = useState(placedState)
  const token = urlToken || readOrderToken(number)
  const order = useOrderQuery(number, token)
  const customer = useCustomer()

  useEffect(() => {
    if (urlToken) rememberOrderToken(number, urlToken)
    if (urlToken !== null || placedState) {
      const search = new URLSearchParams(location.search)
      search.delete('token')
      const rest = search.toString()
      void navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '', hash: location.hash }, { replace: true, state: null })
    }
  }, [urlToken, placedState, number, location.pathname, location.search, location.hash, navigate])

  const notFound = order.error instanceof ApiError && order.error.status === 404
  useDocumentTitle(order.data ? (thankYou ? 'Thank you for your order' : `Order ${order.data.number}`) : notFound ? 'Order not found' : null)

  if (order.data) return <OrderDetails order={order.data} thankYou={thankYou} />
  if (notFound) {
    return (
      <OrderMessage title="We could not find this order">
        <p>Check the order number, or open the link in your order confirmation e-mail.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {!customer && (
            <Link to={loginPathFor(location.pathname)} className={primaryButtonClass}>
              Sign in
            </Link>
          )}
          <Link to="/shop" className={secondaryButtonClass}>
            Continue shopping
          </Link>
        </div>
      </OrderMessage>
    )
  }
  if (order.error) {
    return (
      <OrderMessage title="This order could not be loaded">
        <p>Check your connection and try again.</p>
        <button type="button" className={`${primaryButtonClass} mt-4`} disabled={order.isFetching} onClick={() => void order.refetch()}>
          Try again
        </button>
      </OrderMessage>
    )
  }
  return <Spinner label="Loading your order" />
}

function OrderMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="order-page">
      <PackageSearchIcon aria-hidden className="mx-auto mb-4 size-14 text-sf-border" />
      <h1 className="text-2xl font-extrabold lg:text-3xl">{title}</h1>
      <div className="mt-2 flex flex-col items-center">{children}</div>
    </section>
  )
}

const cardClass = 'flex flex-col gap-3 rounded-sf-card bg-sf-surface p-5 md:p-6'
const headingClass = 'font-heading text-xl font-bold text-sf-heading'

function OrderDetails({ order, thankYou }: { order: OrderView; thankYou: boolean }) {
  const currency = order.currency
  const price = (amount: string) => formatPrice(amount, currency)
  const eta = etaLabel(order.eta_min_days, order.eta_max_days)
  const address = order.shipping_address
  const firstName = order.contact.name.trim().split(/\s+/)[0] ?? ''

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-testid="order-page">
      <header className="flex flex-col gap-2">
        {thankYou ? (
          <>
            <p className="inline-flex items-center gap-2 font-semibold text-sf-highlight">
              <CircleCheckIcon aria-hidden className="size-5" />
              Order placed
            </p>
            <h1 className="text-3xl font-extrabold lg:text-4xl">Thank you{firstName ? `, ${firstName}` : ''}!</h1>
            <p>
              Your order number is <strong className="text-sf-heading" data-testid="order-number">{order.number}</strong>. We have sent a confirmation to {order.contact.email}.
            </p>
          </>
        ) : (
          <h1 className="text-3xl font-extrabold lg:text-4xl">
            Order <span data-testid="order-number">{order.number}</span>
          </h1>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="rounded-full bg-sf-accent px-3 py-0.5 text-xs font-bold text-sf-accent-foreground" data-testid="order-status">
            {order.status_label}
          </span>
          <span>
            Placed <time dateTime={order.placed_at}>{formatDateTime(order.placed_at)}</time>
          </span>
        </p>
      </header>

      {order.payment_instructions && (
        <section aria-labelledby="order-payment-instructions" className="mt-6 flex flex-col gap-3 rounded-sf-card border-2 border-sf-primary bg-sf-surface p-5 md:p-6" data-testid="payment-instructions">
          <h2 id="order-payment-instructions" className={cn(headingClass, 'flex items-center gap-2')}>
            <BanknoteIcon aria-hidden className="size-5" />
            Complete your payment
          </h2>
          <p>
            Please transfer <strong className="text-sf-heading">{price(order.total)}</strong> using the details below and mention your order number <strong className="text-sf-heading">{order.number}</strong> as the reference.
          </p>
          <p className="rounded-lg bg-sf-canvas px-4 py-3 whitespace-pre-line text-sf-heading">{order.payment_instructions}</p>
          {order.expires_at && (
            <p className="text-sm" data-testid="payment-deadline">
              We keep your order until <time dateTime={order.expires_at} className="font-semibold text-sf-heading">{formatDateTime(order.expires_at)}</time>. If the payment has not arrived by then, the order is cancelled.
            </p>
          )}
        </section>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="order-items" className={cardClass}>
            <h2 id="order-items" className={headingClass}>
              Items
            </h2>
            <ul className="flex flex-col divide-y" aria-label="Ordered items">
              {order.lines.map((line, index) => (
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
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-sf-heading">{price(line.line_total)}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section aria-labelledby="order-address" className={cardClass}>
              <h2 id="order-address" className={headingClass}>
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
            <section aria-labelledby="order-delivery" className={cardClass}>
              <h2 id="order-delivery" className={headingClass}>
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
                {order.courier_name && (
                  <div>
                    <dt className="font-medium text-sf-heading">Courier</dt>
                    <dd>
                      {order.courier_name}
                      {order.tracking_number ? `, tracking number ${order.tracking_number}` : ''}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="font-medium text-sf-heading">Payment</dt>
                  <dd data-testid="order-payment">
                    {order.payment_method_label} · {order.payment_status === 'paid' ? 'Paid' : order.payment_method === 'cod' ? 'Pay on delivery' : 'Awaiting payment'}
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
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="order-totals" className={cardClass}>
            <h2 id="order-totals" className={headingClass}>
              Order total
            </h2>
            <SummaryTotals amounts={order} currency={currency} />
          </section>
          {order.history.length > 0 && (
            <section aria-labelledby="order-history" className={cardClass}>
              <h2 id="order-history" className={headingClass}>
                Status
              </h2>
              <ol className="flex flex-col gap-3 border-l-2 border-sf-border pl-4" data-testid="order-history">
                {order.history.map((entry, index) => (
                  <li key={`${entry.status}-${entry.at}-${index}`} className="relative text-sm">
                    <span aria-hidden className={cn('absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full', index === order.history.length - 1 ? 'bg-sf-accent' : 'bg-sf-border')} />
                    <span className="block font-semibold text-sf-heading">{entry.label}</span>
                    <time dateTime={entry.at} className="text-xs">
                      {formatDateTime(entry.at)}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <Link to="/shop" className={secondaryButtonClass}>
            Continue shopping
          </Link>
        </div>
      </div>
    </section>
  )
}
