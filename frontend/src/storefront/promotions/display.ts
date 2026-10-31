import { compareDecimal } from '@/lib/money'
import { usePriceFormat } from '../money'
import type { DisplayPromotion, ProductDetail, ProductVariant } from '../types'
import { usePromotionLive } from './countdown'

/**
 * The product promotion while it lasts: null once its end has passed in this browser (the
 * server stops applying it then; the next fetch drops it too).
 */
export function useLivePromotion(promotion: DisplayPromotion | null | undefined): DisplayPromotion | null {
  const live = usePromotionLive(promotion?.ends_at)
  return promotion && live ? promotion : null
}

/** True when the promotional price is really below the base price (worth striking it through). */
export function isReduced(promoPrice: string | null | undefined, basePrice: string): promoPrice is string {
  return typeof promoPrice === 'string' && compareDecimal(promoPrice, basePrice) < 0
}

/**
 * The promotion of the product for the selected variant (or for the product while none is
 * chosen): the promotional price, the base price it replaces and the badge. Null when the
 * variant is not part of the promotion.
 */
export function usePromotionPricing(product: ProductDetail, variant: ProductVariant | null): { promotion: DisplayPromotion; price: string; base: string; label: string | null } | null {
  const promotion = useLivePromotion(product.promotion)
  const format = usePriceFormat()
  if (!promotion) return null
  const base = variant ? variant.price : product.price
  const price = variant ? variant.promo_price : promotion.price
  if (!isReduced(price, base)) return null
  return { promotion, price, base, label: format.badge(promotion) }
}
