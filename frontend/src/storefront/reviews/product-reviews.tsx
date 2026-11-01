import { useId, useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { BadgeCheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCustomer } from '../account/api'
import { inputClass, primaryButtonClass } from '../account/form-controls'
import { formatDateTime } from '../checkout/delivery'
import type { ProductDetail, RatingSummary, ReviewSort } from '../types'
import { useProductReviewsQuery, type ReviewQuery } from './api'
import { REVIEWS_SECTION_ID, reviewsLabel } from './display'
import { Stars } from './stars'


/** Stars + "4.5 (12 reviews)" near the product title, opening the Reviews tab. Nothing without approved reviews. */
export function RatingSummaryLink({ rating, onOpen }: { rating: ProductDetail['rating']; onOpen: () => void }) {
  if (!rating || rating.count === 0) return null
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    onOpen()
  }
  return (
    <a href={`#${REVIEWS_SECTION_ID}`} onClick={open} className="inline-flex items-center gap-2 self-start text-sm hover:text-sf-accent" data-testid="rating-summary">
      <Stars rating={rating.average} />
      <span>
        <span className="font-semibold text-sf-heading">{rating.average}</span> ({reviewsLabel(rating.count)})
      </span>
    </a>
  )
}

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'highest', label: 'Highest rating' },
  { value: 'lowest', label: 'Lowest rating' },
]

const RATINGS = [5, 4, 3, 2, 1] as const

function Distribution({ summary, active, onPick }: { summary: RatingSummary; active: number | null; onPick: (rating: number | null) => void }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Ratings breakdown">
      {RATINGS.map((n) => {
        const count = summary.distribution[String(n) as '1'] ?? 0
        const share = summary.count > 0 ? Math.round((count / summary.count) * 100) : 0
        return (
          <li key={n}>
            <button
              type="button"
              className={cn('flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-sf-canvas disabled:cursor-default disabled:hover:bg-transparent', active === n && 'bg-sf-canvas font-semibold')}
              disabled={count === 0}
              aria-pressed={active === n}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}: ${count} ${count === 1 ? 'review' : 'reviews'} (${share} %)`}
              onClick={() => onPick(active === n ? null : n)}
            >
              <span aria-hidden className="w-12 shrink-0 text-left">
                {n} star
              </span>
              <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-sf-border">
                <span className="block h-full rounded-full bg-sf-primary" style={{ width: `${share}%` }} />
              </span>
              <span aria-hidden className="w-8 shrink-0 text-right">
                {count}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The Reviews tab: summary with distribution bars, sort, rating filter, approved reviews 10 per page. */
export function ProductReviews({ slug }: { slug: string }) {
  const [query, setQuery] = useState<ReviewQuery>({ sort: 'newest', rating: null, page: 1 })
  const reviews = useProductReviewsQuery(slug, query)
  const customer = useCustomer()
  const sortId = useId()
  const ratingId = useId()
  const data = reviews.data
  const summary = data?.summary

  const change = (next: Partial<ReviewQuery>) => setQuery((current) => ({ ...current, page: 1, ...next }))

  const hint = customer ? (
    <p className="text-sm" data-testid="review-hint">
      Bought this?{' '}
      <Link to="/account/orders" className="font-semibold text-sf-accent hover:underline">
        Review it from your orders.
      </Link>
    </p>
  ) : null

  if (reviews.error && !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">The reviews could not be loaded.</p>
        <button type="button" className={primaryButtonClass} disabled={reviews.isFetching} onClick={() => void reviews.refetch()}>
          Try again
        </button>
      </div>
    )
  }
  if (!data || !summary) {
    return (
      <div role="status" className="grid min-h-32 place-items-center">
        <span className="size-8 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">Loading the reviews</span>
      </div>
    )
  }

  if (summary.count === 0) {
    return (
      <div className="flex flex-col gap-2" data-testid="reviews-empty">
        <p className="font-semibold text-sf-heading">No reviews yet</p>
        {hint}
      </div>
    )
  }

  const { current_page: page, last_page: last } = data.pagination

  return (
    <div className="grid gap-8 md:grid-cols-[16rem_1fr]" data-testid="product-reviews">
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-heading text-4xl font-extrabold text-sf-heading">{summary.average}</p>
          <Stars rating={summary.average} size="size-5" />
          <p className="mt-1 text-sm">Based on {reviewsLabel(summary.count)}</p>
        </div>
        <Distribution summary={summary} active={query.rating} onPick={(rating) => change({ rating })} />
        {hint}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={sortId} className="text-xs font-semibold text-sf-heading">
              Sort by
            </label>
            <select id={sortId} className={cn(inputClass, 'w-auto py-1.5 text-sm')} value={query.sort} onChange={(e) => change({ sort: e.target.value as ReviewSort })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ratingId} className="text-xs font-semibold text-sf-heading">
              Rating
            </label>
            <select id={ratingId} className={cn(inputClass, 'w-auto py-1.5 text-sm')} value={query.rating ?? ''} onChange={(e) => change({ rating: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All ratings</option>
              {RATINGS.map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'star' : 'stars'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {data.reviews.length === 0 ? (
          <p className="text-sm" data-testid="reviews-filter-empty">
            No reviews with this rating.
          </p>
        ) : (
          <ul className={cn('flex flex-col divide-y transition-opacity', reviews.isPlaceholderData && 'opacity-60')} aria-label="Reviews" aria-busy={reviews.isPlaceholderData}>
            {data.reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-1.5 py-4 first:pt-0" data-testid="review">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars rating={review.rating} />
                  {review.title && <p className="font-semibold text-sf-heading">{review.title}</p>}
                </div>
                <p className="flex flex-wrap items-center gap-x-3 text-xs">
                  <span className="font-semibold text-sf-heading">{review.author}</span>
                  <time dateTime={review.created_at}>{formatDateTime(review.created_at)}</time>
                  {review.verified && (
                    <span className="inline-flex items-center gap-1 text-sf-highlight">
                      <BadgeCheckIcon aria-hidden className="size-3.5" />
                      Verified purchase
                    </span>
                  )}
                </p>
                <p className="text-sm whitespace-pre-line">{review.body}</p>
              </li>
            ))}
          </ul>
        )}

        {last > 1 && (
          <nav aria-label="Reviews pages" className="flex items-center justify-between gap-3 text-sm">
            <button type="button" className="inline-flex items-center gap-1 font-semibold text-sf-accent disabled:text-sf-border" disabled={page <= 1 || reviews.isFetching} onClick={() => setQuery((q) => ({ ...q, page: page - 1 }))}>
              <ChevronLeftIcon aria-hidden className="size-4" />
              Previous
            </button>
            <span>
              Page {page} of {last}
            </span>
            <button type="button" className="inline-flex items-center gap-1 font-semibold text-sf-accent disabled:text-sf-border" disabled={page >= last || reviews.isFetching} onClick={() => setQuery((q) => ({ ...q, page: page + 1 }))}>
              Next
              <ChevronRightIcon aria-hidden className="size-4" />
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
