import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ShoppingBagIcon } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { useLocale } from '../i18n/locale'
import { useCartQuery } from './api'
import { CartDrawerContext } from './cart-drawer-context'
import { CartLines, CartTotals } from './cart-lines'
import { CheckoutButton } from './checkout-button'
import { CouponBox } from './coupon-box'
import { displayQuantity } from './quantity'

/**
 * The mini-cart: a drawer from the right (focus moves in and stays there, Escape closes it,
 * focus returns to whatever opened it). Opened by the header cart button and after "Add to cart".
 */
export function CartDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const api = useMemo(
    () => ({
      open: (returnFocusTo?: HTMLElement | null) => {
        opener.current = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        setOpen(true)
      },
      close: () => setOpen(false),
    }),
    [],
  )

  return (
    <CartDrawerContext value={api}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[26rem] max-w-[92vw] gap-0 bg-sf-surface p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current?.isConnected) opener.current.focus()
            opener.current = null
          }}
        >
          {open && <MiniCartBody onClose={() => setOpen(false)} />}
        </SheetContent>
      </Sheet>
    </CartDrawerContext>
  )
}

function MiniCartBody({ onClose }: { onClose: () => void }) {
  const cart = useCartQuery()
  const data = cart.data
  const { t } = useLocale()
  const count = data ? displayQuantity(data.item_count) : null

  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <SheetTitle className="font-heading text-xl font-extrabold text-sf-heading">
          {count && count !== '0' ? t('cart.drawer.titleWithCount', { count: Number(count) }) : t('cart.drawer.title')}
        </SheetTitle>
        <SheetDescription className="sr-only">{t('cart.drawer.description')}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-5" data-testid="mini-cart">
        {data ? (
          data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <ShoppingBagIcon aria-hidden className="size-12 text-sf-border" />
              <p className="font-semibold text-sf-heading">{t('cart.page.empty')}</p>
              <button type="button" className={primaryButtonClass} onClick={onClose}>
                {t('cart.page.continueShopping')}
              </button>
            </div>
          ) : (
            <CartLines cart={data} compact onNavigate={onClose} />
          )
        ) : cart.error ? (
          <div className="py-16 text-center">
            <p role="alert">{t('cart.drawer.loadFailed')}</p>
            <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={() => void cart.refetch()}>
              {t('common.tryAgain')}
            </button>
          </div>
        ) : (
          <div role="status" className="grid place-items-center py-16">
            <span className="size-8 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
            <span className="sr-only">{t('cart.page.loading')}</span>
          </div>
        )}
      </div>

      {data && data.items.length > 0 && (
        <div className="flex flex-col gap-3 border-t px-5 py-4">
          <CouponBox cart={data} compact />
          <CartTotals cart={data} compact />
          <CheckoutButton cart={data} onNavigate={onClose} />
          <Link to="/cart" onClick={onClose} className={secondaryButtonClass}>
            {t('cart.drawer.viewCart')}
          </Link>
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            {t('cart.page.continueShopping')}
          </button>
        </div>
      )}
    </>
  )
}
