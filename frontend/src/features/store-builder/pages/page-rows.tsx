import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ExternalLinkIcon, PencilIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DocumentSummary } from '../api'
import { liveUrl } from './page-helpers'

/*
 * Rows of the pages list (B2, B4): a builder document's status chips, its Edit / View links and
 * any extra actions (create, back to the classic page, remove).
 */

export function StatusBadges({ summary }: { summary: DocumentSummary }) {
  if (!summary.published) return <Badge variant="soft">Not published</Badge>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="success">
        Published v{summary.published.number}
        {summary.published.published_at && ` · ${new Date(summary.published.published_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`}
      </Badge>
      {summary.has_unpublished_changes && <Badge variant="warning">Unpublished changes</Badge>}
    </span>
  )
}

export function EditLink({ summary, label = 'Edit', name }: { summary: DocumentSummary; label?: string; name: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={`/storefront/builder/${summary.id}`} aria-label={`${label} ${name}`}>
        <PencilIcon aria-hidden /> {label}
      </Link>
    </Button>
  )
}

export function ViewLink({ summary, name }: { summary: DocumentSummary; name: string }) {
  const view = summary.published ? liveUrl(summary) : null
  if (!view) return null
  return (
    <Button variant="ghost" size="sm" asChild>
      <a href={view} target="_blank" rel="noopener noreferrer" aria-label={`View ${name} on your store (opens in a new tab)`}>
        <ExternalLinkIcon aria-hidden /> View
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
