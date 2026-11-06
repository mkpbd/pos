import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { manager, managerRef, owner, purchaseOrder, requester, requisition, staff } from '@/features/procurement/test-data'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

type Row = Record<string, unknown> & { kind: string }

/** GET /purchasing/approvals: typed rows (kind), filtered by kind, with per-kind counts. */
const reqRow = (overrides: Record<string, unknown> = {}): Row => {
  const r = requisition(overrides)
  return { kind: 'requisition', id: r.id, number: r.number, status: r.status, amount: r.estimated_total, currency: 'BDT', approval_level: r.approval_level, requested_by: r.requested_by, submitted_at: r.submitted_at, branch: { id: 'b-1', name: 'Main Branch' }, store: r.store, supplier: null, line_count: 2 }
}
const poRow = (overrides: Record<string, unknown> = {}): Row => {
  const o = purchaseOrder(overrides)
  return { kind: 'purchase_order', id: o.id, number: o.number, status: o.status, amount: o.total, currency: 'BDT', approval_level: o.approval_level, requested_by: o.submitted_by, submitted_at: o.submitted_at, branch: { id: 'b-1', name: 'Main Branch' }, store: o.store, supplier: o.supplier, line_count: 1 }
}
const inboxReply = (rows: Row[]) => (_init: RequestInit, url: URL) => {
  const kind = url.searchParams.get('kind')
  const items = rows.filter((r) => !kind || r.kind === kind)
  return ok(items, {
    pagination: { current_page: 1, per_page: 50, total: items.length, last_page: 1 },
    counts: { requisition: rows.filter((r) => r.kind === 'requisition').length, purchase_order: rows.filter((r) => r.kind === 'purchase_order').length },
  })
}
const inbox = () => [reqRow(), poRow({ approval_level: 'manager', total: '42000.00', submitted_by: staff })]

describe('ApprovalsPage', () => {
  it('lists requisitions and purchase orders waiting for me, with amount and level', async () => {
    const kinds: (string | null)[] = []
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/approvals': (init, url) => {
        kinds.push(url.searchParams.get('kind'))
        return inboxReply(inbox())(init, url)
      },
    })
    renderRoutes(routes, '/purchasing/approvals')

    const table = await screen.findByRole('table', { name: 'Waiting for approval' })
    const reqRow = within(table).getByRole('link', { name: 'PR-000004' }).closest('tr') as HTMLElement
    expect(within(reqRow).getByText('Requisition')).toBeInTheDocument()
    expect(within(reqRow).getByText('Manager approval')).toBeInTheDocument()
    expect(within(reqRow).getByText('BDT 25,000.00')).toBeInTheDocument()
    expect(within(reqRow).getByText('Shila Staff')).toBeInTheDocument()
    const poRowEl = within(table).getByRole('link', { name: 'PO-000007' }).closest('tr') as HTMLElement
    expect(within(poRowEl).getByText('Purchase order')).toBeInTheDocument()
    expect(within(poRowEl).getByText('Local Mills')).toBeInTheDocument()
    expect(screen.getByTestId('count-all')).toHaveTextContent('2')
    expect(screen.getByTestId('count-requisition')).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('data-export-list', 'approvals')

    await userEvent.setup().click(screen.getByRole('tab', { name: /Purchase orders/ }))
    await waitFor(() => expect(kinds.at(-1)).toBe('purchase_order'))
    await waitFor(() => expect(within(screen.getByRole('table')).queryByRole('link', { name: 'PR-000004' })).not.toBeInTheDocument())
  })

  it('approves a purchase order inline with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    let key: string | undefined
    let approvals = inbox()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/approvals': (init, url) => inboxReply(approvals)(init, url),
      'POST /purchasing/orders/po-7/approve': (init) => {
        key = (init.headers as Record<string, string>)['Idempotency-Key']
        approvals = approvals.filter((r) => r.kind !== 'purchase_order')
        return ok(purchaseOrder({ status: 'ordered' }))
      },
    })
    renderRoutes(routes, '/purchasing/approvals')

    await user.click(await screen.findByRole('button', { name: 'Approve PO-000007' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('PO-000007 approved.'))
    expect(key).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'PO-000007' })).not.toBeInTheDocument())
  })

  it('rejects a requisition inline with a reason', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/approvals': inboxReply(inbox()),
      'POST /purchasing/requisitions/pr-1/reject': (init) => {
        body = JSON.parse(String(init.body))
        return ok(requisition({ status: 'rejected' }))
      },
    })
    renderRoutes(routes, '/purchasing/approvals')

    await user.click(await screen.findByRole('button', { name: 'Reject PR-000004' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject PR-000004' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Over budget this month')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Over budget this month' }))
    expect(toastSuccess).toHaveBeenCalledWith('PR-000004 rejected.')
  })

  it('never lists my own documents, and keeps high-value ones for high approvers', async () => {
    // The API leaves out own documents; the page also hides any it gets.
    const mine = [reqRow({ requested_by: managerRef }), poRow()]
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/approvals': inboxReply(mine) })
    const first = renderRoutes(routes, '/purchasing/approvals')
    expect(await screen.findByText('Nothing waiting for you')).toBeInTheDocument()
    first.unmount()

    // The owner may approve the manager's high-value order.
    mockApi({ 'GET /auth/me': ok(owner()), 'GET /purchasing/approvals': inboxReply(mine) })
    renderRoutes(routes, '/purchasing/approvals')
    expect(await screen.findByRole('button', { name: 'Approve PO-000007' })).toBeInTheDocument()
    expect(screen.getByText('High-value approval')).toBeInTheDocument()
  })

  it('is not available to requesters', async () => {
    mockApi({ 'GET /auth/me': ok(requester()) })
    renderRoutes(routes, '/purchasing/approvals')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})
