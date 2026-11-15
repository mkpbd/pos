import { ClipboardCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { documentPath } from '../api'
import type { ReviewSummary } from '../publishing-api'
import type { useReviewsQuery } from '../publishing-api'
import { useCurrentUserQuery } from '@/features/auth/api'
import { formatStoreDateTime } from './messages'
import { ListRow } from './page-rows'
import { useScreenText } from './screen-language'

/*
 * B11: the "Waiting for approval" tab of the pages list (people who may publish): every pending
 * request with who sent it and when; Open review shows it side by side with the live page.
 */

export function ReviewsCard({ reviews, onOpen }: { reviews: ReturnType<typeof useReviewsQuery>; onOpen: (review: ReviewSummary) => void }) {
  const { t, lang } = useScreenText()
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheckIcon className="size-5" aria-hidden /> {t('reviews.title')}
        </CardTitle>
        <CardDescription>{t('reviews.text')}</CardDescription>
      </CardHeader>
      <CardContent>
        {reviews.isPending ? (
          <LoadingState rows={2} label={t('reviews.loading')} />
        ) : reviews.error ? (
          <ErrorState title={t('reviews.error')} error={reviews.error} onRetry={() => void reviews.refetch()} />
        ) : reviews.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reviews.empty')}</p>
        ) : (
          <ul className="divide-y" aria-label={t('reviews.listLabel')}>
            {reviews.data.map((review) => {
              const path = documentPath({ key: review.document.key, kind: review.document.kind, path: review.document.path ?? null })
              return (
                <ListRow
                  key={review.id}
                  testId={`review-row-${review.id}`}
                  title={review.document.title}
                  detail={
                    <>
                      {path && <span className="font-mono">{path} · </span>}
                      {t('reviews.sentBy', { name: review.submitted_by?.name ?? t('reviews.someone'), date: formatStoreDateTime(lang, review.submitted_at, timeZone) })}
                      {review.note && <span className="mt-0.5 block text-foreground">“{review.note}”</span>}
                    </>
                  }
                  status={
                    review.draft_changed ? (
                      <Badge variant="warning">
                        <TriangleAlertIcon aria-hidden /> {t('reviews.changed')}
                      </Badge>
                    ) : undefined
                  }
                >
                  <Button size="sm" aria-label={t('reviews.openAria', { name: review.document.title })} onClick={() => onOpen(review)}>
                    {t('reviews.open')}
                  </Button>
                </ListRow>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
