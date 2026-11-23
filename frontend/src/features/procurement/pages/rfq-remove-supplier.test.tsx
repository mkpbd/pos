import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { comparison, fresh, manager, rfq, supplierRows } from '@/features/procurement/test-data'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toast.success, error: toast.error, message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

/** The sent RFQ of the fixtures with the Q1 per-invite flag: Local Mills quoted, Fresh Foods has not. */
function sentRfq() {
  const base = rfq()
  return { ...base, suppliers: base.suppliers.map((s) => ({ ...s, can_remove: s.quote === null })) }
}

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
  useSessionStore.setState({ activeBranchId: 'b-1' })
})

describe('Remove a supplier from an RFQ (Q1 §7)', () => {
  it('removes an invited supplier without a quote after confirming', async () => {
    const user = userEvent.setup()
    let deleted = false
    const after = { ...sentRfq(), suppliers: sentRfq().suppliers.filter((s) => s.supplier.id !== fresh.id) }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/rfqs/rfq-1': () => ok(deleted ? after : sentRfq()),
      'GET /purchasing/rfqs/rfq-1/comparison': ok(comparison),
      'DELETE /purchasing/rfqs/rfq-1/suppliers/sup-2': () => {
        deleted = true
        return ok(after)
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    const list = await screen.findByRole('list', { name: 'Invited suppliers' })
    // The supplier who quoted cannot be removed.
    expect(within(list).queryByRole('button', { name: 'Remove Local Mills from the RFQ' })).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Remove Fresh Foods from the RFQ' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove Fresh Foods from RFQ-000002?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove supplier' }))

    await waitFor(() => expect(deleted).toBe(true))
    expect(toast.success).toHaveBeenCalledWith('Fresh Foods removed from RFQ-000002.')
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Invited suppliers' })).queryByText('Fresh Foods')).not.toBeInTheDocument())
  })

  it('shows the server’s refusal in plain words', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /purchasing/rfqs/rfq-1': ok(sentRfq()),
      'GET /purchasing/rfqs/rfq-1/comparison': ok(comparison),
      'DELETE /purchasing/rfqs/rfq-1/suppliers/sup-2': fail(422, 'RFQ_SUPPLIER_QUOTED', 'Fresh Foods has already sent a quote and stays on the RFQ.'),
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    await user.click(await screen.findByRole('button', { name: 'Remove Fresh Foods from the RFQ' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove supplier' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Fresh Foods has already sent a quote and stays on the RFQ.'))
  })

  it('offers no Remove to viewers or where the server does not allow it', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['branches.view', 'purchases.view', 'suppliers.view'] })),
      'GET /purchasing/rfqs/rfq-1': ok(rfq()),
      'GET /purchasing/rfqs/rfq-1/comparison': ok(comparison),
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    await screen.findByRole('list', { name: 'Invited suppliers' })
    expect(screen.queryByRole('button', { name: /^Remove .* from the RFQ$/ })).not.toBeInTheDocument()
  })

  it('removes a saved supplier from a draft at once in the editor', async () => {
    const user = userEvent.setup()
    let deleted = false
    const draft = rfq({ status: 'draft', sent_at: null, suppliers: rfq().suppliers.map((s) => ({ ...s, quote: null, emailed_at: null, can_remove: true })) })
    const after = { ...draft, suppliers: draft.suppliers.filter((s) => s.supplier.id !== fresh.id) }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /suppliers': paged(supplierRows),
      'GET /purchasing/rfqs/rfq-1': () => ok(deleted ? after : draft),
      'DELETE /purchasing/rfqs/rfq-1/suppliers/sup-2': () => {
        deleted = true
        return ok(after)
      },
    })
    renderRoutes(routes, '/purchasing/rfqs/rfq-1')

    const saved = await screen.findByRole('list', { name: 'Suppliers on this RFQ' })
    expect(screen.getByRole('checkbox', { name: 'Invite Fresh Foods' })).toBeChecked()
    await user.click(within(saved).getByRole('button', { name: 'Remove Fresh Foods from the RFQ' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Remove Fresh Foods from RFQ-000002?' })).getByRole('button', { name: 'Remove supplier' }))

    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Invite Fresh Foods' })).not.toBeChecked())
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Suppliers on this RFQ' })).queryByText('Fresh Foods')).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Fresh Foods removed from RFQ-000002.')
  })
})
