/** Test data for the G1b operations screens (vitest only). */
import type { Backup, ErrorEventDetail, FailedJob, SystemStatusReport } from '@/features/system/api'
import type { CurrentUser } from '@/features/auth/types'
import { makeCurrentUser } from '@/test/fixtures'

export const platformAdmin = (): CurrentUser =>
  makeCurrentUser({
    user: { id: 'u-9', name: 'Platform Owner', email: 'owner@pos.test', phone: null, is_platform_admin: true, last_login_at: null },
    organization: null,
    roles: [],
    permissions: [],
    branches: [],
  })

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export function makeStatus(overrides: Partial<SystemStatusReport['checks']> = {}, extra: Partial<SystemStatusReport> = {}): SystemStatusReport {
  return {
    checks: {
      database: 'ok',
      cache: 'ok',
      scheduler: { status: 'ok', last_heartbeat_at: minutesAgo(2) },
      queue: { status: 'ok', driver: 'database', last_heartbeat_at: minutesAgo(1), pending_jobs: 3, failed_jobs: 2 },
      mail: { status: 'ok', mailer: 'smtp', from_address: 'shop@pos.test' },
      backups: {
        status: 'ok',
        enabled: true,
        last_success_at: minutesAgo(120),
        last_file: 'pos-pos-20261124-020000.dump',
        last_size_bytes: 52_428_800,
        last_verified_at: minutesAgo(30),
        verify_status: 'passed',
        last_failure_at: null,
        schedule_time: '02:00',
        keep_days: 14,
      },
      storage: { status: 'ok', path: '/var/backups/pos', free_bytes: 400 * 1024 ** 3, total_bytes: 500 * 1024 ** 3 },
      errors: { open: 4, new_last_24h: 1 },
      ...overrides,
    },
    app: { environment: 'production', debug: false, php_version: '8.4.16', laravel_version: '13.2.0', timezone: 'Asia/Dhaka' },
    warnings: [],
    retention: { last_run_at: minutesAgo(300), deleted: { login_activities: 120, failed_jobs: 3 } },
    ...extra,
  }
}

export function makeBackup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: 'bk-1',
    started_at: minutesAgo(120),
    finished_at: minutesAgo(119),
    status: 'succeeded',
    file_name: 'pos-pos-20261124-020000.dump',
    size_bytes: 52_428_800,
    sha256: 'a3f1c2d4e5b6978877665544332211ffeeddccbbaa99887766554433221100aa',
    error: null,
    offsite_status: 'skipped',
    offsite_error: null,
    verified_at: null,
    verify_status: null,
    verify_error: null,
    verify_mode: null,
    triggered_by: 'schedule',
    user_id: null,
    ...overrides,
  }
}

export function makeFailedJob(overrides: Partial<FailedJob> = {}): FailedJob {
  return {
    id: 1,
    uuid: 'fj-uuid-1',
    job: 'App\\Modules\\Media\\Infrastructure\\Jobs\\GenerateRenditions',
    queue: 'default',
    connection: 'database',
    failed_at: minutesAgo(10),
    exception: 'RuntimeException: GD could not read the image.',
    ...overrides,
  }
}

export function makeErrorEvent(overrides: Partial<ErrorEventDetail> = {}): ErrorEventDetail {
  return {
    id: 'er-1',
    exception_class: 'Illuminate\\Database\\QueryException',
    message: 'SQLSTATE[23505]: insert into "sales" ("number") values (?)',
    file: 'app/Modules/Sales/Application/Actions/CompleteSale.php',
    line: 120,
    occurrences: 7,
    first_seen_at: minutesAgo(600),
    last_seen_at: minutesAgo(5),
    last_method: 'POST',
    last_path: '/api/v1/pos/checkout',
    last_request_id: 'req-abc-123',
    status: 'open',
    resolved_at: null,
    trace: '#0 app/Modules/Sales/Application/Actions/CompleteSale.php(120): save()\n#1 app/Modules/Sales/Presentation/Http/Controllers/CheckoutController.php(40): handle()',
    ...overrides,
  }
}
