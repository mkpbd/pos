import type { Review } from '@/features/reviews/api'
import type { ProductQuestion } from '@/features/reviews/questions-api'
import { makeCurrentUser } from '@/test/fixtures'

/** P1b: a shopper's question as GET /reviews/questions lists it (used by Vitest only). */
export const question = (overrides: Partial<ProductQuestion> = {}): ProductQuestion => ({
  id: 'q-1',
  product: { id: 'p-1', name: 'Pran Mango Juice 1L', slug: 'pran-mango-juice-1l' },
  name: 'Rina Akter',
  email: 'rina@example.com',
  question: 'Is it made with real mangoes?',
  answer: null,
  status: 'pending',
  locale: 'en',
  created_at: '2026-11-10T04:30:00Z',
  answered_at: null,
  answered_by_name: null,
  ...overrides,
})

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
