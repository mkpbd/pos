import type { Translate } from '../i18n/translate'
import type { ProductDetail } from '../types'

export const REVIEWS_TAB_ID = 'reviews'
export const REVIEWS_SECTION_ID = 'product-reviews'

/** "12 reviews" in the storefront's language. */
export const reviewsLabel = (count: number, t: Translate) => t('reviews.count', { count })

/** The product page's tab label: "Reviews (12)". */
export function reviewsTabLabel(rating: ProductDetail['rating'], t: Translate): string {
  return rating && rating.count > 0 ? t('reviews.tabWithCount', { count: rating.count }) : t('reviews.tab')
}
