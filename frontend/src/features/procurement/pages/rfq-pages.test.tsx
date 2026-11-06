import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { captureDownloads, fileResponse } from '@/features/exports/testing'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { comparison, fresh, manager, mills, rfq, supplierRows } from '@/features/procurement/test-data'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const headers = (init: RequestInit) => init.headers as Record<string, string>
const viewer = () => makeCurrentUser({ permissions: ['branches.view', 'purchases.view', 'suppliers.view'] })

const juiceProduct = {
  id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, is_active: true,
  unit: { id: 'un-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
  variants: [{ id: 'v-1', name: null, sku: 'JUICE-1L', option_values: {}, is_active: true }],
}

beforeEach(() => {
  toastSuccess.mockReset()
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

describe('RfqsPage', () => {
  it('lists RFQs with quote counts; only purchasing managers create them', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/rfqs': paged([{ ...rfq(), quote_count: 1, supplier_count: 2, lines: undefined, suppliers: undefined }]) })
    const first = renderRoutes(routes, '/purchasing/rfqs')

    const row = (await screen.findByRole('link', { name: 'RFQ-000002' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Rice and juice for November')).toBeInTheDocument()
    expect(within(row).getByText('1 / 2')).toBeInTheDocument()
    expect(within(row).getByText('Sent')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New RFQ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('data-export-list', 'rfqs')
    first.unmount()

    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /purchasing/rfqs': paged([]) })
    renderRoutes(routes, '/purchasing/rfqs')
    expect(await screen.findByText('No RFQs yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New RFQ' })).not.toBeInTheDocument()
  })
})

describe('RfqPage — editor', () => {
  it('invites at least two suppliers and sends the RFQ with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    let sendKey: string | undefined
    const created = rfq({ id: 'rfq-9', number: 'RFQ-000009', status: 'draft', sent_at: null })
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /suppliers': paged(supplierRows),
      'GET /products': ok([juiceProduct]),
      'POST /purchasing/rfqs': (init) => {
        saved = JSON.parse(String(init.body))
        return ok(created)
      },
      'POST /purchasing/rfqs/rfq-9/send': (init) => {
        sendKey = headers(init)['Idempotency-Key']
        return ok({ ...created, status: 'sent' })
      },
      'GET /purchasing/rfqs/rfq-9': ok({ ...created, status: 'sent' }),
      'GET /purchasing/rfqs/rfq-9/comparison': ok(comparison),
    })
    const { router } = renderRoutes(routes, '/purchasing/rfqs/new')

    await user.type(await screen.findByLabelText('Title'), 'Juice for Eid')
    await user.click(screen.getByRole('combobox', { name: 'Deliver to store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'juice')
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '96')

    const list = await screen.findByRole('list', { name: 'Suppliers to invite' })
    const millsRow = within(list).getByText('Local Mills').closest('label') as HTMLElement
    expect(within(millsRow).getByText('E-mail')).toBeInTheDocument()
    const freshRow = within(list).getByText('Fresh Foods').closest('label') as HTMLElement
    expect(within(freshRow).getByText('No e-mail')).toBeInTheDocument()

    await user.click(within(list).getByRole('checkbox', { name: 'Invite Local Mills' }))
    await user.click(screen.getByRole('button', { name: 'Save & send' }))
    expect(await screen.findByText('Invite at least 2 suppliers to compare quotes.')).toBeInTheDocument()
    expect(screen.getByText('Set a reply-by date before sending.')).toBeInTheDocument()
    expect(saved).toBeUndefined()
    await user.type(screen.getByLabelText('Reply by'), '2026-11-12')

    await user.click(within(list).getByRole('checkbox', { name: 'Invite Fresh Foods' }))
    await user.click(screen.getByRole('button', { name: 'Save & send' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('1 of 2 invited suppliers are e-mailed the PDF')
    await user.click(within(confirm).getByRole('button', { name: 'Send RFQ' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/rfqs/rfq-9'))
    expect(saved).toEqual({
      title: 'Juice for Eid', store_id: 's-1', needed_by: null, reply_by: '2026-11-12', notes: null, supplier_ids: ['sup-1', 'sup-2'],
      lines: [{ variant_id: 'v-1', quantity: '96' }],
    })
    expect(sendKey).toBeTruthy()
  })

  it('keeps the lines of an RFQ raised from a requisition fixed', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    const draft = rfq({ status: 'draft', sent_at: null, requisition: { id: 'pr-1', number: 'PR-000004' }, suppliers: [], lines: [{ id: 'rl-1', variant: { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true }, quantity: '100.000', requisition_line_id: 'prl-1' }] })
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/rfqs/rfq-1': ok(draft),
      'PUT /purchasing/rfqs/rfq-1': (init) => {
        saved = JSON.parse(String(init.body))
        return ok(draft)
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    expect(await screen.findByRole('heading', { name: 'Edit RFQ-000002' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'PR-000004' })).toHaveAttribute('href', '/purchasing/requisitions/pr-1')
    expect(screen.queryByRole('button', { name: 'Add line' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Quantity of line 1')).toHaveAttribute('readonly')
    await user.click(await screen.findByRole('checkbox', { name: 'Invite Local Mills' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved).not.toHaveProperty('lines')
    expect(saved).toMatchObject({ supplier_ids: ['sup-1'] })
  })
})

describe('RfqPage — quotes, comparison and award', () => {
  function api(extra: Parameters<typeof mockApi>[0] = {}, user = manager()) {
    return mockApi({
      'GET /auth/me': ok(user),
      'GET /purchasing/rfqs/rfq-1': ok(rfq()),
      'GET /purchasing/rfqs/rfq-1/comparison': ok(comparison),
      ...extra,
    })
  }

  it('shows who was e-mailed and downloads the PDF for a supplier to send manually', async () => {
    const user = userEvent.setup()
    const saved = captureDownloads()
    const fetchMock = api()
    const json = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes('/suppliers/sup-2/pdf') ? fileResponse('RFQ-000002-SUP-000002.pdf', 'application/pdf') : json(input, init),
    )
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    const suppliers = await screen.findByRole('list', { name: 'Invited suppliers' })
    const millsItem = within(suppliers).getByRole('listitem', { name: 'Local Mills' })
    expect(within(millsItem).getByText(/E-mailed/)).toBeInTheDocument()
    expect(within(millsItem).getByText('Quoted')).toBeInTheDocument()
    const freshItem = within(suppliers).getByRole('listitem', { name: 'Fresh Foods' })
    expect(within(freshItem).getByText('Not e-mailed — send manually')).toBeInTheDocument()
    expect(within(freshItem).getByText('Awaiting quote')).toBeInTheDocument()
    expect(screen.getByText('1 e-mailed · 1 to send manually (download the PDF).')).toBeInTheDocument()

    await user.click(within(freshItem).getByRole('button', { name: 'Download RFQ PDF for Fresh Foods' }))
    await waitFor(() => expect(saved.map((f) => f.filename)).toEqual(['RFQ-000002-SUP-000002.pdf']))
  })

  it('records a quote per line with lead times and validity', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | undefined
    api({
      'POST /purchasing/rfqs/rfq-1/quotes': (init) => {
        body = JSON.parse(String(init.body))
        key = headers(init)['Idempotency-Key']
        return ok(rfq())
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    await user.click(await screen.findByRole('button', { name: 'Record quote from Fresh Foods' }))
    const dialog = await screen.findByRole('dialog', { name: 'Quote from Fresh Foods' })
    await user.click(within(dialog).getByRole('button', { name: 'Save quote' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a price for at least one line')

    await user.type(within(dialog).getByLabelText('Unit price of Miniket Rice'), '57.5')
    await user.type(within(dialog).getByLabelText('Lead time of Miniket Rice'), '2')
    await user.type(within(dialog).getByLabelText('Valid until'), '2026-11-30')
    expect(within(dialog).getByText(/1 of 2 lines quoted/)).toHaveTextContent('BDT 5,750.00')
    await user.click(within(dialog).getByRole('button', { name: 'Save quote' }))

    await waitFor(() => expect(body).toEqual({
      supplier_id: 'sup-2', status: 'received', valid_until: '2026-11-30', notes: null,
      lines: [{ rfq_line_id: 'rl-1', unit_price: '57.5', quantity_offered: '100', lead_time_days: 2, notes: null }],
    }))
    expect(key).toBeTruthy()
  })

  it('records a declined supplier', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    api({
      'POST /purchasing/rfqs/rfq-1/quotes': (init) => {
        body = JSON.parse(String(init.body))
        return ok(rfq())
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    await user.click(await screen.findByRole('button', { name: 'Mark Fresh Foods as declined' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Mark declined' }))
    await waitFor(() => expect(body).toEqual({ supplier_id: 'sup-2', status: 'declined', valid_until: null, notes: null, lines: [] }))
  })

  it('compares quotes line by line with lowest and fastest highlighted, totals and coverage', async () => {
    api()
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    const matrix = await screen.findByRole('table', { name: 'Quote comparison' })
    const riceRow = within(matrix).getByRole('rowheader', { name: /Miniket Rice/ }).closest('tr') as HTMLElement
    const cells = within(riceRow).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('60.00')
    expect(cells[0]).not.toHaveAttribute('data-lowest')
    expect(cells[1]).toHaveTextContent('57.50')
    expect(within(cells[1] as HTMLElement).getByText('Lowest')).toBeInTheDocument()
    expect(within(cells[1] as HTMLElement).getByText('Fastest')).toBeInTheDocument()
    const juiceRow = within(matrix).getByRole('rowheader', { name: /Mango Juice/ }).closest('tr') as HTMLElement
    expect(within(juiceRow).getByLabelText('Fresh Foods: not quoted')).toBeInTheDocument()

    const totals = within(matrix).getByRole('rowheader', { name: 'Total quoted' }).closest('tr') as HTMLElement
    expect(totals).toHaveTextContent('BDT 6,912.00')
    expect(totals).toHaveTextContent('BDT 5,750.00')
    const coverage = within(matrix).getByRole('rowheader', { name: 'Coverage' }).closest('tr') as HTMLElement
    expect(coverage).toHaveTextContent('2 / 2 lines')
    expect(coverage).toHaveTextContent('1 / 2 lines')
  })

  it('awards each line to the lowest price by default, optionally updating the catalog', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | undefined
    api({
      'POST /purchasing/rfqs/rfq-1/award': (init) => {
        body = JSON.parse(String(init.body))
        key = headers(init)['Idempotency-Key']
        return ok({
          rfq: rfq({ status: 'awarded' }),
          purchase_orders: [
            { id: 'po-31', number: 'PO-000031', status: 'draft', supplier: { id: fresh.id, name: fresh.name }, total: '5750.00', currency: 'BDT', pre_approved: false },
            { id: 'po-32', number: 'PO-000032', status: 'draft', supplier: { id: mills.id, name: mills.name }, total: '912.00', currency: 'BDT', pre_approved: false },
          ],
        })
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    await screen.findByRole('table', { name: 'Quote comparison' })
    await user.click(screen.getByRole('button', { name: 'Award' }))
    const dialog = await screen.findByRole('dialog', { name: 'Award RFQ-000002' })
    expect(within(dialog).getByRole('combobox', { name: 'Supplier for Miniket Rice' })).toHaveTextContent('Fresh Foods')
    expect(within(dialog).getByRole('combobox', { name: 'Supplier for Mango Juice 1L' })).toHaveTextContent('Local Mills')
    expect(within(dialog).getByRole('checkbox', { name: /Update supplier catalog/ })).toBeChecked()
    expect(within(dialog).getByRole('list', { name: 'Orders to create' })).toHaveTextContent('Fresh Foods · 1 line')

    // Split award: switch the rice to Local Mills, then back.
    await user.click(within(dialog).getByRole('combobox', { name: 'Supplier for Miniket Rice' }))
    await user.click(await screen.findByRole('option', { name: /Local Mills/ }))
    expect(within(dialog).getByRole('button', { name: 'Award and create 1 order' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: 'Supplier for Miniket Rice' }))
    await user.click(await screen.findByRole('option', { name: /Fresh Foods/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Update supplier catalog/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Award and create 2 orders' }))

    expect(await within(dialog).findByRole('link', { name: 'PO-000031' })).toHaveAttribute('href', '/purchasing/orders/po-31')
    expect(within(dialog).getByRole('link', { name: 'PO-000032' })).toBeInTheDocument()
    expect(body).toEqual({
      lines: [
        { rfq_line_id: 'rl-1', supplier_id: 'sup-2', quantity: '100' },
        { rfq_line_id: 'rl-2', supplier_id: 'sup-1', quantity: '48' },
      ],
      update_catalog: false,
    })
    expect(key).toBeTruthy()
  })

  it('invites another supplier to a sent RFQ', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | undefined
    const third = { ...supplierRows[0], id: 'sup-3', code: 'SUP-000003', name: 'City Traders', email: 'quotes@city.test' }
    api({
      'GET /suppliers': paged([...supplierRows, third]),
      'POST /purchasing/rfqs/rfq-1/suppliers': (init) => {
        body = JSON.parse(String(init.body))
        key = headers(init)['Idempotency-Key']
        return ok(rfq())
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite more suppliers' })
    // Already invited suppliers are not offered again.
    await within(dialog).findByRole('checkbox', { name: 'Invite City Traders' })
    expect(within(dialog).queryByRole('checkbox', { name: 'Invite Local Mills' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Invite City Traders' }))
    await user.click(within(dialog).getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(body).toEqual({ supplier_ids: ['sup-3'] }))
    expect(key).toBeTruthy()
  })

  it('shows viewers the comparison read-only', async () => {
    api({}, viewer())
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    expect(await screen.findByRole('table', { name: 'Quote comparison' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Award' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record quote/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download RFQ PDF for Local Mills' })).toBeInTheDocument()
  })
})
