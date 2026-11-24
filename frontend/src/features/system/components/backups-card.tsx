import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DatabaseBackupIcon, Loader2Icon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { systemKeys, useBackupsQuery, useRunBackupMutation, useVerifyBackupMutation, type Backup, type BackupsCheck } from '@/features/system/api'
import { formatBytes, formatDateTime, formatRelative } from '@/features/system/format'
import { backupStatusLabel, offsiteLabel, statusLabel, verifyLabel } from '@/features/system/labels'
import { settledRow, WATCH_TIMEOUT_MS, type BackupWatch } from '@/features/system/backup-watch'
import { ApiError, type Paginated } from '@/lib/api/client'

function announce(watch: BackupWatch, row: Backup) {
  if (watch.kind === 'backup') {
    if (row.status === 'succeeded') toast.success(`Backup finished: ${row.file_name ?? 'file saved'} (${formatBytes(row.size_bytes)}).`)
    else toast.error(`Backup failed${row.error ? `: ${row.error}` : '.'}`)
    return
  }
  if (row.verify_status === 'passed') toast.success(row.verify_mode === 'restore' ? 'Backup verified: a test restore worked.' : 'Backup verified: the file is complete and readable.')
  else toast.error(`Verification failed${row.verify_error ? `: ${row.verify_error}` : '.'}`)
}

function scheduleText(check: BackupsCheck): string {
  const when = check.schedule_time ? `every day at ${check.schedule_time}` : 'every day'
  const keep = check.keep_days ? `, kept for ${check.keep_days} days` : ''
  return `Automatic backups run ${when}${keep}, then a check reads the newest file.`
}

type Confirm = { kind: 'backup' } | { kind: 'verify'; backup: Backup } | null

export function BackupsCard({ check, now }: { check: BackupsCheck; now: number }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [watch, setWatch] = useState<BackupWatch | null>(null)
  const [finished, setFinished] = useState<{ watch: BackupWatch; row: Backup } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const backups = useBackupsQuery(page, watch !== null)
  const runBackup = useRunBackupMutation()
  const verify = useVerifyBackupMutation()

  const items = backups.data?.items ?? []
  const running = items.some((b) => b.status === 'running')

  // The watched run finished: stop waiting (render-phase update, no effect needed) and announce it below.
  const settled = watch && backups.data && !backups.isPlaceholderData ? settledRow(watch, items) : null
  if (watch && settled) {
    setWatch(null)
    setFinished({ watch, row: settled })
  }

  useEffect(() => {
    if (!finished) return
    announce(finished.watch, finished.row)
  }, [finished])

  // Polling stops when nothing is running any more: refresh the status report (last backup, warnings) once.
  const busy = watch !== null || running
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) void queryClient.invalidateQueries({ queryKey: systemKeys.status })
    wasBusy.current = busy
  }, [busy, queryClient])

  useEffect(() => {
    if (!watch) return
    const timer = setTimeout(() => {
      setWatch(null)
      toast.info('Still working in the background. Refresh the list later to see the result.')
    }, WATCH_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [watch])

  const startBackup = () => {
    // The newest row before this run: the run is over once a different, finished row leads page 1.
    const firstPage = page === 1 ? backups.data : queryClient.getQueryData<Paginated<Backup>>([...systemKeys.backups, 1])
    const previousNewestId = firstPage?.items[0]?.id ?? null
    runBackup.mutate(undefined, {
      onSuccess: (queued) => {
        toast.success('Backup started. This list updates when it finishes.')
        setPage(1)
        setWatch({ kind: 'backup', previousNewestId, backupId: typeof queued?.id === 'string' ? queued.id : null })
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'BACKUP_RUNNING') toast.info(error.message || 'A backup is already running.')
        else toast.error(error.message)
      },
      onSettled: () => setConfirm(null),
    })
  }

  const startVerify = (backup: Backup) => {
    verify.mutate(backup.id, {
      onSuccess: () => {
        toast.success('Verification started. This list updates when it finishes.')
        setWatch({ kind: 'verify', backupId: backup.id, previousVerifiedAt: backup.verified_at })
      },
      onError: (error) => toast.error(error.message),
      onSettled: () => setConfirm(null),
    })
  }

  const overall = statusLabel(check.status)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h2>Backups</h2>
          <Badge variant={overall.variant}>{check.enabled ? overall.label : 'Automatic backups off'}</Badge>
        </CardTitle>
        <CardDescription>
          {check.enabled ? scheduleText(check) : 'Only backups started here are made.'}{' '}
          Last success: {check.last_success_at ? <time dateTime={check.last_success_at} title={formatDateTime(check.last_success_at)}>{formatRelative(check.last_success_at, now)}</time> : 'never'}.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setConfirm({ kind: 'backup' })} disabled={busy || runBackup.isPending}>
            {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden /> : <DatabaseBackupIcon data-icon="inline-start" aria-hidden />}
            Back up now
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!check.enabled && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            Set <code className="font-mono">POS_BACKUP_ENABLED=true</code> in the server’s environment (and keep the scheduler running) to make a database
            backup every day. Optional: <code className="font-mono">POS_BACKUP_AFTER_COMMAND</code> copies each file off the server.
          </p>
        )}
        <p className="text-sm text-muted-foreground">Backup files stay on the server and cannot be downloaded here; copy them off the server with your own tools.</p>
        <p role="status" aria-live="polite" className="sr-only">
          {busy ? 'A backup job is running. The list refreshes every few seconds.' : ''}
        </p>

        {backups.isPending ? (
          <LoadingState rows={3} label="Loading backups" />
        ) : backups.error ? (
          <ErrorState error={backups.error} onRetry={() => backups.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No backups yet" description="Back up now to make the first one." />
        ) : (
          <>
            <div className="rounded-md border">
              <Table aria-label="Recent backups">
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Size</TableHead>
                    <TableHead className="hidden md:table-cell">Checksum</TableHead>
                    <TableHead className="hidden md:table-cell">Off-site</TableHead>
                    <TableHead className="hidden sm:table-cell">Verified</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b) => {
                    const status = backupStatusLabel(b.status)
                    const verified = verifyLabel(b.verify_status, b.verify_mode)
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="whitespace-nowrap">
                          <time dateTime={b.started_at} title={formatDateTime(b.started_at)}>
                            {formatRelative(b.started_at, now)}
                          </time>
                          <span className="block text-xs text-muted-foreground">{b.triggered_by === 'user' ? 'started by hand' : 'scheduled'}</span>
                          {b.status === 'succeeded' && <span className="block text-xs text-muted-foreground sm:hidden">{formatBytes(b.size_bytes)}</span>}
                          {b.file_deleted_at && <span className="block text-xs text-muted-foreground">file removed (older than the keep period)</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {b.status === 'succeeded' && (
                            <Badge variant={verified.variant} className="mt-1 flex w-fit sm:hidden">
                              {verified.label}
                            </Badge>
                          )}
                          {b.error && <span className="mt-1 block max-w-64 min-w-32 text-xs break-words whitespace-normal text-destructive">{b.error}</span>}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap tabular-nums sm:table-cell">{b.status === 'succeeded' ? formatBytes(b.size_bytes) : '—'}</TableCell>
                        <TableCell className="hidden font-mono text-xs md:table-cell" title={b.sha256 ?? undefined}>
                          {b.sha256 ? b.sha256.slice(0, 12) : '—'}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap md:table-cell" title={b.offsite_error ?? undefined}>
                          {offsiteLabel(b.offsite_status)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant={verified.variant}>{verified.label}</Badge>
                          {b.verified_at && (
                            <span className="block text-xs text-muted-foreground">
                              <time dateTime={b.verified_at} title={formatDateTime(b.verified_at)}>{formatRelative(b.verified_at, now)}</time>
                            </span>
                          )}
                          {b.verify_error && <span className="mt-1 block max-w-64 min-w-32 text-xs break-words whitespace-normal text-destructive">{b.verify_error}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {b.status === 'succeeded' && !b.file_deleted_at && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirm({ kind: 'verify', backup: b })}
                              disabled={busy || verify.isPending}
                              aria-label={`Verify backup ${b.file_name ?? formatDateTime(b.started_at)}`}
                            >
                              <ShieldCheckIcon data-icon="inline-start" aria-hidden />
                              <span className="hidden sm:inline">Verify</span>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {backups.data && <PaginationBar pagination={backups.data.pagination} onPageChange={setPage} />}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirm?.kind === 'backup'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Back up the database now?"
        description="A full copy of the database is written to the backup folder in the background. The POS keeps working while it runs."
        confirmLabel="Back up now"
        destructive={false}
        pending={runBackup.isPending}
        onConfirm={startBackup}
      />
      <ConfirmDialog
        open={confirm?.kind === 'verify'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Verify this backup?"
        description={
          confirm?.kind === 'verify'
            ? `Checks that ${confirm.backup.file_name ?? 'the file'} is complete and readable (and test-restores it into the scratch database when one is configured). The live database is not touched.`
            : ''
        }
        confirmLabel="Verify"
        destructive={false}
        pending={verify.isPending}
        onConfirm={() => confirm?.kind === 'verify' && startVerify(confirm.backup)}
      />
    </Card>
  )
}
