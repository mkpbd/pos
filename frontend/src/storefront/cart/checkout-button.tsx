import { useId } from 'react'
import { Link } from 'react-router'
import { LockIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { primaryButtonClass } from '../account/form-controls'
import { useLocale } from '../i18n/locale'
import type { Cart } from '../types'
import { cartNeedsAttention } from './cart-helpers'

/**
 * "Checkout" on the cart page and in the mini-cart. While the cart is empty or has flagged
 * lines the button is disabled and says why (the checkout would refuse the cart anyway).
 */
export function CheckoutButton({ cart, onNavigate, className }: { cart: Cart; onNavigate?: () => void; className?: string }) {
  const reasonId = useId()
  const { t } = useLocale()
  const reason = cart.items.length === 0 ? t('cart.checkoutBlocked.empty') : cartNeedsAttention(cart) ? t('cart.checkoutBlocked.fix') : null

  if (reason) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <button type="button" className={primaryButtonClass} disabled aria-describedby={reasonId}>
          <LockIcon aria-hidden className="size-4" />
          {t('cart.checkout')}
        </button>
        <p id={reasonId} className="text-sm text-sf-sale" data-testid="checkout-blocked">
          {reason}
        </p>
      </div>
    )
  }
  return (
    <Link to="/checkout" onClick={onNavigate} className={cn(primaryButtonClass, className)}>
      <LockIcon aria-hidden className="size-4" />
      {t('cart.checkout')}
    </Link>
  )
}
