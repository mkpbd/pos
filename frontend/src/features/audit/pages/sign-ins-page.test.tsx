import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { deviceSummary } from '@/features/audit/device'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[], total = items.length) => ok(items, { pagination: { current_page: 1, per_page: 25, total, last_page: Math.max(1, Math.ceil(total / 25)) } })

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const activity = (overrides: Record<string, unknown> = {}) => ({
  id: 'la-1', user_id: 'u-2', email: 'karim@corner.test', channel: 'session', succeeded: true, failure_reason: null,
  ip_address: '203.0.113.7', user_agent: CHROME_WINDOWS, created_at: '2026-11-20T04:00:00Z', ...overrides,
})

describe('deviceSummary', () => {
  it('names the browser and system', () => {
    expect(deviceSummary(CHROME_WINDOWS)).toBe('Chrome on Windows')
    expect(deviceSummary(SAFARI_IPHONE)).toBe('Safari on iOS')
    expect(deviceSummary('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('Edge on Windows')
    expect(deviceSummary(null)).toBe('Unknown device')
    expect(deviceSummary('PosTerminal/1.0')).toBe('PosTerminal/1.0')
  })
})

describe('SignInsPage (Q1 §6)', () => {
  it('lists the organization’s sign-ins with filters', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /login-activities': (_init, url) => {
        queries.push(url.searchParams)
        return url.searchParams.get('succeeded') === '0'
          ? paged([activity({ id: 'la-2', email: 'nobody@corner.test', succeeded: false, failure_reason: 'invalid_credentials', user_id: null, user_agent: SAFARI_IPHONE })])
          : paged([activity(), activity({ id: 'la-2', email: 'nobody@corner.test', succeeded: false, failure_reason: 'invalid_credentials', user_id: null, user_agent: SAFARI_IPHONE, channel: 'token' })])
      },
    })
    renderRoutes(routes, '/audit-log/sign-ins')

    const table = await screen.findByRole('table', { name: 'Sign-ins' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('karim@corner.test')
    expect(rows[1]).toHaveTextContent('Signed in')
    expect(rows[1]).toHaveTextContent('Chrome on Windows · web')
    expect(rows[1]).toHaveTextContent('203.0.113.7')
    expect(rows[2]).toHaveTextContent('Invalid credentials')
    expect(rows[2]).toHaveTextContent('Safari on iOS · device token')
    expect(screen.getByRole('link', { name: 'Sign-ins' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('combobox', { name: 'Result' }))
    await user.click(await screen.findByRole('option', { name: 'Failed' }))
    await waitFor(() => expect(queries.at(-1)?.get('succeeded')).toBe('0'))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Sign-ins' })).getAllByRole('row')).toHaveLength(2))

    await user.type(screen.getByLabelText('E-mail or IP address'), '203.0')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('203.0'))
    expect(queries.at(-1)?.get('page')).toBe('1')
  })

  it('links the two audit tabs', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /audit-logs': paged([]),
      'GET /login-activities': paged([]),
    })
    const { router } = renderRoutes(routes, '/audit-log')

    await user.click(await screen.findByRole('link', { name: 'Sign-ins' }))
    expect(await screen.findByText('No sign-ins')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/audit-log/sign-ins')
  })

  it('is not available without audit.view', async () => {
    const me = makeCurrentUser()
    mockApi({ 'GET /auth/me': ok({ ...me, permissions: me.permissions.filter((p) => p !== 'audit.view') }) })
    renderRoutes(routes, '/audit-log/sign-ins')

    expect(await screen.findByText(/does not include the “audit.view” permission/)).toBeInTheDocument()
  })
})
