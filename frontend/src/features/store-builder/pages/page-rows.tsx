import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ExternalLinkIcon, PencilIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DocumentSummary } from '../api'
import { liveUrl } from './page-helpers'
import { useScreenText } from './screen-language'

/*
 * Rows of the pages list (B2, B4): a builder document's status chips, its Edit / View links and
 * any extra actions (create, back to the classic page, remove). B7: in the screen's language.
 */

export function StatusBadges({ summary }: { summary: DocumentSummary }) {
  const { t, date } = useScreenText()
  if (!summary.published) return <Badge variant="soft">{t('row.notPublished')}</Badge>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="success">
        {t('row.published', { n: summary.published.number })}
        {summary.published.published_at && ` · ${date(summary.published.published_at)}`}
      </Badge>
      {summary.has_unpublished_changes && <Badge variant="warning">{t('row.unpublished')}</Badge>}
    </span>
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
