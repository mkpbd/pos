import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const headers = (init: RequestInit) => init.headers as Record<string, string>

const buyer = () => makeCurrentUser({ permissions: ['branches.view', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.landed_cost'] })
const viewer = () => makeCurrentUser({ permissions: ['branches.view', 'suppliers.view', 'purchases.view'] })

const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const swift = { id: 'sup-3', code: 'SUP-000003', name: 'Swift Freight' }
const supplierRows = [mills, swift].map((s) => ({ ...s, contact_person: null, phone: null, email: null, address: null, tax_number: null, payment_terms_days: 0, opening_balance: '0.00', notes: null, is_active: true, archived_at: null }))
const floor = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const north = { id: 's-5', code: 'NFLOOR', name: 'North floor', branch_id: 'b-2', branch_name: 'North' }
const receiptHeader = (id: string, number: string, store: typeof floor, total: string) => ({
  id, number, purchase_order_id: null, supplier: mills, store, currency: 'BDT', subtotal: total, tax_total: '0.00', total, notes: null,
  created_at: '2026-11-01T00:00:00Z', supplier_invoice_number: null, invoice_date: '2026-11-01', due_date: null,
})
const receipts = [receiptHeader('gr-2', 'GRN-000002', floor, '7828.00'), receiptHeader('gr-9', 'GRN-000009', north, '500.00')]

const allocation = (overrides: Record<string, unknown> = {}) => ({
  goods_receipt_id: 'gr-2', goods_receipt_number: 'GRN-000002', goods_receipt_line_id: 'grl-1', store: floor, batch: null,
  variant: { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg' },
  received_quantity: '100.000', returned_quantity: '0.000', on_hand_quantity: '75.000', consumed_quantity: '25.000', line_value: '6100.00',
  amount: '93.53', on_hand_amount: '70.15', consumed_amount: '23.38', landed_unit_cost: '65.3963', previous_voucher_cost: '0.00', new_landed_unit_cost: '66.3316',
  average_cost_before: '64.1000', average_cost_after: '65.0353', stock_movement_id: null, ...overrides,
})
const previewLines = [
  allocation(),
  allocation({ goods_receipt_line_id: 'grl-2', variant: { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs' }, received_quantity: '96.000', on_hand_quantity: '0.000', consumed_quantity: '96.000', amount: '26.47', on_hand_amount: '0.00', consumed_amount: '26.47', landed_unit_cost: '19.6497', new_landed_unit_cost: '19.9254', average_cost_before: null, average_cost_after: null }),
]

const voucher = (overrides: Record<string, unknown> = {}) => ({
  id: 'lcv-1', number: 'LCV-000001', status: 'posted', branch: { id: 'b-1', name: 'Main Branch' }, voucher_date: '2026-11-05', charge_supplier: swift,
  reference: 'SF-77', notes: null, currency: 'BDT', charges_total: '120.00', tax_total: '18.00', total: '138.00', receipt_numbers: ['GRN-000002'], receipt_count: 1,
  charges: [{ id: 'lcc-1', type: 'freight', description: 'Late freight bill', amount: '120.00', tax_amount: '18.00', allocation: 'value' }],
  receipts: [{ id: 'gr-2', number: 'GRN-000002', supplier: mills, store: floor, supplier_invoice_number: null, invoice_date: '2026-11-01', subtotal: '7828.00', charges_total: '0.00', landed_total: '7828.00' }],
  allocation_source: 'posted', allocations: previewLines, on_hand_total: '70.15', consumed_total: '49.85', expense: { id: 'ex-4', number: 'EXP-000004' },
  posted_at: '2026-11-05T09:00:00Z', posted_by: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-05T08:00:00Z',
  ...overrides,
})

const previewReply = { currency: 'BDT', charges_total: '120.00', tax_total: '18.00', total: '138.00', on_hand_total: '70.15', consumed_total: '49.85', allocations: previewLines }

beforeEach(() => {
  toastSuccess.mockReset()
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

describe('VouchersPage', () => {
  it('lists vouchers with status and export; only landed-cost managers create them', async () => {
    mockApi({ 'GET /auth/me': ok(buyer()), 'GET /purchasing/landed-cost-vouchers': paged([voucher()]) })
    const first = renderRoutes(routes, '/purchasing/landed-costs')

    const row = (await screen.findByRole('link', { name: 'LCV-000001' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Swift Freight')).toBeInTheDocument()
    expect(within(row).getByText('GRN-000002')).toBeInTheDocument()
    expect(within(row).getByText('BDT 138.00')).toBeInTheDocument()
    expect(within(row).getByText('Posted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('data-export-list', 'landedCostVouchers')
    expect(screen.getByRole('link', { name: 'New voucher' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Landed costs' })).toHaveAttribute('aria-current', 'page')
    first.unmount()

    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /purchasing/landed-cost-vouchers': paged([]) })
    renderRoutes(routes, '/purchasing/landed-costs')
    expect(await screen.findByText('No landed cost vouchers yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New voucher' })).not.toBeInTheDocument()
  })
})

describe('VoucherPage — editor', () => {
  it('picks receipts of one branch, previews the server allocation and posts with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    let previewBody: Record<string, unknown> | undefined
    let postKey: string | undefined
    const draft = voucher({ id: 'lcv-9', number: 'LCV-000009', status: 'draft', allocation_source: 'preview', posted_at: null, posted_by: null, expense: null })
    mockApi({
      'GET /auth/me': ok(buyer()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/receipts': paged(receipts),
      'POST /purchasing/landed-cost-vouchers/preview': (init) => {
        previewBody = JSON.parse(String(init.body))
        return ok(previewReply)
      },
      'POST /purchasing/landed-cost-vouchers': (init) => {
        created = JSON.parse(String(init.body))
        return ok(draft)
      },
      'POST /purchasing/landed-cost-vouchers/lcv-9/post': (init) => {
        postKey = headers(init)['Idempotency-Key']
        return ok({ ...draft, status: 'posted' })
      },
      'GET /purchasing/landed-cost-vouchers/lcv-9': ok(voucher({ id: 'lcv-9', number: 'LCV-000009' })),
    })
    const { router } = renderRoutes(routes, '/purchasing/landed-costs/new')

    expect(await screen.findByRole('heading', { name: 'New landed cost voucher' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save & post' }))
    expect(await screen.findByText('Choose the supplier who bills these charges.')).toBeInTheDocument()
    expect(screen.getByText('Choose at least one posted receipt.')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Swift Freight/ }))
    await user.type(screen.getByLabelText('Supplier bill no.'), 'SF-77')
    await user.type(screen.getByLabelText('Description of charge 1'), 'Late freight bill')
    await user.type(screen.getByLabelText('Amount of charge 1'), '120')
    await user.type(screen.getByLabelText('Tax on charge 1'), '18')
    expect(screen.getByTestId('voucher-payable')).toHaveTextContent('BDT 138.00')

    const list = await screen.findByRole('list', { name: 'Posted receipts' })
    await user.click(await within(list).findByRole('checkbox', { name: 'Apply to GRN-000002' }))
    expect(within(list).getByRole('checkbox', { name: 'Apply to GRN-000009' })).toBeDisabled()
    expect(within(list).getByText(/other branch \(North\)/)).toBeInTheDocument()
    expect(screen.getByText('1 receipt chosen — Main Branch only.')).toBeInTheDocument()

    const preview = await screen.findByRole('table', { name: 'Allocation preview' }, { timeout: 3000 })
    expect(within(preview).getByRole('row', { name: 'GRN-000002 Miniket Rice' })).toHaveTextContent('66.3316')
    expect(screen.getByTestId('voucher-on-hand-total')).toHaveTextContent('BDT 70.15')
    expect(screen.getByTestId('voucher-consumed-total')).toHaveTextContent('BDT 49.85')
    expect(previewBody).toEqual({
      branch_id: 'b-1', voucher_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), charge_supplier_id: 'sup-3', reference: 'SF-77', notes: null,
      charges: [{ type: 'freight', description: 'Late freight bill', amount: '120', tax_amount: '18', allocation: 'value' }],
      receipt_ids: ['gr-2'],
    })

    await user.click(screen.getByRole('button', { name: 'Save & post' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('BDT 70.15 is added to the value of stock on hand')
    expect(confirm).toHaveTextContent('BDT 49.85 is expensed')
    expect(confirm).toHaveTextContent('The supplier is owed BDT 138.00')
    await user.click(within(confirm).getByRole('button', { name: 'Post voucher' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/landed-costs/lcv-9'))
    expect(created).toEqual(previewBody)
    expect(postKey).toBeTruthy()
    expect(toastSuccess).toHaveBeenCalledWith('LCV-000009 posted — stock costs updated.')
    expect(await screen.findByRole('table', { name: 'Posted allocation' })).toBeInTheDocument()
  })

  it('edits a draft and deletes it', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    let deleted = false
    const draft = voucher({ status: 'draft', allocation_source: 'preview', posted_at: null, posted_by: null, expense: null })
    mockApi({
      'GET /auth/me': ok(buyer()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/receipts': paged(receipts),
      'GET /purchasing/landed-cost-vouchers/lcv-1': ok(draft),
      'POST /purchasing/landed-cost-vouchers/preview': ok(previewReply),
      'PUT /purchasing/landed-cost-vouchers/lcv-1': (init) => {
        saved = JSON.parse(String(init.body))
        return ok(draft)
      },
      'DELETE /purchasing/landed-cost-vouchers/lcv-1': () => {
        deleted = true
        return { status: 204 }
      },
      'GET /purchasing/landed-cost-vouchers': paged([]),
    })
    const { router } = renderRoutes(routes, '/purchasing/landed-costs/lcv-1')

    expect(await screen.findByRole('heading', { name: 'Edit LCV-000001' })).toBeInTheDocument()
    expect(screen.getByLabelText('Amount of charge 1')).toHaveValue('120')
    expect(screen.getByRole('list', { name: 'Chosen receipts' })).toHaveTextContent('GRN-000002')
    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    await user.type(screen.getByLabelText('Amount of charge 2'), '30')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.charges).toEqual([
      { type: 'freight', description: 'Late freight bill', amount: '120', tax_amount: '18', allocation: 'value' },
      { type: 'other', description: null, amount: '30', tax_amount: '0', allocation: 'value' },
    ])

    await user.click(await screen.findByRole('button', { name: 'Delete draft' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/landed-costs'))
    expect(deleted).toBe(true)
  })
})

describe('VoucherPage — detail', () => {
  it('shows a posted voucher with its on-hand and sold shares', async () => {
    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /purchasing/landed-cost-vouchers/lcv-1': ok(voucher()) })
    renderRoutes(routes, '/purchasing/landed-costs/lcv-1')

    expect(await screen.findByRole('heading', { name: 'LCV-000001' })).toBeInTheDocument()
    expect(screen.getByText('Posted', { selector: '[data-slot="badge"], span' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GRN-000002' })).toHaveAttribute('href', '/purchasing/receipts/gr-2')
    const table = screen.getByRole('table', { name: 'Posted allocation' })
    const juiceRow = within(table).getByRole('row', { name: 'GRN-000002 Mango Juice 1L' })
    expect(juiceRow).toHaveTextContent('26.47')
    expect(screen.getByTestId('voucher-consumed-total')).toHaveTextContent('BDT 49.85')
    expect(screen.getByText(/recorded as expense EXP-000004/)).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: 'GRN-000002 Miniket Rice' })).toHaveTextContent('65.3963 → 66.3316')
    expect(screen.queryByRole('button', { name: 'Save & post' })).not.toBeInTheDocument()
  })

  it('shows a draft read-only with its live allocation to users who cannot post', async () => {
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /purchasing/landed-cost-vouchers/lcv-1': ok(voucher({ status: 'draft', allocation_source: 'preview', posted_at: null, posted_by: null, expense: null, on_hand_total: null, consumed_total: null })),
    })
    renderRoutes(routes, '/purchasing/landed-costs/lcv-1')

    expect(await screen.findByRole('table', { name: 'Allocation preview' })).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText(/split is fixed when the voucher is posted/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete draft' })).not.toBeInTheDocument()
  })
})
