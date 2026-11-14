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

/** P1b: the product page's questions & answers part. */
export const QUESTIONS_TAB_ID = 'questions'

/** "Questions (3)" — the published questions; just "Questions" without any. */
export function questionsTabLabel(count: number, t: Translate): string {
  return count > 0 ? t('reviews.questions.tabWithCount', { count }) : t('reviews.questions.tab')
}
