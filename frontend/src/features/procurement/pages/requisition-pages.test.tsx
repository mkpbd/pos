import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { fresh, manager, mills, owner, requester, requisition, requisitionLine, staff, supplierRows } from '@/features/procurement/test-data'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const riceProduct = {
  id: 'p-2', name: 'Miniket Rice', type: 'standard', track_stock: true, track_batches: false, is_active: true,
  unit: { id: 'un-2', name: 'Kilogram', code: 'kg', allow_decimal: true }, tax_rate: null,
  variants: [{ id: 'v-2', name: null, sku: 'RICE-KG', option_values: {}, is_active: true }],
}

const headers = (init: RequestInit) => init.headers as Record<string, string>

beforeEach(() => {
  toastSuccess.mockReset()
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

describe('RequisitionsPage', () => {
  it('shows a requester their requisitions, the Requisitions nav entry and only the tabs they may use', async () => {
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(requester()),
      'GET /purchasing/requisitions': (_init, url) => {
        queries.push(url.searchParams)
        return paged([requisition()])
      },
    })
    renderRoutes(routes, '/purchasing/requisitions')

    const row = (await screen.findByRole('link', { name: 'PR-000004' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Awaiting approval')).toBeInTheDocument()
    expect(within(row).getByText('Manager approval')).toBeInTheDocument()
    expect(within(row).getByText('BDT 25,000.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New requisition' })).toHaveAttribute('href', '/purchasing/requisitions/new')
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('data-export-list', 'purchaseRequisitions')

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Requisitions' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Purchasing' })).not.toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Purchasing sections' })
    expect(within(sections).getAllByRole('link').map((l) => l.textContent)).toEqual(['Requisitions'])

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Approved' }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('approved'))
  })

  it('shows purchasing staff the Purchasing entry, not a second Requisitions entry', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/requisitions': paged([]) })
    renderRoutes(routes, '/purchasing/requisitions')

    expect(await screen.findByText('No requisitions yet')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Purchasing' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Requisitions' })).not.toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Purchasing sections' })
    expect(within(sections).getByRole('link', { name: 'Approvals' })).toBeInTheDocument()
    expect(within(sections).getByRole('link', { name: 'RFQs' })).toBeInTheDocument()
    expect(within(sections).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })
})

describe('RequisitionPage — editor', () => {
  it('raises a requisition and submits it with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    let saved: Record<string, unknown> | undefined
    let submitKey: string | undefined
    let estimateQuery: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(requester()),
      'GET /branches': paged(branchesWithStores()),
      'GET /products': ok([riceProduct]),
      'GET /purchasing/requisitions/estimates': (_init, url) => {
        estimateQuery = url.searchParams
        return ok([{ variant_id: 'v-2', estimated_unit_cost: '61.2500', source: 'last_cost', tax_rate: '0.0000', preferred_supplier: null }])
      },
      'POST /purchasing/requisitions': (init) => {
        saved = JSON.parse(String(init.body))
        return ok(requisition({ id: 'pr-9', number: 'PR-000009', status: 'draft' }))
      },
      'POST /purchasing/requisitions/pr-9/submit': (init) => {
        submitKey = headers(init)['Idempotency-Key']
        return ok(requisition({ id: 'pr-9', number: 'PR-000009', status: 'submitted' }))
      },
      'GET /purchasing/requisitions/pr-9': ok(requisition({ id: 'pr-9', number: 'PR-000009' })),
    })
    const { router } = renderRoutes(routes, '/purchasing/requisitions/new')

    expect(await screen.findByRole('heading', { name: 'New purchase requisition' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save & submit' }))
    expect(await screen.findByText('Choose the store that needs the goods.')).toBeInTheDocument()
    expect(saved).toBeUndefined()

    await user.click(screen.getByRole('combobox', { name: 'For store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(screen.getByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'rice')
    await user.click(await screen.findByRole('option', { name: /Miniket Rice/ }))
    await user.type(screen.getByLabelText('Quantity of line 1'), '25.5')
    // Requesters get the server's cost estimate too; purchasing picks the supplier.
    await waitFor(() => expect(screen.getByLabelText('Estimated unit cost of line 1')).toHaveValue('61.25'))
    expect(estimateQuery?.getAll('variant_ids[]')).toEqual(['v-2'])
    expect(screen.getByText('Last purchase cost')).toBeInTheDocument()
    expect(screen.getByText('Supplier chosen by purchasing')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Notes'), 'Weekend promotion')
    await user.click(screen.getByRole('button', { name: 'Save & submit' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/purchasing/requisitions/pr-9'))
    expect(saved).toEqual({
      store_id: 's-1', needed_by: null, notes: 'Weekend promotion',
      lines: [{ variant_id: 'v-2', quantity: '25.5', estimated_unit_cost: '61.25', suggested_supplier_id: null, notes: null }],
    })
    expect(submitKey).toMatch(/[0-9a-f-]{36}/)
    expect(toastSuccess).toHaveBeenCalledWith('PR-000009 submitted for approval.')
  })

  it('prefills the preferred catalog cost and supplier', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /suppliers': paged(supplierRows),
      'GET /products': ok([{ ...riceProduct, variants: [{ ...riceProduct.variants[0], purchase_price: '70.0000' }] }]),
      'GET /purchasing/requisitions/estimates': ok([
        { variant_id: 'v-2', estimated_unit_cost: '58.5000', source: 'preferred_catalog', tax_rate: '0.0000', preferred_supplier: { id: fresh.id, code: fresh.code, name: fresh.name } },
      ]),
    })
    renderRoutes(routes, '/purchasing/requisitions/new')

    await user.click(await screen.findByRole('combobox', { name: 'Product of line 1' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'rice')
    await user.click(await screen.findByRole('option', { name: /Miniket Rice/ }))

    await waitFor(() => expect(screen.getByLabelText('Estimated unit cost of line 1')).toHaveValue('58.5'))
    expect(screen.getByText('Preferred supplier Fresh Foods')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Suggested supplier of line 1' })).toHaveTextContent('Fresh Foods')
    await user.type(screen.getByLabelText('Quantity of line 1'), '10')
    expect(screen.getByTestId('requisition-estimate')).toHaveTextContent('BDT 585.00')
  })
})

describe('RequisitionPage — approval', () => {
  it('does not offer approval to the requester and explains why', async () => {
    mockApi({ 'GET /auth/me': ok(requester()), 'GET /purchasing/requisitions/pr-1': ok(requisition()) })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    expect(await screen.findByRole('heading', { name: 'PR-000004' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.getByText('You raised this requisition, so someone else has to approve it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel requisition' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Requisition history' })).getByText('Submitted for approval')).toBeInTheDocument()
  })

  it('hides approval from a manager who raised the requisition (no self-approval)', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/requisitions/pr-1': ok(requisition({ requested_by: { id: 'u-8', name: 'Babul Manager' } })) })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    expect(await screen.findByRole('heading', { name: 'PR-000004' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('lets a manager approve a manager-level requisition with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    let key: string | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/requisitions/pr-1': ok(requisition()),
      'POST /purchasing/requisitions/pr-1/approve': (init) => {
        key = headers(init)['Idempotency-Key']
        return ok(requisition({ status: 'approved', approved_by: { id: 'u-8', name: 'Babul Manager' }, approved_at: '2026-11-06T07:00:00Z' }))
      },
    })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('PR-000004 approved.'))
    expect(key).toBeTruthy()
  })

  it('reserves high-value requisitions for high-value approvers', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/requisitions/pr-1': ok(requisition({ approval_level: 'high', estimated_total: '250000.00' })) })
    const first = renderRoutes(routes, '/purchasing/requisitions/pr-1')
    expect(await screen.findByText('Waiting for high-value approval')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    first.unmount()

    mockApi({ 'GET /auth/me': ok(owner()), 'GET /purchasing/requisitions/pr-1': ok(requisition({ approval_level: 'high', estimated_total: '250000.00' })) })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('requires a reason to reject', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/requisitions/pr-1': ok(requisition()),
      'POST /purchasing/requisitions/pr-1/reject': (init) => {
        body = JSON.parse(String(init.body))
        return ok(requisition({ status: 'rejected', rejection_reason: 'Stock arrives from the warehouse.' }))
      },
    })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reject requisition' }))
    expect(within(dialog).getByText('Give a reason.')).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.type(within(dialog).getByLabelText('Reason'), 'Stock arrives from the warehouse.')
    await user.click(within(dialog).getByRole('button', { name: 'Reject requisition' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Stock arrives from the warehouse.' }))
  })

  it('shows a server refusal inside the reject dialog', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/requisitions/pr-1': ok(requisition()),
      'POST /purchasing/requisitions/pr-1/reject': fail(422, 'SELF_APPROVAL_NOT_ALLOWED', 'You cannot approve or reject your own requisition.'),
    })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'No')
    await user.click(within(dialog).getByRole('button', { name: 'Reject requisition' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You cannot approve or reject your own requisition.')
  })
})

describe('RequisitionPage — convert', () => {
  it('converts lines to a purchase order per supplier and an RFQ', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | undefined
    const approved = requisition({ status: 'approved', approved_by: { id: 'u-8', name: 'Babul Manager' }, approved_at: '2026-11-06T07:00:00Z', requested_by: staff })
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/requisitions/pr-1': ok(approved),
      'POST /purchasing/requisitions/pr-1/convert': (init) => {
        body = JSON.parse(String(init.body))
        key = headers(init)['Idempotency-Key']
        return ok({
          purchase_orders: [{ id: 'po-21', number: 'PO-000021', status: 'draft', supplier: { id: mills.id, name: mills.name }, total: '5400.00', currency: 'BDT', pre_approved: true }],
          rfq: { id: 'rfq-5', number: 'RFQ-000005', status: 'draft' },
        })
      },
    })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    await user.click(await screen.findByRole('button', { name: 'Convert' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: 'Convert Miniket Rice to' })).toHaveTextContent('Purchase order')
    expect(within(dialog).getByRole('combobox', { name: 'Supplier of Miniket Rice' })).toHaveTextContent('Local Mills')
    // Without a suggested supplier the juice goes out for quotes.
    expect(within(dialog).getByRole('combobox', { name: 'Convert Mango Juice 1L to' })).toHaveTextContent('Request quotes')
    const qty = within(dialog).getByLabelText('Quantity to convert of Miniket Rice')
    await user.clear(qty)
    await user.type(qty, '120')
    expect(within(dialog).getByText('Miniket Rice: at most 100.')).toBeInTheDocument()
    await user.clear(qty)
    await user.type(qty, '90')
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    expect(await within(dialog).findByRole('link', { name: 'PO-000021' })).toHaveAttribute('href', '/purchasing/orders/po-21')
    expect(within(dialog).getByText('Pre-approved')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'RFQ-000005' })).toHaveAttribute('href', '/purchasing/rfqs/rfq-5')
    expect(body).toEqual({
      purchase_orders: { lines: [{ requisition_line_id: 'prl-1', quantity: '90', supplier_id: 'sup-1' }] },
      rfq: { lines: [{ requisition_line_id: 'prl-2', quantity: '48' }], title: 'Quotes for PR-000004', reply_by: null },
    })
    expect(key).toBeTruthy()
  })

  it('offers only the remaining quantity of partly converted lines', async () => {
    const user = userEvent.setup()
    const partly = requisition({ status: 'approved', lines: [requisitionLine({ converted_quantity: '60.000' }), requisitionLine({ id: 'prl-2', converted_quantity: '100.000' })] })
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /suppliers': paged(supplierRows), 'GET /purchasing/requisitions/pr-1': ok(partly) })
    renderRoutes(routes, '/purchasing/requisitions/pr-1')

    await user.click(await screen.findByRole('button', { name: 'Convert' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByRole('row')).toHaveLength(2)
    expect(within(dialog).getByLabelText('Quantity to convert of Miniket Rice')).toHaveValue('40')
    // A partly converted requisition can no longer be cancelled.
    expect(screen.queryByRole('button', { name: 'Cancel requisition' })).not.toBeInTheDocument()
  })
})
