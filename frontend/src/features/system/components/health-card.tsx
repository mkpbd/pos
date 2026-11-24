import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { MailIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SystemStatusReport } from '@/features/system/api'
import { MailTestDialog } from '@/features/system/components/mail-test-dialog'
import { formatBytes, formatCount, formatDateTime, formatRelative, toNumber } from '@/features/system/format'
import { statusLabel, tableLabel } from '@/features/system/labels'

function StatusBadge({ status }: { status: string }) {
  const { label, variant } = statusLabel(status)
  return <Badge variant={variant}>{label}</Badge>
}

function Moment({ iso, now, fallback = 'never' }: { iso: string | null | undefined; now: number; fallback?: string }) {
  if (!iso) return <>{fallback}</>
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {formatRelative(iso, now)}
    </time>
  )
}

/** One check: name and badge on the first line, the details below (wraps on a phone). */
function CheckRow({ name, status, children }: { name: string; status: string; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{name}</h3>
        <StatusBadge status={status} />
      </div>
      {children && <div className="text-muted-foreground">{children}</div>}
    </li>
  )
}

function StorageBar({ free, total }: { free: number | null; total: number | null }) {
  if (free === null || total === null || total <= 0) return <p>Free space unknown.</p>
  const usedPercent = Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100)))
  const freePercent = 100 - usedPercent
  const text = `${formatBytes(free)} free of ${formatBytes(total)} (${freePercent} % free)`
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="meter"
        aria-label="Backup disk used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usedPercent}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={freePercent < 10 ? 'h-full bg-destructive' : 'h-full bg-primary'} style={{ width: `${usedPercent}%` }} />
      </div>
      <p>{text}</p>
    </div>
  )
}

/** Health of the install for platform admins: dependencies, heartbeats, mail, disk, errors and retention. */
export function HealthCard({ report, now, adminEmail }: { report: SystemStatusReport; now: number; adminEmail: string }) {
  const [mailOpen, setMailOpen] = useState(false)
  const { checks, app } = report
  const retention = report.retention ?? checks.retention ?? null
  const deleted = retention ? Object.entries(retention.deleted ?? {}) : []
  const openErrors = toNumber(checks.errors.open) ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Health</h2>
        </CardTitle>
        <CardDescription>
          {app.environment} · PHP {app.php_version} · Laravel {app.laravel_version} · {app.timezone}
          {app.debug && ' · debug on'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-label="Health checks" className="divide-y rounded-md border">
          <CheckRow name="Database" status={checks.database} />
          <CheckRow name="Cache" status={checks.cache} />
          <CheckRow name="Scheduler" status={checks.scheduler.status}>
            Last heartbeat <Moment iso={checks.scheduler.last_heartbeat_at} now={now} />
          </CheckRow>
          <CheckRow name="Queue" status={checks.queue.status}>
            <p>
              Driver <span className="font-mono">{checks.queue.driver}</span> · {formatCount(checks.queue.pending_jobs)} pending ·{' '}
              {formatCount(checks.queue.failed_jobs)} failed
            </p>
            {checks.queue.status !== 'sync' && (
              <p>
                Last heartbeat <Moment iso={checks.queue.last_heartbeat_at} now={now} />
              </p>
            )}
          </CheckRow>
          <CheckRow name="Mail" status={checks.mail.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words">
                Mailer <span className="font-mono">{checks.mail.mailer}</span> · from {checks.mail.from_address || 'no address set'}
              </p>
              <Button variant="outline" size="sm" onClick={() => setMailOpen(true)}>
                <MailIcon data-icon="inline-start" aria-hidden />
                Send test e-mail
              </Button>
            </div>
          </CheckRow>
          <CheckRow name="Backup disk" status={checks.storage.status}>
            <p className="mb-1.5 font-mono text-xs break-all">{checks.storage.path}</p>
            <StorageBar free={toNumber(checks.storage.free_bytes)} total={toNumber(checks.storage.total_bytes)} />
          </CheckRow>
          <CheckRow name="Errors" status={openErrors > 0 ? 'warn' : 'ok'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                {formatCount(checks.errors.open)} open · {formatCount(checks.errors.new_last_24h)} new in the last 24 hours
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/system-status/errors">View errors</Link>
              </Button>
            </div>
          </CheckRow>
          <li className="flex flex-col gap-1.5 px-4 py-3 text-sm">
            <h3 className="font-medium">Data clean-up</h3>
            <div className="text-muted-foreground">
              {retention?.last_run_at ? (
                <>
                  <p>
                    Last run <Moment iso={retention.last_run_at} now={now} />
                  </p>
                  {deleted.length > 0 && (
                    <ul aria-label="Rows removed in the last run" className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                      {deleted.map(([table, count]) => (
                        <li key={table} className="flex justify-between gap-2">
                          <span>{tableLabel(table)}</span>
                          <span className="tabular-nums">{formatCount(count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p>Has not run yet (pos:prune-records runs daily with the scheduler).</p>
              )}
            </div>
          </li>
        </ul>
      </CardContent>
      <MailTestDialog open={mailOpen} onOpenChange={setMailOpen} defaultTo={adminEmail} />
    </Card>
  )
}
