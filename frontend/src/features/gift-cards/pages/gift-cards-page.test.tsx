import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import { formatGiftCode } from '@/features/gift-cards/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), message: vi.fn(), success: toastSuccess }) }
})

const card = (overrides: Record<string, unknown> = {}) => ({
  id: 'gc-1', code_last4: 'K7QP', kind: 'gift_card', initial_value: '1000.00', balance: '650.00', currency: 'BDT', status: 'active',
  expires_at: '2027-11-25T00:00:00Z', expired: false, customer: { id: 'c-1', name: 'Rina Akter' }, issued_by: { id: 'u-4', name: 'Pos Cashier' },
  issued_at: '2026-11-25T06:00:00Z', ...overrides,
})
const voucher = card({ id: 'gc-2', code_last4: 'ZX9M', kind: 'voucher', initial_value: '200.00', balance: '200.00', customer: null, expires_at: null })
const list = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const manager = (): CurrentUser => makeCurrentUser({ permissions: ['branches.view', 'customers.view', 'gift_cards.view', 'gift_cards.manage'] })
const viewer = (): CurrentUser => makeCurrentUser({ permissions: ['branches.view', 'gift_cards.view'] })

describe('Gift cards page', () => {
  beforeEach(() => toastSuccess.mockClear())

  it('is in the menu with gift_cards.view and lists cards with filters', async () => {
    const user = userEvent.setup()
    const queries: Record<string, string>[] = []
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /gift-cards': (_init, url) => {
        queries.push(Object.fromEntries(url.searchParams))
        return list([card(), voucher])
      },
    })
    renderRoutes(routes, '/gift-cards')

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Gift cards' })).toHaveAttribute('href', '/gift-cards')
    const table = await screen.findByRole('table', { name: 'Gift cards' })
    expect(within(table).getByRole('row', { name: /••••K7QP/ })).toHaveTextContent('BDT 650.00')
    expect(within(table).getByRole('row', { name: /••••ZX9M/ })).toHaveTextContent('Voucher')
    // Read-only: no issuing or voiding.
    expect(screen.queryByRole('button', { name: 'Issue voucher' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /Void/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Filter by kind' }))
    await user.click(await screen.findByRole('option', { name: 'Credit note' }))
    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Void' }))
    await user.type(screen.getByRole('textbox', { name: 'Search gift cards' }), 'K7QP')
    await waitFor(() => expect(queries.at(-1)).toEqual({ page: '1', kind: 'credit_note', status: 'void', search: 'K7QP' }))
  })

  it('is not in the menu without gift_cards.view', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['branches.view', 'customers.view'] })), 'GET /customers': list([]), 'GET /customer-groups': ok([]), 'GET /loyalty/settings': ok({ is_enabled: false }) })
    renderRoutes(routes, '/customers')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByRole('link', { name: 'Gift cards' })).not.toBeInTheDocument()
  })

  it('shows a card with its entries', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /gift-cards': list([card()]),
      'GET /gift-cards/gc-1': ok({
        ...card(), sale_receipt_number: 'GCS-000001',
        entries: [
          { id: 'e-1', type: 'issue', amount: '1000.00', balance_after: '1000.00', reference_number: 'GCS-000001', created_by: { id: 'u-4', name: 'Pos Cashier' }, created_at: '2026-11-25T06:00:00Z' },
          { id: 'e-2', type: 'redeem', amount: '-350.00', balance_after: '650.00', reference_number: 'INV-MAIN-000050', created_by: { id: 'u-4', name: 'Pos Cashier' }, created_at: '2026-11-26T06:00:00Z' },
        ],
      }),
    })
    renderRoutes(routes, '/gift-cards')

    await user.click(await screen.findByRole('button', { name: 'View ••••K7QP' }))
    const sheet = await screen.findByRole('dialog', { name: 'Gift card ••••K7QP' })
    expect(await within(sheet).findByTestId('gift-card-balance')).toHaveTextContent('BDT 650.00')
    expect(within(sheet).getByText('GCS-000001', { selector: 'dd' })).toBeInTheDocument()
    const entries = within(sheet).getByRole('table', { name: 'Gift card entries' })
    expect(within(entries).getByRole('row', { name: /Spent on a sale/ })).toHaveTextContent('INV-MAIN-000050')
    expect(within(entries).getByRole('row', { name: /Spent on a sale/ })).toHaveTextContent('-350.00')
    expect(within(sheet).queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })

  it('issues a voucher and shows its code once, with copy', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    let posted: unknown
    let key: string | null = null
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /gift-cards': list([]),
      'GET /customers': list([{ id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: null, email: null, is_active: true }]),
      'POST /gift-cards/vouchers': (init) => {
        posted = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return { status: 201, body: { success: true, data: { gift_card: { id: 'gc-9', code: 'ABCD2345EFGH6789', code_last4: '6789', kind: 'voucher', balance: '250.00', currency: 'BDT', expires_at: null, customer: { id: 'c-1', name: 'Rina Akter' } }, receipt_number: null }, meta: {} } }
      },
    })
    renderRoutes(routes, '/gift-cards')

    await user.click(await screen.findByRole('button', { name: 'Issue voucher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Issue voucher' })
    await user.type(within(dialog).getByLabelText('Amount (BDT)'), '5')
    await user.click(within(dialog).getByRole('button', { name: 'Issue voucher' }))
    expect(await within(dialog).findByText('Between BDT 10.00 and BDT 1,000,000.00.')).toBeInTheDocument()
    expect(within(dialog).getByText('Say why the voucher is given.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Amount (BDT)'))
    await user.type(within(dialog).getByLabelText('Amount (BDT)'), '250')
    await user.type(within(dialog).getByLabelText('Reason'), 'Late delivery')
    await user.click(within(dialog).getByRole('checkbox', { name: 'No expiry' }))
    await user.click(within(dialog).getByRole('button', { name: 'Find an existing customer' }))
    await user.click(await screen.findByRole('option', { name: /Rina Akter/ }))
    expect(within(dialog).getByTestId('voucher-customer')).toHaveTextContent('Rina Akter')
    await user.click(within(dialog).getByRole('button', { name: 'Issue voucher' }))

    const shown = await screen.findByRole('dialog', { name: 'Voucher issued' })
    expect(within(shown).getByTestId('gift-code')).toHaveTextContent('ABCD-2345-EFGH-6789')
    expect(within(shown).getByText('Copy or print the code now — it won’t be shown again.')).toBeInTheDocument()
    expect(within(shown).getByText('Does not expire')).toBeInTheDocument()
    expect(posted).toEqual({ amount: '250', reason: 'Late delivery', customer_id: 'c-1', expires_at: null, never_expires: true })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)

    await user.click(within(shown).getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('ABCD-2345-EFGH-6789')
    // Escape does not lose the code by accident; only "Done" closes it.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Voucher issued' })).toBeInTheDocument()
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Voucher issued' })).not.toBeInTheDocument())
    expect(screen.queryByText('ABCD-2345-EFGH-6789')).not.toBeInTheDocument()
  })

  it('sends a default expiry a year ahead', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /gift-cards': list([]),
      'POST /gift-cards/vouchers': (init) => {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>
        return { status: 201, body: { success: true, data: { gift_card: { id: 'gc-9', code: 'ABCD2345EFGH6789', code_last4: '6789', kind: 'voucher', balance: '50.00', currency: 'BDT', expires_at: '2027-11-25', customer: null }, receipt_number: null }, meta: {} } }
      },
    })
    renderRoutes(routes, '/gift-cards')
    await user.click(await screen.findByRole('button', { name: 'Issue voucher' }))
    const dialog = await screen.findByRole('dialog', { name: 'Issue voucher' })
    await user.type(within(dialog).getByLabelText('Amount (BDT)'), '50')
    await user.type(within(dialog).getByLabelText('Reason'), 'Birthday')
    await user.click(within(dialog).getByRole('button', { name: 'Issue voucher' }))

    await screen.findByRole('dialog', { name: 'Voucher issued' })
    const year = new Date().getFullYear() + 1
    expect(posted?.expires_at).toMatch(new RegExp(`^${year}-\\d{2}-\\d{2}$`))
    expect(posted).not.toHaveProperty('customer_id')
  })

  it('voids a card after a reason and a confirmation', async () => {
    const user = userEvent.setup()
    let posted: unknown
    let current = card()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /gift-cards': () => list([current]),
      'POST /gift-cards/gc-1/void': (init) => {
        posted = JSON.parse(String(init.body))
        current = card({ status: 'void', balance: '0.00' })
        return ok(current)
      },
    })
    renderRoutes(routes, '/gift-cards')

    await user.click(await screen.findByRole('button', { name: 'Void ••••K7QP' }))
    const dialog = await screen.findByRole('dialog', { name: 'Void gift card ••••K7QP?' })
    expect(dialog).toHaveTextContent('The remaining balance of BDT 650.00 is written off')
    await user.type(within(dialog).getByLabelText('Reason'), 'Reported lost')
    await user.click(within(dialog).getByRole('button', { name: 'Void' }))
    expect(posted).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Void now' }))

    await waitFor(() => expect(posted).toEqual({ reason: 'Reported lost' }))
    expect(toastSuccess).toHaveBeenCalledWith('Gift card ••••K7QP voided.')
    const row = await screen.findByRole('row', { name: /••••K7QP/ })
    await waitFor(() => expect(within(row).getByText('Void')).toBeInTheDocument())
    expect(within(row).queryByRole('button', { name: 'Void ••••K7QP' })).not.toBeInTheDocument()
  })
})

describe('formatGiftCode', () => {
  it('groups codes in fours, uppercase, without spaces or dashes', () => {
    expect(formatGiftCode('abcd 2345-efgh6789')).toBe('ABCD-2345-EFGH-6789')
    expect(formatGiftCode('CARD123456')).toBe('CARD-1234-56')
  })
})
