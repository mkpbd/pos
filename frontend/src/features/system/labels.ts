import type { ComponentProps } from 'react'
import type { Badge } from '@/components/ui/badge'

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

/** Plain words per status-report warning code; the server's message stays as the detail. */
export const WARNING_TITLES: Record<string, string> = {
  APP_DEBUG_ON: 'Debug mode is on',
  MAIL_NOT_SENDING: 'E-mail is not being sent',
  BACKUPS_DISABLED: 'Automatic backups are off',
  BACKUP_FAILED: 'The last backup failed',
  BACKUP_STALE: 'No recent successful backup',
  BACKUP_UNVERIFIED: 'Backups are not verified',
  BACKUP_VERIFY_FAILED: 'The last backup check failed',
  DATABASE_DOWN: 'The database is not reachable',
  CACHE_DOWN: 'The cache is not reachable',
  SCHEDULER_STALE: 'The scheduler is not running',
  QUEUE_STALE: 'Background jobs are not being processed',
  QUEUE_SYNC_IN_PRODUCTION: 'Background jobs run inside requests',
  FAILED_JOBS: 'Some background jobs failed',
  DISK_LOW: 'The backup disk is almost full',
  OPEN_ERRORS: 'There are unresolved application errors',
}

/** What to do about it, shown under the title (only for codes where the fix is not obvious). */
export const WARNING_HINTS: Record<string, string> = {
  APP_DEBUG_ON: 'Set APP_DEBUG=false in production so error pages never show internal details.',
  MAIL_NOT_SENDING: 'Set MAIL_MAILER and MAIL_FROM_ADDRESS, then send a test e-mail.',
  BACKUPS_DISABLED: 'Set POS_BACKUP_ENABLED=true so the scheduler makes a backup every day.',
  SCHEDULER_STALE: 'Check the cron entry that runs “php artisan schedule:run” every minute.',
  QUEUE_STALE: 'Check that the “php artisan queue:work” process is running (supervisor).',
  QUEUE_SYNC_IN_PRODUCTION: 'Set QUEUE_CONNECTION to database or redis and run a queue worker.',
  DISK_LOW: 'Free up space or move old backups off the server.',
}

export function warningTitle(code: string): string | null {
  return WARNING_TITLES[code] ?? null
}

export type StatusLabel = { label: string; variant: BadgeVariant }

/** One badge vocabulary for every check: ok / fail / stale / unknown / sync / warn / disabled. */
export function statusLabel(status: string): StatusLabel {
  switch (status) {
    case 'ok':
      return { label: 'OK', variant: 'success' }
    case 'fail':
      return { label: 'Failing', variant: 'destructive' }
    case 'stale':
      return { label: 'Stale', variant: 'warning' }
    case 'warn':
      return { label: 'Needs attention', variant: 'warning' }
    case 'sync':
      return { label: 'Inline (sync)', variant: 'info' }
    case 'disabled':
      return { label: 'Off', variant: 'outline' }
    case 'unknown':
      return { label: 'Unknown', variant: 'secondary' }
    default:
      return { label: status, variant: 'secondary' }
  }
}

export function backupStatusLabel(status: string): StatusLabel {
  switch (status) {
    case 'running':
      return { label: 'Running', variant: 'info' }
    case 'succeeded':
      return { label: 'Succeeded', variant: 'success' }
    case 'failed':
      return { label: 'Failed', variant: 'destructive' }
    default:
      return { label: status, variant: 'secondary' }
  }
}

export function offsiteLabel(status: string | null): string {
  if (status === 'succeeded') return 'Copied'
  if (status === 'failed') return 'Failed'
  return 'Not set up'
}

export function verifyLabel(status: string | null, mode: string | null): StatusLabel {
  if (status === 'passed') return { label: mode === 'restore' ? 'Restore passed' : 'Passed', variant: 'success' }
  if (status === 'failed') return { label: 'Failed', variant: 'destructive' }
  return { label: 'Not verified', variant: 'outline' }
}

/** "login_activities" → "Login activities" */
export function tableLabel(table: string): string {
  const words = table.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function errorStatusLabel(status: string): StatusLabel {
  if (status === 'open') return { label: 'Open', variant: 'destructive' }
  if (status === 'resolved') return { label: 'Resolved', variant: 'success' }
  if (status === 'ignored') return { label: 'Ignored', variant: 'secondary' }
  return { label: status, variant: 'secondary' }
}

/** "App\Modules\Sales\Foo" → "Foo" (the full class is shown next to it). */
export function shortClass(name: string): string {
  return name.split('\\').pop() || name
}
