import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SystemStatusPage } from '@/features/system/pages/system-status-page'
import { makeBackup, makeStatus, platformAdmin } from '@/features/system/testing'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const healthy = { status: 'ok', checks: { database: 'ok', cache: 'ok' }, app: 'Enterprise POS', environment: 'local', time: '2026-10-31T00:00:00+00:00' }
const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 15, total: items.length, last_page: 1 } })
const renderPage = () => renderRoutes([{ path: '/system-status', element: <SystemStatusPage /> }], '/system-status')

describe('SystemStatusPage (everyone)', () => {
  it('shows each dependency as operational', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /health': ok(healthy) })

    renderPage()

    expect(await screen.findByText('Operational')).toBeInTheDocument()
    expect(screen.getByText('Database (PostgreSQL)')).toBeInTheDocument()
    expect(screen.getAllByText('OK')).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'Backups' })).not.toBeInTheDocument()
  })

  it('shows degraded status when a dependency fails', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /health': { status: 503, body: { success: true, data: { ...healthy, status: 'degraded', checks: { database: 'fail', cache: 'ok' } }, meta: { request_id: 'r-1' } } },
    })

    renderPage()

    expect(await screen.findByText('Degraded')).toBeInTheDocument()
    expect(screen.getByText('Failing')).toBeInTheDocument()
  })

  it('shows an error with retry when the backend is unreachable, and recovers', async () => {
    const user = userEvent.setup()
    let down = true
    const fetchMock = mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /health': ok(healthy) })
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (down && String(input).includes('/health')) {
        down = false
        throw new TypeError('Failed to fetch')
      }
      return original(input, init)
    })

    renderPage()

    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Operational')).toBeInTheDocument()
  })
})

describe('SystemStatusPage (platform admin, G1b)', () => {
  it('shows the operations view without calling /health or sending an organization', async () => {
    const fetchMock = mockApi({
      'GET /auth/me': ok(platformAdmin()),
      'GET /platform/system/status': ok(
        makeStatus({}, { warnings: [{ code: 'SCHEDULER_STALE', message: 'No scheduler heartbeat for 12 minutes.' }, { code: 'NEW_CODE', message: 'Something the server added later.' }] }),
      ),
      'GET /platform/system/backups': paged([makeBackup()]),
      'GET /platform/system/failed-jobs': paged([]),
    })

    renderPage()

    const warnings = await screen.findByRole('region', { name: /needs attention/i })
    expect(within(warnings).getByText('The scheduler is not running')).toBeInTheDocument()
    expect(within(warnings).getByText('No scheduler heartbeat for 12 minutes.')).toBeInTheDocument()
    expect(within(warnings).getByText(/schedule:run/)).toBeInTheDocument()
    // Unknown codes fall back to the server's own words.
    expect(within(warnings).getByText('Something the server added later.')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Health' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Backups' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Failed jobs' })).toBeInTheDocument()

    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> }))
    expect(calls.some((c) => c.url.includes('/health'))).toBe(false)
    expect(calls.every((c) => !('X-Organization-Id' in c.headers))).toBe(true)
  })

  it('says so when nothing needs attention', async () => {
    mockApi({
      'GET /auth/me': ok(platformAdmin()),
      'GET /platform/system/status': ok(makeStatus()),
      'GET /platform/system/backups': paged([]),
      'GET /platform/system/failed-jobs': paged([]),
    })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Nothing needs attention' })).toBeInTheDocument()
  })
})
