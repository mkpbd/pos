import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser, salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* POS1d §4: the sale page sends the receipt and lists the sends ("Receipt sent"). */

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' },
  customer: { id: 'c-1', code: 'CUS-000001', name: 'Rahim', phone: '01712345678', email: 'rahim@gmail.com' }, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '200.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '200.00',
  paid_total: '200.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, lines: [], returns: [],
  payments: [{ id: 'p-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '200.00', tendered: null, reference: null, created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' }],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
  receipt_deliveries: [],
  ...overrides,
})

describe('Sale page — send receipt', () => {
  it('sends the receipt by SMS and lists it under "Receipt sent"', async () => {
    const user = userEvent.setup()
    let current = sale()
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /sales/sa-1': () => ok(current),
      'GET /sales/sa-1/receipt-link': ok({ url: null, token: 'tok' }),
      'POST /sales/sa-1/receipt/send': () => {
        current = sale({ receipt_deliveries: [{ channel: 'sms', recipient_masked: '017••••678', status: 'queued', created_by_name: 'Rahim Uddin', created_at: '2026-10-31T07:00:00Z' }] })
        return ok({ channel: 'sms', recipient_masked: '017••••678', status: 'queued' })
      },
    })
    renderRoutes(routes, '/sales/sa-1')

    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000007' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Receipt sent' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send receipt' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send receipt' })
    expect(within(dialog).getByLabelText('Mobile number')).toHaveValue('01712345678')
    await user.click(within(dialog).getByRole('radio', { name: 'E-mail' }))
    expect(within(dialog).getByLabelText('E-mail address')).toHaveValue('rahim@gmail.com')
    await user.click(within(dialog).getByRole('radio', { name: 'SMS' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent to 017••••678')
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    const sent = await screen.findByRole('region', { name: 'Receipt sent' })
    const row = within(sent).getByTestId('receipt-delivery')
    expect(row).toHaveTextContent('SMS')
    expect(row).toHaveTextContent('017••••678')
    expect(row).toHaveTextContent('Sent')
    expect(row).toHaveTextContent('by Rahim Uddin')
  })

  it('has no "Send receipt" without pos.sell, and none on a cancelled sale', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['branches.view', 'sales.view'] })),
      'GET /sales/sa-1': ok(sale({ receipt_deliveries: [{ channel: 'email', recipient_masked: 'ra•••@gmail.com', status: 'failed', created_by_name: null, created_at: '2026-10-31T07:00:00Z' }] })),
    })
    const { unmount } = renderRoutes(routes, '/sales/sa-1')
    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000007' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send receipt' })).not.toBeInTheDocument()
    const row = within(screen.getByRole('region', { name: 'Receipt sent' })).getByTestId('receipt-delivery')
    expect(row).toHaveTextContent('E-mail')
    expect(row).toHaveTextContent('Failed')
    unmount()

    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /sales/sa-1': ok(sale({ status: 'cancelled' })) })
    renderRoutes(routes, '/sales/sa-1')
    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000007' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send receipt' })).not.toBeInTheDocument()
  })
})
