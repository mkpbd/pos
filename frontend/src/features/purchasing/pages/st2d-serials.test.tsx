import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/** ST2d: serial numbers on goods receipts and purchase returns. */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Phone Hub' }
const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const phone = { id: 'v-9', product_name: 'Phone X', variant_name: null, sku: 'PHONE-X', unit_code: 'pcs', allow_decimal: false, track_batches: false, track_serials: true }
const phoneProduct = {
  id: 'p-9', name: 'Phone X', type: 'standard', track_stock: true, track_batches: false, track_serials: true, is_active: true,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-9', sku: 'PHONE-X', name: null, option_values: {}, purchase_price: '900.0000', is_active: true }],
}
const orderLine = {
  id: 'pol-1', variant: phone, quantity: '2.000', received_quantity: '0.000', unit_cost: '900.0000', tax_rate: '0.0000',
  discount_percent: '0.0000', bonus_quantity: '1.000', line_subtotal: '1800.00', line_tax: '0.00', line_total: '1800.00',
}
const order = {
  id: 'po-1', number: 'PO-000001', status: 'ordered', supplier, store, currency: 'BDT', subtotal: '1800.00', tax_total: '0.00', total: '1800.00',
  notes: null, created_at: '2026-11-20T00:00:00Z', order_date: '2026-11-20', expected_date: null, ordered_at: '2026-11-20T00:00:00Z', lines: [orderLine],
}
const receipt = {
  id: 'gr-1', number: 'GRN-000001', purchase_order_id: 'po-1', supplier, store, currency: 'BDT', subtotal: '1800.00', tax_total: '0.00', total: '1800.00',
  notes: null, created_at: '2026-11-21T00:00:00Z', supplier_invoice_number: 'PH-1', invoice_date: '2026-11-21', due_date: null,
  lines: [{ ...orderLine, id: 'grl-1', received_quantity: undefined, returned_quantity: '0.000', serials: ['IMEI-001', 'IMEI-002', 'IMEI-003'] }],
}

async function enterSerials(user: ReturnType<typeof userEvent.setup>, button: string, serials: string[]) {
  await user.click(screen.getByRole('button', { name: button }))
  const dialog = await screen.findByRole('dialog', { name: 'Serial numbers' })
  for (const s of serials) await user.type(within(dialog).getByLabelText('Serial number'), `${s}{Enter}`)
  await user.click(within(dialog).getByRole('button', { name: `Save ${serials.length} serials` }))
}

describe('Goods receipt with serials', () => {
  it('needs a serial for every unit received, free ones included, and shows SERIAL_IN_STOCK at the line', async () => {
    const user = userEvent.setup()
    let posted: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/orders/po-1': ok(order),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'POST /purchasing/receipts': (init) => {
        posted = JSON.parse(String(init.body))
        return fail(422, 'SERIAL_IN_STOCK', 'Some serial numbers are already in stock.', { serials: ['IMEI-003'] })
      },
    })
    renderRoutes(routes, '/purchasing/receipts/new?order=po-1')

    expect(await screen.findByRole('heading', { name: 'Receive PO-000001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Serials of line 1' })).toHaveTextContent('0/3')
    await user.click(screen.getByRole('button', { name: 'Post receipt' }))
    expect(await screen.findByText('Enter 3 serial numbers (0 entered).')).toBeInTheDocument()

    await enterSerials(user, 'Serials of line 1', ['IMEI-001', 'IMEI-002', 'IMEI-003'])
    await user.click(screen.getByRole('button', { name: 'Post receipt' }))
    expect(await screen.findByText('Already in stock: IMEI-003')).toBeInTheDocument()
    expect(posted?.lines).toEqual([
      { variant_id: 'v-9', quantity: '2', unit_cost: '900', tax_rate: '0', discount_percent: '0', bonus_quantity: '1', serials: ['IMEI-001', 'IMEI-002', 'IMEI-003'], purchase_order_line_id: 'pol-1' },
    ])
  })
})

describe('Purchase returns with serials', () => {
  it('shows the received serials and returns one of them from the receipt', async () => {
    const user = userEvent.setup()
    let body: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/receipts/gr-1': ok(receipt),
      'POST /purchasing/receipts/gr-1/returns': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ id: 'prn-1', number: 'PRN-000001', goods_receipt_id: 'gr-1' })
      },
    })
    renderRoutes(routes, '/purchasing/receipts/gr-1')

    expect(await screen.findByRole('columnheader', { name: 'Serials' })).toBeInTheDocument()
    expect(screen.getByText('IMEI-001, IMEI-002, IMEI-003')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Return goods' }))
    const dialog = await screen.findByRole('dialog', { name: 'Return goods from GRN-000001' })
    await user.type(within(dialog).getByLabelText('Return quantity of Phone X'), '1')
    await user.type(within(dialog).getByLabelText('Reason'), 'faulty')
    await user.click(within(dialog).getByRole('button', { name: 'Post return' }))
    expect(await within(dialog).findByText('Enter one serial number per unit returned.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Returned serials of Phone X' }))
    const serials = await screen.findByRole('dialog', { name: 'Serial numbers' })
    expect(within(serials).getByText('Pick from this document')).toBeInTheDocument()
    await user.click(within(serials).getByRole('button', { name: 'IMEI-002' }))
    await user.click(within(serials).getByRole('button', { name: 'Save 1 serial' }))
    await user.click(within(dialog).getByRole('button', { name: 'Post return' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body?.lines).toEqual([{ goods_receipt_line_id: 'grl-1', quantity: '1', serials: ['IMEI-002'] }])
  })

  it('returns a serial without a receipt, picked from the store’s stock', async () => {
    const user = userEvent.setup()
    let body: { lines: Record<string, unknown>[] } | undefined
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/returns': paged([]),
      'GET /suppliers': paged([{ ...supplier, is_active: true }]),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([phoneProduct]),
      'GET /inventory/stores/s-1/serials': ok([{ id: 'sn-7', serial: 'IMEI-777' }]),
      'POST /purchasing/returns': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ id: 'prn-2', number: 'PRN-000002', goods_receipt_id: null })
      },
    })
    renderRoutes(routes, '/purchasing/returns/new')

    await user.click(await screen.findByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Phone Hub/ }))
    await user.click(screen.getByRole('combobox', { name: 'From store' }))
    await user.click(await screen.findByRole('option', { name: /Shop floor/ }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.click(await screen.findByRole('option', { name: /Phone X/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '1')
    await user.type(screen.getByLabelText('Reason'), 'faulty')

    await user.click(screen.getByRole('button', { name: 'Serials of line 1' }))
    const serials = await screen.findByRole('dialog', { name: 'Serial numbers' })
    await user.click(await within(serials).findByRole('button', { name: 'IMEI-777' }))
    await user.click(within(serials).getByRole('button', { name: 'Save 1 serial' }))
    await user.click(screen.getByRole('button', { name: 'Post return' }))

    await waitFor(() => expect(body?.lines).toEqual([{ variant_id: 'v-9', quantity: '1', serials: ['IMEI-777'] }]))
  })
})
