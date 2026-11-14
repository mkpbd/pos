import { useState } from 'react'
import { useLocale } from '../i18n/locale'
import type { ProductDetail, ProductVariant } from '../types'
import { initialVariant } from '../catalog/variant-selection'
import { useAddToCartMutation } from './api'
import { useCartDrawer } from './cart-drawer-context'
import { cartErrorMessage } from './quantity'

/** One line of a "buy these together" action: one unit of a variant. */
export type AddSeveralItem = { name: string; variantId: string }

/** How it went: how many were added, of how many, and why the others were not; `choose` = nothing was ticked. */
export type AddSeveralResult = { added: number; count: number; failures: { name: string; reason: string }[] } | 'choose' | null

/** The variant an item starts with: the product's initial variant when in stock, else the first in stock. */
export function startVariant(product: Pick<ProductDetail, 'options' | 'variants' | 'default_variant_id'>): ProductVariant | null {
  const first = initialVariant(product)
  return first?.in_stock ? first : (product.variants.find((variant) => variant.in_stock) ?? first)
}

/** A variant's price today: its promotional price when a promotion applies (E8b), else its price. */
export const currentPrice = (variant: Pick<ProductVariant, 'price' | 'promo_price'>) => variant.promo_price ?? variant.price

/**
 * Adds several variants (one unit each) one after another — the cart answers every add with the
 * whole repriced cart — and reports the outcome for a polite live region. Used by the B8a bundle
 * and the product page's "Frequently bought together" (P1b). All added: the mini-cart opens.
 */
export function useAddSeveral() {
  const add = useAddToCartMutation()
  const drawer = useCartDrawer()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AddSeveralResult>(null)

  const addAll = async (items: AddSeveralItem[], button: HTMLElement) => {
    if (busy) return
    if (items.length === 0) {
      setResult('choose')
      return
    }
    setBusy(true)
    setResult(null)
    let added = 0
    const failures: { name: string; reason: string }[] = []
    for (const item of items) {
      try {
        await add.mutateAsync({ variant_id: item.variantId, quantity: '1' })
        added += 1
      } catch (error) {
        failures.push({ name: item.name, reason: cartErrorMessage(error, t) })
      }
    }
    setBusy(false)
    setResult({ added, count: items.length, failures })
    if (failures.length === 0) drawer?.open(button)
  }

  return { busy, result, addAll }
}
