import type { ProductDetail } from '../types'

export const REVIEWS_TAB_ID = 'reviews'
export const REVIEWS_SECTION_ID = 'product-reviews'

export const reviewsLabel = (count: number) => `${count} ${count === 1 ? 'review' : 'reviews'}`

/** The product page's tab label: "Reviews (12)". */
export function reviewsTabLabel(rating: ProductDetail['rating']): string {
  return rating && rating.count > 0 ? `Reviews (${rating.count})` : 'Reviews'
}
