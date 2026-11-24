import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * G1b operations against a mocked API: the platform admin's System status page (warnings, health,
 * backups with "Back up now" polling, failed jobs), the error log list → detail → resolve, and a
 * normal user who still sees the simple health page. Runs on desktop and mobile (375 px wide).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 15, total: items.length, last_page: 1 } })

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const platformAdmin = {
  user: { id: 'u-9', name: 'Platform Owner', email: 'owner@pos.test', phone: null, is_platform_admin: true, last_login_at: null },
  organization: null, roles: [], permissions: [], branches: [],
  two_factor: { enabled: true, required: false, setup_required: false },
}
const shopAdmin = {
  user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: ['branches.view', 'users.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: true, required: false, setup_required: false },
}

const status = () => ({
  checks: {
    database: 'ok',
    cache: 'ok',
    scheduler: { status: 'stale', last_heartbeat_at: minutesAgo(12) },
    queue: { status: 'ok', driver: 'database', last_heartbeat_at: minutesAgo(1), pending_jobs: 4, failed_jobs: 1 },
    mail: { status: 'ok', mailer: 'smtp', from_address: 'shop@pos.test' },
    backups: {
      status: 'warn', enabled: true, last_success_at: minutesAgo(600), last_file: 'pos-pos-20261124-020000.dump', last_size_bytes: 52428800,
      last_verified_at: null, verify_status: null, last_failure_at: null, schedule_time: '02:00', keep_days: 14,
    },
    storage: { status: 'ok', path: '/var/backups/pos', free_bytes: 400 * 1024 ** 3, total_bytes: 500 * 1024 ** 3 },
    errors: { open: 1, new_last_24h: 1 },
  },
  app: { environment: 'production', debug: true, php_version: '8.4.16', laravel_version: '13.2.0', timezone: 'Asia/Dhaka' },
  warnings: [
    { code: 'APP_DEBUG_ON', message: 'APP_DEBUG is true.' },
    { code: 'SCHEDULER_STALE', message: 'No scheduler heartbeat for 12 minutes.' },
    { code: 'BACKUP_UNVERIFIED', message: 'The newest backup has not been verified.' },
  ],
  retention: { last_run_at: minutesAgo(300), deleted: { login_activities: 120, failed_jobs: 3 } },
})

const backup = (overrides: Record<string, unknown> = {}) => ({
  id: 'bk-1', started_at: minutesAgo(600), finished_at: minutesAgo(599), status: 'succeeded', file_name: 'pos-pos-20261124-020000.dump',
  size_bytes: 52428800, sha256: 'a3f1c2d4e5b6978877665544332211ffeeddccbbaa99887766554433221100aa', error: null,
  offsite_status: 'skipped', offsite_error: null, verified_at: null, verify_status: null, verify_error: null, verify_mode: null,
  triggered_by: 'schedule', user_id: null, ...overrides,
})

const failedJob = {
  id: 1, uuid: 'fj-uuid-1', job: 'App\\Modules\\Media\\Infrastructure\\Jobs\\GenerateRenditions', queue: 'default', connection: 'database',
  failed_at: minutesAgo(10), exception: 'RuntimeException: GD could not read the image.',
}

const errorEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'er-1', exception_class: 'Illuminate\\Database\\QueryException', message: 'SQLSTATE[23505]: insert into "sales" ("number") values (?)',
  file: 'app/Modules/Sales/Application/Actions/CompleteSale.php', line: 120, occurrences: 7, first_seen_at: minutesAgo(600), last_seen_at: minutesAgo(5),
  last_method: 'POST', last_path: '/api/v1/pos/checkout', last_request_id: 'req-abc-123', status: 'open', resolved_at: null, ...overrides,
})
const TRACE = Array.from({ length: 30 }, (_, i) => `#${i} app/Modules/Sales/Application/Actions/CompleteSale.php(${100 + i}): App\\Modules\\Sales\\Application\\Actions\\CompleteSale->handle()`).join('\n')

const api = (path: string) => new RegExp(`/api/v1${path.replace(/[/.]/g, '\\$&')}(\\?.*)?$`)

/** Shared mocks; returns every API request the page made. */
async function mockApp(page: Page, me: unknown) {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) requests.push(request)
  })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route(api('/health'), (route) =>
    route.fulfill({ json: envelope({ status: 'ok', checks: { database: 'ok', cache: 'ok' }, app: 'Enterprise POS', environment: 'e2e', time: '' }) }),
  )
  await page.route(api('/platform/system/status'), (route) => route.fulfill({ json: envelope(status()) }))
  await page.route(api('/platform/system/failed-jobs'), (route) => route.fulfill({ json: paged([]) }))
  await page.route(api('/platform/system/backups'), (route) => route.fulfill({ json: paged([backup()]) }))
  return requests
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

test('platform admin: warnings in plain words and the health of the install, without an organization', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const requests = await mockApp(page, platformAdmin)

  await page.goto('/admin/system-status')

  const warnings = page.getByRole('region', { name: /Needs attention/ })
  await expect(warnings).toBeVisible()
  await expect(warnings.getByText('Debug mode is on')).toBeVisible()
  await expect(warnings.getByText('The scheduler is not running')).toBeVisible()
  await expect(warnings.getByText('Backups are not verified')).toBeVisible()

  const checks = page.getByRole('list', { name: 'Health checks' })
  await expect(checks.getByText('Last heartbeat 12 min ago')).toBeVisible()
  await expect(checks.getByText('Driver database · 4 pending · 1 failed')).toBeVisible()
  await expect(page.getByRole('meter', { name: 'Backup disk used' })).toHaveAttribute('aria-valuetext', '400 GB free of 500 GB (80 % free)')
  await expect(page.getByRole('table', { name: 'Recent backups' })).toContainText('50 MB')
  await expect(page.getByText('No failed jobs')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // Install-wide data: no organization header, and the tenant health endpoint is not used.
  expect(requests.some((r) => r.url().includes('/api/v1/health'))).toBe(false)
  expect(requests.every((r) => r.headers()['x-organization-id'] === undefined)).toBe(true)
})

test('platform admin: back up now polls the list until the new backup is done', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await mockApp(page, platformAdmin)
  let phase: 'before' | 'running' | 'done' = 'before'
  let runningPolls = 0
  const running = backup({ id: 'bk-2', started_at: new Date().toISOString(), finished_at: null, status: 'running', size_bytes: null, sha256: null, triggered_by: 'user' })
  await page.route(api('/platform/system/backups'), (route) => {
    if (route.request().method() === 'POST') {
      phase = 'running'
      return route.fulfill({ status: 202, json: envelope(running) })
    }
    if (phase === 'running') {
      runningPolls += 1
      if (runningPolls >= 2) phase = 'done'
      return route.fulfill({ json: paged([running, backup()]) })
    }
    if (phase === 'done') {
      return route.fulfill({ json: paged([{ ...running, status: 'succeeded', finished_at: new Date().toISOString(), size_bytes: 53477376, sha256: 'b'.repeat(64), file_name: 'pos-pos-20261124-101500.dump' }, backup()]) })
    }
    return route.fulfill({ json: paged([backup()]) })
  })

  await page.goto('/admin/system-status')
  const table = page.getByRole('table', { name: 'Recent backups' })
  await expect(table.getByRole('row')).toHaveCount(2)

  await page.getByRole('button', { name: 'Back up now' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Back up the database now?' })
  await dialog.getByRole('button', { name: 'Back up now' }).click()

  await expect(table.getByText('Running')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeDisabled()
  await expect(table.getByRole('row')).toHaveCount(3)
  await expectNoHorizontalScroll(page)

  await expect(page.getByText('Backup finished: pos-pos-20261124-101500.dump (51 MB).')).toBeVisible({ timeout: 15_000 })
  await expect(table.getByText('Running')).toHaveCount(0)
  await expect(table.getByRole('row').nth(1)).toContainText('bbbbbbbbbbbb')
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeEnabled()
  expect(runningPolls).toBeGreaterThanOrEqual(2)
})

test('platform admin: retry a failed job', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await mockApp(page, platformAdmin)
  let jobs = [failedJob]
  const retried: string[] = []
  await page.route(api('/platform/system/failed-jobs'), (route) => route.fulfill({ json: paged(jobs) }))
  await page.route(api('/platform/system/failed-jobs/fj-uuid-1/retry'), (route) => {
    retried.push('fj-uuid-1')
    jobs = []
    return route.fulfill({ json: envelope({ retried: true }) })
  })

  await page.goto('/admin/system-status')
  const table = page.getByRole('table', { name: 'Failed jobs' })
  await expect(table).toContainText('RuntimeException: GD could not read the image.')
  await expectNoHorizontalScroll(page)

  await table.getByRole('button', { name: /^Retry / }).click()

  await expect(page.getByText('No failed jobs')).toBeVisible()
  expect(retried).toEqual(['fj-uuid-1'])
})

test('platform admin: error list → detail → resolve', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await mockApp(page, platformAdmin)
  let current: Record<string, unknown> & { status: string; resolved_at: string | null } = { ...errorEvent(), trace: TRACE }
  const patches: unknown[] = []
  const listStatuses: (string | null)[] = []
  await page.route(api('/platform/system/errors'), (route) => {
    const statusFilter = new URL(route.request().url()).searchParams.get('status')
    listStatuses.push(statusFilter)
    return route.fulfill({ json: paged(statusFilter === current.status ? [errorEvent({ status: current.status })] : []) })
  })
  await page.route(api('/platform/system/errors/er-1'), (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { status: string }
      patches.push(body)
      current = { ...current, status: body.status, resolved_at: new Date().toISOString() }
      return route.fulfill({ json: envelope(errorEvent({ status: body.status, resolved_at: current.resolved_at })) })
    }
    return route.fulfill({ json: envelope(current) })
  })

  await page.goto('/admin/system-status')
  await page.getByRole('link', { name: 'View errors' }).click()

  await expect(page.getByRole('heading', { name: 'Application errors' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Open' })).toHaveAttribute('aria-selected', 'true')
  await expectNoHorizontalScroll(page)
  await page.getByRole('table', { name: 'Open errors' }).getByRole('link', { name: 'QueryException' }).click()

  await expect(page).toHaveURL(/\/admin\/system-status\/errors\/er-1$/)
  await expect(page.getByRole('heading', { level: 1, name: 'QueryException' })).toBeVisible()
  await expect(page.getByText('POST /api/v1/pos/checkout')).toBeVisible()
  await expect(page.getByText('req-abc-123')).toBeVisible()
  const trace = page.getByLabel('Stack trace')
  await expect(trace).toContainText('#29 app/Modules/Sales/Application/Actions/CompleteSale.php(129)')
  // The trace scrolls inside its own box; the page itself never scrolls sideways.
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()
  expect(patches).toEqual([{ status: 'resolved' }])
  await expect(trace).toContainText('#0 app/Modules/Sales')

  await page.getByRole('link', { name: 'Application errors' }).click()
  await expect(page.getByText('No open errors.', { exact: false })).toBeVisible()
  await page.getByRole('tab', { name: 'Resolved' }).click()
  await expect(page.getByRole('table', { name: 'Resolved errors' }).getByRole('link', { name: 'QueryException' })).toBeVisible()
  expect(listStatuses).toContain('resolved')
})

test('a normal user still sees the simple health page and cannot open the error log', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const requests = await mockApp(page, shopAdmin)

  await page.goto('/admin/system-status')
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible()
  await expect(page.getByText('Operational')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Backups' })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await page.goto('/admin/system-status/errors')
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  expect(requests.some((r) => r.url().includes('/platform/system'))).toBe(false)
})
