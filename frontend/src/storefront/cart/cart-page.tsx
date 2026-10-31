import { Link } from 'react-router'
import { CircleAlertIcon, ShoppingBagIcon } from 'lucide-react'
import { primaryButtonClass, secondaryButtonClass, Spinner } from '../account/form-controls'
import { useDocumentTitle } from '../use-document-title'
import { useCartQuery } from './api'
import { CartLines, CartTotals } from './cart-lines'
import { CheckoutButton } from './checkout-button'
import { CouponBox } from './coupon-box'
import { displayQuantity } from './quantity'

/**
 * The cart as the server prices it right now. Lines that are no longer available or above the
 * stock stay listed and flagged (with a one-click fix); the totals leave them out. Discounts
 * and the coupon box sit with the totals.
 */
export function CartPage() {
  useDocumentTitle('Cart')
  const cart = useCartQuery()
  const data = cart.data

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-testid="cart-page">
      <h1 className="text-3xl font-extrabold lg:text-4xl">Your cart</h1>

      {cart.error && !data ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-8 text-center">
          <p role="alert">Your cart could not be loaded. Please try again.</p>
          <button type="button" className={`${primaryButtonClass} mt-4`} disabled={cart.isFetching} onClick={() => void cart.refetch()}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <Spinner label="Loading your cart" />
      ) : data.items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-sf-card bg-sf-surface p-10 text-center">
          <ShoppingBagIcon aria-hidden className="size-14 text-sf-border" />
          <p className="text-lg font-semibold text-sf-heading">Your cart is empty.</p>
          <Link to="/shop" className={primaryButtonClass}>
            Start shopping
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm">
            {displayQuantity(data.item_count)} {displayQuantity(data.item_count) === '1' ? 'item' : 'items'}
          </p>
          {data.items.some((line) => !line.purchasable || !line.in_stock || line.exceeds_stock) && (
            <p role="status" className="mt-4 flex items-start gap-2 rounded-sf-card bg-sf-sale/10 px-4 py-3 text-sm font-medium text-sf-sale">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              Some items in your cart need your attention. Items that are not available are not included in the total.
            </p>
          )}
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
            <CartLines cart={data} />
            <aside aria-labelledby="cart-summary-heading" className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-6 lg:sticky lg:top-40">
              <h2 id="cart-summary-heading" className="text-xl font-bold">
                Cart totals
              </h2>
              <CouponBox cart={data} />
              <CartTotals cart={data} />
              <CheckoutButton cart={data} />
              <Link to="/shop" className={secondaryButtonClass}>
                Continue shopping
              </Link>
            </aside>
          </div>
        </>
      )}
    </section>
  )
}
