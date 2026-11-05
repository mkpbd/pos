import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useModerateReviewMutation, useReviewsQuery, type ModerationInput, type Review } from '@/features/reviews/api'
import { RejectReviewDialog } from '@/features/reviews/components/reject-review-dialog'
import { StarRating } from '@/features/reviews/components/star-rating'
import {
  RATINGS,
  ratingOptionLabel,
  REVIEW_TAB_LABELS,
  REVIEW_TABS,
  reviewFiltersFromSearchParams,
  reviewFiltersToSearchParams,
  reviewListParams,
  reviewStatusBadge,
  type ReviewFilters,
  type ReviewTab,
} from '@/features/reviews/reviews'
import { formatDateTime } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ANY = 'any'

const SUCCESS: Record<ModerationInput['action'], string> = {
  approve: 'Review approved. It is now shown in the store.',
  reject: 'Review rejected.',
  delete: 'Review deleted.',
}

const EMPTY_TITLES: Record<ReviewTab, string> = {
  pending: 'No reviews waiting for moderation',
  approved: 'No approved reviews',
  rejected: 'No rejected reviews',
  all: 'No reviews yet',
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return 'This review no longer exists; the list was refreshed.'
  return error instanceof Error ? error.message : 'Something went wrong.'
}

type CardProps = {
  review: Review
  timeZone: string | undefined
  canModerate: boolean
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onDelete: () => void
}

function ReviewCard({ review, timeZone, canModerate, busy, onApprove, onReject, onDelete }: CardProps) {
  const badge = reviewStatusBadge(review.status)
  const moderated = !!review.moderated_at && review.status !== 'pending'

  return (
    <li className="flex flex-col gap-2 rounded-md border p-4" aria-label={`Review of ${review.product.name} by ${review.customer.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{review.product.name}</p>
          <p className="text-sm break-words text-muted-foreground">
            {review.customer.name}
            {review.customer.email && (
              <>
                {' · '}
                <a className="underline" href={`mailto:${review.customer.email}`}>{review.customer.email}</a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm whitespace-nowrap text-muted-foreground">{formatDateTime(review.created_at, timeZone)}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StarRating rating={review.rating} />
        <span className="text-xs text-muted-foreground">Verified purchase</span>
      </div>
      {review.title && <p className="font-medium break-words">{review.title}</p>}
      <p className="text-sm break-words whitespace-pre-line">{review.body}</p>
      {moderated && (
        <p className="text-xs text-muted-foreground" data-testid="review-moderation">
          {review.status === 'approved' ? 'Approved' : 'Rejected'}
          {review.moderated_by_name && ` by ${review.moderated_by_name}`} · {formatDateTime(review.moderated_at, timeZone)}
        </p>
      )}
      {review.status === 'rejected' && review.rejection_reason && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm">
          <span className="font-medium">Reason:</span> {review.rejection_reason}
        </p>
      )}
      {canModerate && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Moderation actions">
          {review.status !== 'approved' && (
            <Button size="sm" disabled={busy} onClick={onApprove}>
              <CheckIcon data-icon="inline-start" /> Approve
            </Button>
          )}
          {review.status !== 'rejected' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
              <XIcon data-icon="inline-start" /> Reject
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
            <Trash2Icon data-icon="inline-start" /> Delete
          </Button>
        </div>
      )}
    </li>
  )
}

export function ReviewsPage() {
  const me = useAuth()
  const can = useCan()
  const canModerate = can('reviews.moderate')
  const timeZone = me.organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = reviewFiltersFromSearchParams(searchParams)
  // The box is local so typing stays smooth; the URL follows the debounced term.
  const [search, setSearch] = useState(filters.search)
  const term = useDebouncedValue(search.trim(), 300)
  const params = reviewListParams(filters, term)
  const reviews = useReviewsQuery(params)
  const moderate = useModerateReviewMutation()
  const [rejecting, setRejecting] = useState<Review | null>(null)
  const [rejectError, setRejectError] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<Review | null>(null)

  const update = (patch: Partial<ReviewFilters>) =>
    setSearchParams(reviewFiltersToSearchParams({ ...filters, search: search.trim(), page: 1, ...patch }), { replace: true })

  // The address follows the debounced search term (back to page 1 for a new term).
  const urlSearch = filters.search
  useEffect(() => {
    if (term === urlSearch) return
    setSearchParams(
      (current) => {
        const next = reviewFiltersFromSearchParams(current)
        return reviewFiltersToSearchParams({ ...next, search: term, page: 1 })
      },
      { replace: true },
    )
  }, [term, urlSearch, setSearchParams])
  const filtered = !!(filters.rating || term)

  const run = (input: ModerationInput, onDone?: () => void) =>
    moderate.mutate(input, {
      onSuccess: () => {
        toast.success(SUCCESS[input.action])
        onDone?.()
      },
      onError: (error) => {
        if (input.action === 'reject' && error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
          const errors = fieldErrorMap(error)
          setRejectError(errors.reason ?? errors.form ?? error.message)
          return
        }
        toast.error(errorMessage(error))
        onDone?.()
      },
    })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="Product reviews from customers with a delivered order. Only approved reviews are shown in the store."
        actions={<ExportMenu list="reviews" query={params} disabled={!reviews.data?.items.length} />}
      />
      {!canModerate && <p className="-mt-3 text-sm text-muted-foreground" data-testid="reviews-read-only">You can read reviews; approving, rejecting and deleting them needs moderation rights.</p>}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={filters.tab} onValueChange={(v) => update({ tab: v as ReviewTab })}>
              <TabsList aria-label="Review status">
                {REVIEW_TABS.map((t) => <TabsTrigger key={t} value={t}>{REVIEW_TAB_LABELS[t]}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <Select value={filters.rating ? String(filters.rating) : ANY} onValueChange={(v) => update({ rating: v === ANY ? null : Number(v) })}>
              <SelectTrigger aria-label="Filter by rating" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any rating</SelectItem>
                {RATINGS.map((r) => <SelectItem key={r} value={String(r)}>{ratingOptionLabel(r)}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Product, customer or review text"
                aria-label="Search reviews"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {reviews.isPending ? (
            <LoadingState label="Loading reviews" />
          ) : reviews.error ? (
            <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
          ) : reviews.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? 'No matching reviews' : EMPTY_TITLES[filters.tab]}
              description={filtered ? undefined : 'Customers can review products from their delivered orders.'}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3" aria-label="Reviews">
                {reviews.data.items.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    timeZone={timeZone}
                    canModerate={canModerate}
                    busy={moderate.isPending}
                    onApprove={() => run({ id: r.id, action: 'approve' })}
                    onReject={() => {
                      setRejectError(undefined)
                      setRejecting(r)
                    }}
                    onDelete={() => setDeleting(r)}
                  />
                ))}
              </ul>
              <PaginationBar pagination={reviews.data.pagination} onPageChange={(page) => update({ page })} />
            </>
          )}
        </CardContent>
      </Card>

      {rejecting && (
        <RejectReviewDialog
          key={rejecting.id}
          review={rejecting}
          pending={moderate.isPending}
          error={rejectError}
          onClose={() => setRejecting(null)}
          onReject={(reason) => run({ id: rejecting.id, action: 'reject', reason }, () => setRejecting(null))}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !moderate.isPending) setDeleting(null)
        }}
        title="Delete this review?"
        description={deleting ? `${deleting.customer.name}'s review of ${deleting.product.name} is removed for good. The customer can then write a new one.` : ''}
        confirmLabel="Delete review"
        pending={moderate.isPending}
        onConfirm={() => {
          if (deleting) run({ id: deleting.id, action: 'delete' }, () => setDeleting(null))
        }}
      />
    </div>
  )
}
