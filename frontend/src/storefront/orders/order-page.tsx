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
import { useLocale } from '../i18n/locale'
import { orderStatusLabel } from './returns-api'
import { rich } from '../i18n/rich'
import type { OrderView } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
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
  const { t } = useLocale()

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
  useDocumentMeta(privatePage(order.data ? (thankYou ? t('orders.page.thankYouTitle') : t('orders.title', { number: order.data.number })) : notFound ? t('orders.notFoundTitle') : null))

  // A signed-in customer's own order (opened without a guest token) is also in the account area.
  if (order.data) return <OrderDetails order={order.data} thankYou={thankYou} accountLink={customer !== null && !token} />
  if (notFound) {
    return (
      <OrderMessage title={t('orders.page.notFoundHeading')}>
        <p>{t('orders.page.notFoundText')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {!customer && (
            <Link to={loginPathFor(location.pathname)} className={primaryButtonClass}>
              {t('common.account.signIn')}
            </Link>
          )}
          <Link to="/shop" className={secondaryButtonClass}>
            {t('orders.continueShopping')}
          </Link>
        </div>
      </OrderMessage>
    )
  }
  if (order.error) {
    return (
      <OrderMessage title={t('orders.page.failedHeading')}>
        <p>{t('orders.checkConnection')}</p>
        <button type="button" className={`${primaryButtonClass} mt-4`} disabled={order.isFetching} onClick={() => void order.refetch()}>
          {t('common.tryAgain')}
        </button>
      </OrderMessage>
    )
  }
  return <Spinner label={t('orders.loading')} />
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
  const { t } = useLocale()

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-testid="order-page">
      <header className="flex flex-col gap-2">
        {thankYou ? (
          <>
            <p className="inline-flex items-center gap-2 font-semibold text-sf-highlight">
              <CircleCheckIcon aria-hidden className="size-5" />
              {t('orders.page.placed')}
            </p>
            <h1 className="text-3xl font-extrabold lg:text-4xl">{firstName ? t('orders.page.thankYouName', { name: firstName }) : t('orders.page.thankYou')}</h1>
            <p>
              {rich(t('orders.page.confirmation'), {
                number: (
                  <strong className="text-sf-heading" data-testid="order-number">
                    {order.number}
                  </strong>
                ),
                email: order.contact.email,
              })}
            </p>
          </>
        ) : (
          <h1 className="text-3xl font-extrabold lg:text-4xl">{rich(t('orders.title'), { number: <span data-testid="order-number">{order.number}</span> })}</h1>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <OrderStatusBadge label={orderStatusLabel(t, order.status, order.status_label)} />
          <span>{rich(t('orders.placedAt'), { date: <time dateTime={order.placed_at}>{formatDateTime(order.placed_at)}</time> })}</span>
        </p>
        {accountLink && (
          <p className="text-sm">
            <Link to={`/account/orders/${encodeURIComponent(order.number)}`} className="font-semibold text-sf-link hover:underline" data-testid="account-order-link">
              {t('orders.page.trackInAccount')}
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
            {t('orders.continueShopping')}
          </Link>
        </div>
      </div>
    </section>
  )
}
