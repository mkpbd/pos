import { useState } from 'react'
import { RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  useDeleteFailedJobMutation,
  useFailedJobsQuery,
  useRetryAllFailedJobsMutation,
  useRetryFailedJobMutation,
  type FailedJob,
} from '@/features/system/api'
import { formatDateTime, formatRelative } from '@/features/system/format'
import { shortClass } from '@/features/system/labels'

type Confirm = { kind: 'delete'; job: FailedJob } | { kind: 'retry-all' } | null

/** Background jobs that gave up: retry one, retry all, or delete (the payload itself is never shown). */
export function FailedJobsCard({ now }: { now: number }) {
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const jobs = useFailedJobsQuery(page)
  const retry = useRetryFailedJobMutation()
  const remove = useDeleteFailedJobMutation()
  const retryAll = useRetryAllFailedJobsMutation()

  const total = jobs.data?.pagination.total ?? 0

  const retryOne = (job: FailedJob) =>
    retry.mutate(job.uuid, {
      onSuccess: () => toast.success(`${job.job} is queued again.`),
      onError: (error) => toast.error(error.message),
    })

  const deleteOne = (job: FailedJob) =>
    remove.mutate(job.uuid, {
      onSuccess: () => toast.success(`${job.job} deleted.`),
      onError: (error) => toast.error(error.message),
      onSettled: () => setConfirm(null),
    })

  const retryEverything = () =>
    retryAll.mutate(undefined, {
      onSuccess: () => {
        toast.success('All failed jobs are queued again.')
        setPage(1)
      },
      onError: (error) => toast.error(error.message),
      onSettled: () => setConfirm(null),
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h2>Failed jobs</h2>
          {total > 0 && <Badge variant="destructive">{total}</Badge>}
        </CardTitle>
        <CardDescription>Background work (e-mails, exports, image processing) that failed after its retries.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={total === 0 || retryAll.isPending} onClick={() => setConfirm({ kind: 'retry-all' })}>
            <RefreshCwIcon data-icon="inline-start" aria-hidden />
            Retry all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {jobs.isPending ? (
          <LoadingState rows={2} label="Loading failed jobs" />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : jobs.data.items.length === 0 ? (
          <EmptyState title="No failed jobs" description="Every background job finished." />
        ) : (
          <>
            <div className="rounded-md border">
              <Table aria-label="Failed jobs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead className="hidden sm:table-cell">Queue</TableHead>
                    <TableHead className="hidden sm:table-cell">Failed</TableHead>
                    <TableHead className="hidden md:table-cell">Error</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.data.items.map((job) => (
                    <TableRow key={job.uuid}>
                      <TableCell className="min-w-40 whitespace-normal">
                        <span className="block font-medium break-all" title={job.job}>
                          {shortClass(job.job)}
                        </span>
                        {job.job.includes('\\') &&<span className="block font-mono text-xs break-all text-muted-foreground">{job.job}</span>}
                        {/* Phones: the other columns are folded into this cell. */}
                        <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
                          {job.queue} · {formatRelative(job.failed_at, now)}
                        </span>
                        <span className="mt-1 block text-xs break-words md:hidden">{job.exception}</span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">
                        {job.queue}
                        <span className="block text-xs text-muted-foreground">{job.connection}</span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">
                        <time dateTime={job.failed_at ?? undefined} title={formatDateTime(job.failed_at)}>
                          {formatRelative(job.failed_at, now)}
                        </time>
                      </TableCell>
                      <TableCell className="hidden max-w-96 min-w-48 text-xs break-words whitespace-normal md:table-cell">{job.exception}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retryOne(job)} aria-label={`Retry ${job.job}`}>
                            <RefreshCwIcon data-icon="inline-start" aria-hidden />
                            Retry
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setConfirm({ kind: 'delete', job })} aria-label={`Delete ${job.job}`}>
                            <Trash2Icon aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={jobs.data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this failed job?"
        description={confirm?.kind === 'delete' ? `${confirm.job.job} will not run again. This cannot be undone.` : ''}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => confirm?.kind === 'delete' && deleteOne(confirm.job)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'retry-all'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Retry every failed job?"
        description={`All ${total} failed ${total === 1 ? 'job goes' : 'jobs go'} back on the queue. Fix the cause first, or they will fail again.`}
        confirmLabel="Retry all"
        destructive={false}
        pending={retryAll.isPending}
        onConfirm={retryEverything}
      />
    </Card>
  )
}
