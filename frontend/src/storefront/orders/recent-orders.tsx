import { Link } from 'react-router'
import { storeFormError } from '../form-errors'
import { useAccountOrdersQuery } from './account-api'
import { OrderRow } from './order-row'

/** The account overview's "Recent orders" card: the last three orders. */
export function RecentOrders() {
  const orders = useAccountOrdersQuery(null, 1)
  const recent = orders.data?.items.slice(0, 3) ?? []

  return (
    <section aria-labelledby="recent-orders" className="mt-6 flex flex-col gap-3 rounded-sf-card bg-sf-canvas/60" data-testid="recent-orders">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-orders" className="font-heading text-xl font-bold text-sf-heading">
          Recent orders
        </h2>
        {recent.length > 0 && (
          <Link to="/account/orders" className="text-sm font-semibold text-sf-accent hover:underline">
            View all orders
          </Link>
        )}
      </div>
      {orders.error ? (
        <p role="alert" className="text-sm">
          Your orders could not be loaded. {storeFormError(orders.error)}
        </p>
      ) : !orders.data ? (
        <p role="status" className="text-sm">
          Loading your orders…
        </p>
      ) : recent.length === 0 ? (
        <p className="text-sm">
          You have not placed an order yet.{' '}
          <Link to="/shop" className="font-semibold text-sf-accent hover:underline">
            Start shopping
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Recent orders">
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
