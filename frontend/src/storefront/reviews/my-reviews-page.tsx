import { useState } from 'react'
import { Link } from 'react-router'
import { MessageSquareTextIcon, PencilIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountShell } from '../account/account-pages'
import { Spinner, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { ProductImage } from '../catalog/product-image'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import type { MyReview } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { reviewStatusLabel, useMyReviewsQuery } from './api'
import { ReviewDialog, type ReviewTarget } from './review-dialog'
import { Stars } from './stars'

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-sf-primary/20 text-sf-heading',
  approved: 'bg-sf-highlight/20 text-sf-heading',
  rejected: 'bg-sf-sale/15 text-sf-sale',
}

/** /account/reviews — the customer's own reviews in every status, editable and deletable. */
export function MyReviewsPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('reviews.mine.title')))
  const reviews = useMyReviewsQuery()
  const [editing, setEditing] = useState<ReviewTarget | null>(null)

  return (
    <AccountShell title={t('reviews.mine.title')}>
      <p className="text-sm">
        {t('reviews.mine.intro')}
      </p>
      {reviews.error ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(reviews.error, t)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void reviews.refetch()}>
            {t('common.tryAgain')}
          </button>
        </div>
      ) : !reviews.data ? (
        <Spinner label={t('reviews.mine.loading')} />
      ) : reviews.data.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-sf-card bg-sf-surface p-10 text-center" data-testid="reviews-empty">
          <MessageSquareTextIcon aria-hidden className="size-12 text-sf-border" />
          <p className="font-semibold text-sf-heading">{t('reviews.mine.empty')}</p>
          <Link to="/account/orders?status=delivered" className={primaryButtonClass}>
            {t('reviews.mine.reviewDelivered')}
          </Link>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-4" aria-label={t('reviews.mine.list')}>
          {reviews.data.map((review) => (
            <li key={review.id}>
              <ReviewCard review={review} onEdit={() => setEditing({ mode: 'edit', review, productName: review.product?.name ?? t('reviews.mine.product') })} />
            </li>
          ))}
        </ul>
      )}
      <ReviewDialog target={editing} onClose={() => setEditing(null)} />
    </AccountShell>
  )
}

function ReviewCard({ review, onEdit }: { review: MyReview; onEdit: () => void }) {
  const { t, formatDateTime } = useLocale()
  const product = review.product
  const image = product?.image ?? (product?.image_url ? { url: product.image_url, alt: null } : null)
  const name = product?.name ?? t('reviews.mine.product')

  return (
    <article className="flex gap-4 rounded-sf-card bg-sf-surface p-5" data-testid="my-review" aria-label={t('reviews.mine.reviewOf', { name })}>
      <ProductImage image={image} alt={name} className="w-16 shrink-0 self-start rounded-lg border" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {product?.slug ? (
            <Link to={`/product/${product.slug}`} className="font-heading text-base font-bold text-sf-heading hover:text-sf-accent">
              {name}
            </Link>
          ) : (
            <span className="font-heading text-base font-bold text-sf-heading">{name}</span>
          )}
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', STATUS_TONE[review.status] ?? 'bg-sf-canvas')} data-testid="review-status">
            {reviewStatusLabel(review.status, t)}
          </span>
        </div>
        <p className="flex items-center gap-2">
          <Stars rating={review.rating} />
          <time dateTime={review.created_at} className="text-xs">
            {formatDateTime(review.created_at)}
          </time>
        </p>
        {review.title && <p className="font-semibold text-sf-heading">{review.title}</p>}
        <p className="whitespace-pre-line">{review.body}</p>
        {review.status === 'rejected' && review.rejection_reason && (
          <p className="rounded-lg bg-sf-sale/10 px-3 py-2 text-sf-sale" data-testid="rejection-reason">
            {t('reviews.mine.notPublished', { reason: review.rejection_reason })}
          </p>
        )}
        <div>
          <button type="button" className={secondaryButtonClass} onClick={onEdit} aria-label={t('reviews.mine.editLabel', { name })}>
            <PencilIcon aria-hidden className="size-4" />
            {t('reviews.mine.edit')}
          </button>
        </div>
      </div>
    </article>
  )
}
