import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser, stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/** ST2b: purchase order Print and E-mail to supplier; goods receipt Print. */

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const supplierRow = { ...supplier, contact_person: null, email: 'orders@mills.test', phone: null, address: null, tax_number: null, payment_terms_days: 30, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const juice = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_batches: false }
const line = { id: 'pol-1', variant: juice, quantity: '10.000', received_quantity: '0.000', unit_cost: '100.0000', tax_rate: '0.0000', line_subtotal: '1000.00', line_tax: '0.00', line_total: '1000.00' }
const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier, store, currency: 'BDT', subtotal: '1000.00', tax_total: '0.00', total: '1000.00',
  notes: null, created_at: '2026-11-20T00:00:00Z', order_date: '2026-11-20', expected_date: null, ordered_at: '2026-11-20T00:00:00Z', lines: [line],
}
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: 'po-1', supplier, store, currency: 'BDT', subtotal: '1000.00', tax_total: '0.00', total: '1000.00',
  notes: null, created_at: '2026-11-21T00:00:00Z', supplier_invoice_number: 'LM-1', invoice_date: '2026-11-21', due_date: null,
  lines: [{ ...line, id: 'grl-1', returned_quantity: '0.000' }],
}

describe('Purchase order documents', () => {
  it('e-mails the order to the supplier address and then shows when it was sent', async () => {
    const user = userEvent.setup()
    let current: Record<string, unknown> = order
    let posted: unknown
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': () => ok(current),
      'GET /suppliers/sup-1': ok(supplierRow),
      'POST /purchasing/orders/po-1/email': (init) => {
        posted = JSON.parse(String(init.body))
        current = { ...order, emailed_at: '2026-11-26T10:00:00Z', emailed_to: 'buyer@mills.test' }
        return ok({ emailed_at: '2026-11-26T10:00:00Z', emailed_to: 'buyer@mills.test' })
      },
    })
    renderRoutes(routes, '/purchasing/orders/po-1')

    await user.click(await screen.findByRole('button', { name: 'E-mail to supplier' }))
    const dialog = await screen.findByRole('dialog', { name: 'E-mail PO-000001' })
    await waitFor(() => expect(within(dialog).getByLabelText('To')).toHaveValue('orders@mills.test'))
    await user.clear(within(dialog).getByLabelText('To'))
    await user.type(within(dialog).getByLabelText('To'), 'buyer@mills.test')
    await user.click(within(dialog).getByRole('button', { name: 'Send e-mail' }))

    await waitFor(() => expect(posted).toEqual({ to: 'buyer@mills.test' }))
    expect(await screen.findByText(/E-mailed to/)).toHaveTextContent('E-mailed to buyer@mills.test on')
  })

  it('shows a missing address error from the server under the field', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok(order),
      'GET /suppliers/sup-1': ok({ ...supplierRow, email: null }),
      'POST /purchasing/orders/po-1/email': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { to: ['The supplier has no e-mail address; enter one.'] }),
    })
    renderRoutes(routes, '/purchasing/orders/po-1')

    await user.click(await screen.findByRole('button', { name: 'E-mail to supplier' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send e-mail' }))
    expect(await within(dialog).findByText('The supplier has no e-mail address; enter one.')).toBeInTheDocument()
  })

  it('offers e-mail only for ordered / partly received orders and to users who manage purchases', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['purchases.view'] })),
      'GET /purchasing/orders/po-1': ok(order),
    })
    renderRoutes(routes, '/purchasing/orders/po-1')

    expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'E-mail to supplier' })).not.toBeInTheDocument()
  })

  it('hides e-mail on a received order and prints the PDF', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok({ ...order, status: 'received' }),
    })
    renderRoutes(routes, '/purchasing/orders/po-1')

    await user.click(await screen.findByRole('button', { name: 'Print' }))
    expect(screen.queryByRole('button', { name: 'E-mail to supplier' })).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/purchasing/orders/po-1/pdf'))).toBe(true))
  })
})

describe('Goods receipt documents', () => {
  it('prints the goods receipt PDF', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/receipts/gr-1': ok(receipt),
    })
    renderRoutes(routes, '/purchasing/receipts/gr-1')

    await user.click(await screen.findByRole('button', { name: 'Print' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/purchasing/receipts/gr-1/pdf'))).toBe(true))
  })
})
