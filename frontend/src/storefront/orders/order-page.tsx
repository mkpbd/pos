import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { CircleCheckIcon, PackageSearchIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { useCustomer } from '../account/api'
import { Spinner, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { loginPathFor } from '../account/safe-next'
import { useOrderQuery } from '../checkout/api'
import { formatDateTime } from '../checkout/delivery'
import { readOrderToken, rememberOrderToken } from '../checkout/order-token'
import type { OrderView } from '../types'
import { useDocumentTitle } from '../use-document-title'
import { OrderAddressCard, OrderDeliveryCard, OrderItemsCard, OrderStatusBadge, OrderTimeline, OrderTotalsCard, PaymentInstructionsCard } from './order-view'

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

  // A signed-in customer's own order (opened without a guest token) is also in the account area.
  if (order.data) return <OrderDetails order={order.data} thankYou={thankYou} accountLink={customer !== null && !token} />
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

function OrderDetails({ order, thankYou, accountLink }: { order: OrderView; thankYou: boolean; accountLink: boolean }) {
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
          <OrderStatusBadge label={order.status_label} />
          <span>
            Placed <time dateTime={order.placed_at}>{formatDateTime(order.placed_at)}</time>
          </span>
        </p>
        {accountLink && (
          <p className="text-sm">
            <Link to={`/account/orders/${encodeURIComponent(order.number)}`} className="font-semibold text-sf-accent hover:underline" data-testid="account-order-link">
              Track this order in My orders
            </Link>
          </p>
        )}
      </header>

      <PaymentInstructionsCard order={order} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <OrderItemsCard lines={order.lines} currency={order.currency} />
          <div className="grid gap-6 md:grid-cols-2">
            <OrderAddressCard address={order.shipping_address} />
            <OrderDeliveryCard order={order} />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <OrderTotalsCard order={order} />
          <OrderTimeline order={order} />
          <Link to="/shop" className={secondaryButtonClass}>
            Continue shopping
          </Link>
        </div>
      </div>
    </section>
  )
}
