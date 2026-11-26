import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { openSessionReport, posCashier } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* POS1d §4: the session report and the close dialog show the drawer openings without a sale. */

const routesFor = (report: Record<string, unknown>) => ({
  'GET /auth/me': ok(posCashier()),
  'GET /register-sessions/current': ok(report),
  'GET /register-sessions/ses-1': ok(report),
  'GET /register-sessions': ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }),
  'GET /cash-registers': ok([]),
})

describe('Register session — no-sale openings', () => {
  it('lists each opening with time, user, reason and approver, and the close dialog shows the count', async () => {
    const user = userEvent.setup()
    mockApi(routesFor(openSessionReport({
      no_sale_count: 2,
      no_sale_openings: [
        { opened_at: '2026-10-31T05:00:00Z', reason: 'Change for the next till', user_name: 'Pos Cashier', approved_by_name: 'Mina Manager' },
        { opened_at: '2026-10-31T06:30:00Z', reason: 'Customer dropped a coin', user_name: 'Mina Manager', approved_by_name: null },
      ],
    })))
    renderRoutes(routes, '/cash-registers/sessions/ses-1')

    const card = await screen.findByRole('region', { name: 'No-sale openings' })
    expect(within(card).getByTestId('no-sale-count')).toHaveTextContent('2')
    const rows = within(card).getAllByTestId('no-sale-opening')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Pos Cashier')
    expect(rows[0]).toHaveTextContent('Change for the next till')
    expect(rows[0]).toHaveTextContent('Mina Manager')
    expect(rows[1]).toHaveTextContent('Customer dropped a coin')
    expect(rows[1]).toHaveTextContent('—')

    await user.click(screen.getByRole('button', { name: 'Close session' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close SES-MAIN-000001' })
    expect(within(dialog).getByTestId('close-no-sale-count')).toHaveTextContent('2')
  })

  it('says none when the drawer stayed shut, and shows nothing for a server without the count', async () => {
    mockApi(routesFor(openSessionReport({ no_sale_count: 0, no_sale_openings: [] })))
    const { unmount } = renderRoutes(routes, '/cash-registers/sessions/ses-1')
    const card = await screen.findByRole('region', { name: 'No-sale openings' })
    expect(card).toHaveTextContent('The drawer was not opened without a sale.')
    unmount()

    mockApi(routesFor(openSessionReport()))
    renderRoutes(routes, '/cash-registers/sessions/ses-1')
    expect(await screen.findByRole('heading', { name: 'SES-MAIN-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'No-sale openings' })).not.toBeInTheDocument()
  })
})
