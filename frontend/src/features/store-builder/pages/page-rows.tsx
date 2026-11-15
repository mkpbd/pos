import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CalendarClockIcon, CalendarX2Icon, ClockIcon, ExternalLinkIcon, MessageSquareWarningIcon, PencilIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCurrentUserQuery } from '@/features/auth/api'
import type { DocumentSummary } from '../api'
import { failureText } from '../publishing-api'
import { formatStoreDateTime } from './messages'
import { liveUrl } from './page-helpers'
import { useScreenText } from './screen-language'

/*
 * Rows of the pages list (B2, B4): a builder document's status chips, its Edit / View links and
 * any extra actions (create, back to the classic page, remove). B7: in the screen's language.
 */

export function StatusBadges({ summary }: { summary: DocumentSummary }) {
  const { t, date } = useScreenText()
  const live = !summary.published ? (
    <Badge variant="soft">{t('row.notPublished')}</Badge>
  ) : (
    <>
      <Badge variant="success">
        {t('row.published', { n: summary.published.number })}
        {summary.published.published_at && ` · ${date(summary.published.published_at)}`}
      </Badge>
      {summary.has_unpublished_changes && <Badge variant="warning">{t('row.unpublished')}</Badge>}
    </>
  )
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {live}
      <PublishingBadges summary={summary} />
    </span>
  )
}

/** B11: a planned publish (or one that failed) and the approval state. */
export function PublishingBadges({ summary }: { summary: Pick<DocumentSummary, 'schedule' | 'review'> }) {
  const { t, lang } = useScreenText()
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  const schedule = summary.schedule
  const review = summary.review
  return (
    <>
      {schedule?.status === 'pending' && (
        <Badge variant="info" data-testid="row-scheduled" title={t('row.scheduledHint', { date: formatStoreDateTime(lang, schedule.publish_at, timeZone) })}>
          <CalendarClockIcon aria-hidden /> {t('row.scheduled', { date: formatStoreDateTime(lang, schedule.publish_at, timeZone) })}
        </Badge>
      )}
      {schedule?.status === 'failed' && (
        <Badge variant="destructive" data-testid="row-schedule-failed" title={failureText(schedule) ?? undefined}>
          <CalendarX2Icon aria-hidden /> {t('row.scheduleFailed')}
        </Badge>
      )}
      {review?.status === 'pending' && (
        <Badge variant="warning" data-testid="row-review-pending">
          <ClockIcon aria-hidden /> {t('row.reviewPending')}
        </Badge>
      )}
      {review?.status === 'sent_back' && (
        <Badge variant="destructive" data-testid="row-review-sent-back" title={review.comment ?? undefined}>
          <MessageSquareWarningIcon aria-hidden /> {t('row.reviewSentBack')}
        </Badge>
      )}
    </>
  )
}

export function EditLink({ summary, label, name }: { summary: DocumentSummary; label?: string; name: string }) {
  const { t } = useScreenText()
  const text = label ?? t('common.edit')
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={`/storefront/builder/${summary.id}`} aria-label={t('row.editAria', { label: text, name })}>
        <PencilIcon aria-hidden /> {text}
      </Link>
    </Button>
  )
}

export function ViewLink({ summary, name }: { summary: DocumentSummary; name: string }) {
  const { t } = useScreenText()
  const view = summary.published ? liveUrl(summary) : null
  if (!view) return null
  return (
    <Button variant="ghost" size="sm" asChild>
      <a href={view} target="_blank" rel="noopener noreferrer" aria-label={t('row.viewAria', { name })}>
        <ExternalLinkIcon aria-hidden /> {t('common.view')}
      </a>
    </Button>
  )
}

/** One row: name, a line under it, the status (when there is a document) and actions. */
export function ListRow({ testId, title, detail, status, children }: { testId: string; title: ReactNode; detail: ReactNode; status?: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {status}
      {children && <div className="flex flex-wrap items-center gap-1">{children}</div>}
    </li>
  )
}
