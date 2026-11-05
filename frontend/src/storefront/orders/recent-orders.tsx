import { Link } from 'react-router'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import { useAccountOrdersQuery } from './account-api'
import { OrderRow } from './order-row'

/** The account overview's "Recent orders" card: the last three orders. */
export function RecentOrders() {
  const { t } = useLocale()
  const orders = useAccountOrdersQuery(null, 1)
  const recent = orders.data?.items.slice(0, 3) ?? []

  return (
    <section aria-labelledby="recent-orders" className="mt-6 flex flex-col gap-3 rounded-sf-card bg-sf-canvas/60" data-testid="recent-orders">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-orders" className="font-heading text-xl font-bold text-sf-heading">
          {t('orders.recent.title')}
        </h2>
        {recent.length > 0 && (
          <Link to="/account/orders" className="text-sm font-semibold text-sf-accent hover:underline">
            {t('orders.recent.viewAll')}
          </Link>
        )}
      </div>
      {orders.error ? (
        <p role="alert" className="text-sm">
          {t('orders.recent.failed', { error: storeFormError(orders.error, t) })}
        </p>
      ) : !orders.data ? (
        <p role="status" className="text-sm">
          {t('orders.recent.loading')}
        </p>
      ) : recent.length === 0 ? (
        <p className="text-sm">
          {t('orders.list.empty.all')}{' '}
          <Link to="/shop" className="font-semibold text-sf-accent hover:underline">
            {t('orders.startShopping')}
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('orders.recent.title')}>
          {recent.map((row) => (
            <li key={row.number}>
              <OrderRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
