import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, CheckCheckIcon, EyeOffIcon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useErrorEventQuery, useSetErrorStatusMutation, type ErrorStatus } from '@/features/system/api'
import { formatCount, formatDateTime, formatRelative, useNow } from '@/features/system/format'
import { errorStatusLabel, shortClass } from '@/features/system/labels'
import { ApiError } from '@/lib/api/client'

const ACTIONS: Record<ErrorStatus, { to: ErrorStatus; label: string; done: string; icon: ReactNode; primary?: boolean }[]> = {
  open: [
    { to: 'resolved', label: 'Resolve', done: 'Marked as resolved. It opens again if it happens again.', icon: <CheckCheckIcon data-icon="inline-start" aria-hidden />, primary: true },
    { to: 'ignored', label: 'Ignore', done: 'Ignored. It is still counted but never alerts.', icon: <EyeOffIcon data-icon="inline-start" aria-hidden /> },
  ],
  resolved: [
    { to: 'open', label: 'Reopen', done: 'Reopened.', icon: <Undo2Icon data-icon="inline-start" aria-hidden /> },
    { to: 'ignored', label: 'Ignore', done: 'Ignored. It is still counted but never alerts.', icon: <EyeOffIcon data-icon="inline-start" aria-hidden /> },
  ],
  ignored: [
    { to: 'open', label: 'Reopen', done: 'Reopened.', icon: <Undo2Icon data-icon="inline-start" aria-hidden /> },
    { to: 'resolved', label: 'Resolve', done: 'Marked as resolved.', icon: <CheckCheckIcon data-icon="inline-start" aria-hidden /> },
  ],
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Moment({ iso, now }: { iso: string | null; now: number }) {
  if (!iso) return <>—</>
  return (
    <>
      <time dateTime={iso}>{formatDateTime(iso)}</time>
      <span className="text-muted-foreground"> ({formatRelative(iso, now)})</span>
    </>
  )
}

/** /system-status/errors/:errorId — one error fingerprint with its trace (platform admins). */
export function SystemErrorPage() {
  const { errorId = '' } = useParams()
  const now = useNow()
  const event = useErrorEventQuery(errorId)
  const setStatus = useSetErrorStatusMutation(errorId)

  const back = (
    <Button asChild variant="ghost" size="sm" className="self-start">
      <Link to="/system-status/errors">
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        Application errors
      </Link>
    </Button>
  )

  if (event.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {back}
        <LoadingState rows={5} label="Loading error" />
      </div>
    )
  }

  if (event.error) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {back}
        {event.error instanceof ApiError && event.error.status === 404 ? (
          <EmptyState title="Error not found" description="It may have been cleaned up by data retention." />
        ) : (
          <ErrorState error={event.error} onRetry={() => event.refetch()} />
        )}
      </div>
    )
  }

  const e = event.data
  const status = errorStatusLabel(e.status)
  const change = (action: (typeof ACTIONS)[ErrorStatus][number]) =>
    setStatus.mutate(action.to, {
      onSuccess: () => toast.success(action.done),
      onError: (error) => toast.error(error.message),
    })

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight break-all">{shortClass(e.exception_class)}</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="font-mono text-xs break-all text-muted-foreground">{e.exception_class}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIONS[e.status].map((action) => (
            <Button key={action.to} variant={action.primary ? 'default' : 'outline'} size="sm" disabled={setStatus.isPending} onClick={() => change(action)}>
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <section aria-labelledby="error-message-heading" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <h2 id="error-message-heading" className="sr-only">
          Message
        </h2>
        <p className="text-sm break-words whitespace-pre-wrap">{e.message}</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Details</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Fact label="Where">
              <span className="font-mono text-xs break-all">{e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : '—'}</span>
            </Fact>
            <Fact label="Occurrences">{formatCount(e.occurrences)}</Fact>
            <Fact label="First seen">
              <Moment iso={e.first_seen_at} now={now} />
            </Fact>
            <Fact label="Last seen">
              <Moment iso={e.last_seen_at} now={now} />
            </Fact>
            <Fact label="Last request">
              <span className="font-mono text-xs break-all">{e.last_path ? `${e.last_method ?? ''} ${e.last_path}`.trim() : '— (not from a web request)'}</span>
            </Fact>
            <Fact label="Request id">
              <span className="font-mono text-xs break-all">{e.last_request_id ?? '—'}</span>
            </Fact>
            {e.resolved_at && (
              <Fact label="Resolved">
                <Moment iso={e.resolved_at} now={now} />
              </Fact>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="error-trace-heading">Stack trace</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {e.trace ? (
            // Focusable so keyboard users can scroll it.
            <pre
              tabIndex={0}
              aria-labelledby="error-trace-heading"
              className="max-h-[28rem] overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {e.trace}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No trace was recorded.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
