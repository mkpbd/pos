import { compareDecimal } from '@/lib/money'
import { usePriceFormat } from '../money'
import { isReduced, useLivePromotion } from '../promotions/display'
import type { ProductCard as Card } from '../types'

/**
 * How a card prices a product: the live promotion's price (struck base price), else the price or
 * range of the variants with the compare-at price when on sale. Shared by every card style.
 */
export function useCardPricing(product: Card) {
  const format = usePriceFormat()
  const promotion = useLivePromotion(product.promotion)
  const range = compareDecimal(product.price, product.price_max) !== 0
  const priceMax = range ? product.price_max : undefined
  const compareAt = product.on_sale && !priceMax ? product.compare_at_price : null
  const promoPrice = promotion && isReduced(promotion.price, product.price) ? promotion.price : null
  const promotionLabel = promotion ? format.badge(promotion) : null
  return { promotion, range, priceMax, compareAt, promoPrice, promotionLabel }
}

export type CardPricing = ReturnType<typeof useCardPricing>
