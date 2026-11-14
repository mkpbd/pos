import { useEffect, useRef } from 'react'
import { CircleAlertIcon, InfoIcon, LightbulbIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { countsText, groupBySeverity, type PageCheckIssue, type PageCheckSeverity } from './page-check'
import type { PageCheck, ServerCheckState } from './use-page-check'

/*
 * B10 Check page panel (contract §2): the issues by severity with a Fix it action, the server
 * checks' state, and the summary the publish dialog shows too. Errors never block publishing.
 */

const SEVERITY_ICON: Record<PageCheckSeverity, typeof CircleAlertIcon> = { error: CircleAlertIcon, warning: TriangleAlertIcon, tip: LightbulbIcon }
const SEVERITY_TONE: Record<PageCheckSeverity, string> = {
  error: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  tip: 'text-muted-foreground',
}

export function ServerCheckNote({ server, onRetry }: { server: ServerCheckState; onRetry: () => void }) {
  if (server.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Checking links, products and global sections…
      </p>
    )
  }
  if (server.status === 'failed') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
        <TriangleAlertIcon className="size-3.5" aria-hidden /> Couldn’t run the server checks — try again.
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon aria-hidden /> Try again
        </Button>
      </div>
    )
  }
  return null
}

export function IssueRow({ issue, label, onShow, onFix }: { issue: PageCheckIssue; label: string | null; onShow: (issue: PageCheckIssue) => void; onFix: (issue: PageCheckIssue) => void }) {
  const Icon = SEVERITY_ICON[issue.severity]
  return (
    <li className="flex gap-2 py-2.5" data-testid={`check-issue-${issue.code}`}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', SEVERITY_TONE[issue.severity])} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">{issue.message}</p>
        {label && (
          <button type="button" className="w-fit max-w-full truncate text-left text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:underline" onClick={() => onShow(issue)}>
            {label}
          </button>
        )}
        {issue.fix && (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onFix(issue)} aria-label={`${issue.fix.label}: ${issue.message}`}>
            {issue.fix.label}
          </Button>
        )}
      </div>
    </li>
  )
}

/** The Check page panel (in place of the left panel while it is open). */
export function CheckPanel({ check, labelOf, onShow, onFix, onClose }: {
  check: PageCheck
  /** A node's name ("Heading: Fresh today"); null when it isn't on the page. */
  labelOf: (nodeId: string) => string | null
  onShow: (issue: PageCheckIssue) => void
  onFix: (issue: PageCheckIssue) => void
  onClose: () => void
}) {
  const groups = groupBySeverity(check.issues)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])
  return (
    <section aria-labelledby="page-check-title" className="flex min-h-0 flex-1 flex-col" data-testid="check-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 id="page-check-title" ref={headingRef} tabIndex={-1} className="flex-1 text-sm font-semibold outline-none">
          Check page
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Check again" title="Check again" disabled={check.server.status === 'running'} onClick={() => void check.runServer()}>
          <RefreshCwIcon />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close the page check" title="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="check-summary">
          {countsText(check.counts)}
        </p>
        <ServerCheckNote server={check.server} onRetry={() => void check.runServer()} />
        {groups.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> Nothing to fix. Shoppers will see a tidy, readable page.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.severity} className="flex flex-col">
              <h3 className={cn('text-xs font-semibold tracking-wide uppercase', SEVERITY_TONE[group.severity])}>
                {group.label} ({group.issues.length})
              </h3>
              <ul className="divide-y" aria-label={group.label}>
                {group.issues.map((issue) => (
                  <IssueRow key={issue.key} issue={issue} label={issue.node_id ? labelOf(issue.node_id) : 'Page settings'} onShow={onShow} onFix={onFix} />
                ))}
              </ul>
            </div>
          ))
        )}
        <p className="mt-auto pt-2 text-xs text-muted-foreground">Errors don’t stop you publishing — you decide. Fix them first so every shopper can use the page.</p>
      </div>
    </section>
  )
}
