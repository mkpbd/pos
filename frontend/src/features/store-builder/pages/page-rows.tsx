import { useContext, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CalendarClockIcon, CalendarX2Icon, ClockIcon, ExternalLinkIcon, MessageSquareWarningIcon, PencilIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrentUserQuery } from '@/features/auth/api'
import type { DocumentSummary } from '../api'
import { PageStatsContext, type PageSort } from './page-stats'
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
export function ListRow({ testId, title, detail, status, stats, children }: { testId: string; title: ReactNode; detail: ReactNode; status?: ReactNode; stats?: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {stats}
      {status}
      {children && <div className="flex flex-wrap items-center gap-1">{children}</div>}
    </li>
  )
}

/* ---------------------------------------------------------------- B15 views and orders ------ */

/** "Views (30 days)" and "Orders" figures of a builder page row (nothing when the stats aren't there). */
export function PageStats({ id, name }: { id: string | undefined; name: string }) {
  const stats = useContext(PageStatsContext)
  const { t, num } = useScreenText()
  if (!stats) return null
  const row = id ? stats[id] : undefined
  const views = row?.views ?? 0
  const orders = row?.orders ?? 0
  return (
    <dl className="flex shrink-0 gap-4 text-right" aria-label={t('stats.aria', { name, views, orders })} data-testid={id ? `page-stats-${id}` : undefined}>
      <div className="w-24">
        <dt className="text-xs text-muted-foreground">{t('stats.views')}</dt>
        <dd className="font-medium tabular-nums">{id ? num(views) : '—'}</dd>
      </div>
      <div className="w-14">
        <dt className="text-xs text-muted-foreground">{t('stats.orders')}</dt>
        <dd className="font-medium tabular-nums">{id ? num(orders) : '—'}</dd>
      </div>
    </dl>
  )
}

/** "Sort by: Name | Views (30 days) | Orders" — only while the figures are there. */
export function SortSelect({ id, value, onChange }: { id: string; value: PageSort; onChange: (sort: PageSort) => void }) {
  const stats = useContext(PageStatsContext)
  const { t } = useScreenText()
  if (!stats) return null
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{t('sort.label')}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PageSort)}>
        <SelectTrigger id={id} size="sm" className="w-40" data-testid={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="name">{t('sort.name')}</SelectItem>
          <SelectItem value="views">{t('stats.views')}</SelectItem>
          <SelectItem value="orders">{t('stats.orders')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
