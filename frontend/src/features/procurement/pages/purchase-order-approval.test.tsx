import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { manager, managerRef, owner, purchaseOrder, staff, supplierRows } from '@/features/procurement/test-data'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const headers = (init: RequestInit) => init.headers as Record<string, string>

beforeEach(() => {
  toastSuccess.mockReset()
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

describe('Purchase order approval', () => {
  it('shows the pending-approval badge in the list', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/orders': paged([purchaseOrder()]) })
    renderRoutes(routes, '/purchasing/orders')

    const row = (await screen.findByRole('link', { name: 'PO-000007' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Pending approval')).toBeInTheDocument()
  })

  it('lets a high-value approver approve with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    let key: string | undefined
    mockApi({
      'GET /auth/me': ok(owner()),
      'GET /purchasing/orders/po-7': ok(purchaseOrder()),
      'POST /purchasing/orders/po-7/approve': (init) => {
        key = headers(init)['Idempotency-Key']
        return ok(purchaseOrder({ status: 'ordered' }))
      },
    })
    renderRoutes(routes, '/purchasing/orders/po-7')

    expect(await screen.findByText('Pending approval')).toBeInTheDocument()
    expect(screen.getByText('High-value approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('PO-000007 approved and ordered.'))
    expect(key).toBeTruthy()
  })

  it('hides approval from the submitter and from managers below the level', async () => {
    // The manager submitted this high-value order himself.
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/orders/po-7': ok(purchaseOrder()) })
    const first = renderRoutes(routes, '/purchasing/orders/po-7')
    expect(await screen.findByText(/Waiting for approval \(submitted by Babul Manager\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    first.unmount()

    // Someone else's manager-level order: the manager may approve it.
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/orders/po-7': ok(purchaseOrder({ approval_level: 'manager', submitted_by: staff, created_by: staff })) })
    renderRoutes(routes, '/purchasing/orders/po-7')
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('rejects back to draft with a reason', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(owner()),
      'GET /purchasing/orders/po-7': ok(purchaseOrder()),
      'POST /purchasing/orders/po-7/reject': (init) => {
        body = JSON.parse(String(init.body))
        return ok(purchaseOrder({ status: 'draft', rejection_reason: 'Ask for a better price.' }))
      },
    })
    renderRoutes(routes, '/purchasing/orders/po-7')

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject PO-000007' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Ask for a better price.')
    await user.click(within(dialog).getByRole('button', { name: 'Reject order' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Ask for a better price.' }))
    expect(toastSuccess).toHaveBeenCalledWith('PO-000007 sent back to draft.')
  })

  it('links a converted order to its requisition and RFQ and shows a rejection on the draft', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['purchases.view', 'purchases.manage', 'suppliers.view', 'branches.view'] })),
      'GET /branches': paged(branchesWithStores()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/supplier-products/lookup': ok([]),
      'GET /purchasing/orders/po-7': ok(purchaseOrder({
        status: 'draft', pre_approved: true, requisition: { id: 'pr-1', number: 'PR-000004' }, rfq: { id: 'rfq-1', number: 'RFQ-000002' },
        rejection_reason: 'Split the delivery.', rejected_by: managerRef,
      })),
    })
    renderRoutes(routes, '/purchasing/orders/po-7')

    expect(await screen.findByRole('heading', { name: 'Edit PO-000007' })).toBeInTheDocument()
    expect(screen.getByText('Pre-approved')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'PR-000004' })).toHaveAttribute('href', '/purchasing/requisitions/pr-1')
    expect(screen.getByRole('link', { name: 'RFQ-000002' })).toHaveAttribute('href', '/purchasing/rfqs/rfq-1')
    expect(screen.getByText('Split the delivery.')).toBeInTheDocument()
  })

  it('submits a draft from the editor; above the limit it waits for approval', async () => {
    const user = userEvent.setup()
    let submitKey: string | undefined
    const draft = purchaseOrder({ status: 'draft', approval_level: null, submitted_by: null })
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/supplier-products/lookup': ok([]),
      'GET /purchasing/orders/po-7': ok(draft),
      'PUT /purchasing/orders/po-7': ok(draft),
      'POST /purchasing/orders/po-7/submit': (init) => {
        submitKey = headers(init)['Idempotency-Key']
        return ok(purchaseOrder())
      },
    })
    renderRoutes(routes, '/purchasing/orders/po-7')

    await user.click(await screen.findByRole('button', { name: 'Save & submit' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('PO-000007 submitted for approval.'))
    expect(submitKey).toBeTruthy()
  })
})
