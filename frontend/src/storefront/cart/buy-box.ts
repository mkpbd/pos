import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useLocale } from '../i18n/locale'
import type { ProductDetail, ProductVariant } from '../types'
import { useAddToCartMutation } from './api'
import { useCartDrawer } from './cart-drawer-context'
import { cartErrorMessage, maxQuantityHint } from './quantity'

/** Where a buy action was pressed: the product's own form or the quick-buy bar (P1b). Errors show where they happened. */
export type BuySource = 'form' | 'bar'
export type BuyIntent = 'cart' | 'buy'

type BuyState = {
  /** The variant the state belongs to; a new variant starts afresh (quantity 1, no stock limit, no error). */
  key: string
  quantity: string
  /** The stock limit a refused add reported; null = only the 999 cap. */
  max: string | null
  error: { message: string; source: BuySource } | null
  pressed: { intent: BuyIntent; source: BuySource } | null
}

const fresh = (key: string): BuyState => ({ key, quantity: '1', max: null, error: null, pressed: null })

/** Fetches the checkout page's code ahead of "Buy now" (the same chunk as the /checkout route). */
export function prefetchCheckout() {
  void import('../checkout/checkout-page')
}

/**
 * The buy state of one product view: quantity, stock limit, errors and the pending action, shared by
 * the product page's form and its quick-buy bar (P1b) so both show the same quantity. "Add to cart"
 * opens the mini-cart; "Buy now" adds the same line and goes straight to the checkout. Nothing is
 * priced here: the server reprices the cart.
 */
export function useBuyBox(product: ProductDetail, variant: ProductVariant | null, options: { onAdded?: () => void } = {}) {
  const add = useAddToCartMutation()
  const drawer = useCartDrawer()
  const navigate = useNavigate()
  const { t } = useLocale()
  const key = variant?.id ?? ''
  const [state, setState] = useState<BuyState>(() => fresh(key))
  const current = state.key === key ? state : fresh(key)
  // A shopper's change applies to the variant shown; an answer arriving later only to the variant it was for.
  const update = (patch: Partial<BuyState>) => setState((previous) => ({ ...(previous.key === key ? previous : fresh(key)), ...patch }))
  const settle = (forKey: string, patch: Partial<BuyState>) => setState((previous) => (previous.key === forKey ? { ...previous, ...patch } : previous))

  const soldOut = Boolean(variant && !variant.in_stock)
  const unavailable = !variant || !variant.in_stock

  const submit = (intent: BuyIntent, source: BuySource, button: HTMLElement | null) => {
    if (!variant || unavailable || add.isPending) return
    const forKey = key
    update({ error: null, pressed: { intent, source } })
    add.mutate(
      { variant_id: variant.id, quantity: current.quantity },
      {
        onSuccess: () => {
          settle(forKey, { max: null, pressed: null })
          options.onAdded?.()
          if (intent === 'buy') void navigate('/checkout')
          else drawer?.open(button)
        },
        onError: (error) => {
          const hint = maxQuantityHint(error)
          settle(forKey, { error: { message: cartErrorMessage(error, t), source }, pressed: null, ...(hint && hint !== '0' ? { max: hint } : {}) })
        },
      },
    )
  }

  return {
    quantity: current.quantity,
    setQuantity: (quantity: string) => update({ quantity }),
    max: current.max,
    allowDecimal: product.allow_decimal ?? false,
    /** True while an add is on its way (buttons stay focusable: aria-disabled). */
    busy: add.isPending,
    /** The button that is adding right now, for its spinner. */
    pending: (intent: BuyIntent, source: BuySource) => add.isPending && current.pressed?.intent === intent && current.pressed.source === source,
    errorFor: (source: BuySource) => (current.error?.source === source ? current.error.message : null),
    soldOut,
    unavailable,
    /** Why the buttons are disabled (no variant chosen, or it is sold out); null when buyable. */
    reason: !variant ? t('cart.add.chooseOptionsFirst') : soldOut ? t('cart.add.optionOutOfStock') : null,
    addToCart: (source: BuySource, button: HTMLElement | null) => submit('cart', source, button),
    buyNow: (source: BuySource, button: HTMLElement | null) => submit('buy', source, button),
  }
}

export type BuyBox = ReturnType<typeof useBuyBox>
