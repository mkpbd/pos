import type { Review } from '@/features/reviews/api'
import { makeCurrentUser } from '@/test/fixtures'

export const reviewModerator = () => makeCurrentUser({ permissions: ['reviews.view', 'reviews.moderate', 'web_orders.view'] })
export const reviewViewer = () => makeCurrentUser({ permissions: ['reviews.view'] })

export const review = (overrides: Partial<Review> = {}): Review => ({
  id: 'rv-1',
  product: { id: 'p-1', name: 'Pran Mango Juice 1L' },
  customer: { id: 'c-1', name: 'Ayesha Rahman', email: 'ayesha@example.com' },
  rating: 4,
  title: 'Tastes fresh',
  body: 'Arrived cold and well packed. Will buy again.',
  status: 'pending',
  created_at: '2026-10-31T04:30:00Z',
  moderated_at: null,
  moderated_by_name: null,
  rejection_reason: null,
  ...overrides,
})
