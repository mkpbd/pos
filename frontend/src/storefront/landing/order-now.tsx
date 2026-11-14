import { useEffect, useRef, useState } from 'react'
import { ShoppingBagIcon } from 'lucide-react'
import { currentPrice } from '../cart/add-several'
import { useBottomBarSpace } from '../catalog/use-viewport'
import { useIsTabletUp } from '../components/use-media-query'
import { isOrderFormData } from '../builder/elements/guards'
import type { BuilderPage } from '../builder/types'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import { startVariant } from './order-form-logic'
import { ORDER_PLACED_EVENT, orderFormAnchor, orderFormsOf } from './order-now-shared'

/*
 * P2a sticky "Order now" on landing pages: on phones, a page with an order form gets a bar fixed
 * to the bottom (above a B8b bottom bar, clear of the home indicator) whose button takes the
 * shopper to the form. It hides while the form is on screen and after the order is placed.
 */

/** The bar of a landing page, for its first order form (nothing on tablets and up, or without one). */
export function OrderNowBar({ page }: { page: BuilderPage }) {
  const tabletUp = useIsTabletUp()
  const target = orderFormsOf(page)[0]
  if (tabletUp || !target) return null
  return <Bar page={page} elementId={target} />
}

function Bar({ page, elementId }: { page: BuilderPage; elementId: string }) {
  const { t } = useLocale()
  const format = usePriceFormat()
  const ref = useRef<HTMLDivElement>(null)
  const [formInView, setFormInView] = useState(false)
  const [placed, setPlaced] = useState(false)
  const visible = !formInView && !placed
  useBottomBarSpace(ref, visible)

  useEffect(() => {
    const form = document.getElementById(orderFormAnchor(elementId))
    if (!form || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setFormInView(entry.isIntersecting)
    })
    observer.observe(form)
    return () => observer.disconnect()
  }, [elementId])

  useEffect(() => {
    const onPlaced = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === elementId) setPlaced(true)
    }
    window.addEventListener(ORDER_PLACED_EVENT, onPlaced)
    return () => window.removeEventListener(ORDER_PLACED_EVENT, onPlaced)
  }, [elementId])

  const data = page.data[elementId]
  const variant = data && isOrderFormData(data) ? startVariant(data.product) : null

  const go = () => {
    const form = document.getElementById(orderFormAnchor(elementId))
    if (!form) return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    form.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    form.focus({ preventScroll: true })
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('landing.orderNow.region')}
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      data-state={visible ? 'open' : 'closed'}
      className="sf-quick-buy fixed inset-x-0 z-40 border-t border-sf-border bg-sf-surface shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)]"
      data-testid="order-now-bar"
    >
      <div className="sf-quick-buy-inner px-3 pt-2">
        <button
          type="button"
          onClick={go}
          className="sf-button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-sf-button bg-sf-button px-5 py-3 text-base font-extrabold tracking-wide text-sf-button-foreground transition hover:brightness-105"
        >
          <ShoppingBagIcon aria-hidden className="size-5" />
          {t('landing.orderNow.button')}
          {variant && (
            <span className="font-bold opacity-90">
              <span aria-hidden> · </span>
              {format.price(currentPrice(variant))}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
