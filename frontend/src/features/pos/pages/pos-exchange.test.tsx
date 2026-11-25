import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import { useCartStore } from '@/features/pos/cart-store'
import type { ExchangeDraft } from '@/features/pos/exchange'
import { AUTO_LOCK_MS, useTillLockStore } from '@/features/pos/till-lock'
import { branchesWithStores, loyaltyOff, openSessionReport, posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/**
 * POS1c exchanges at the till (mocked API): find the invoice, what can still come back, its value,
 * exchange mode, paying more / refunding the difference / an even exchange, the manager's PIN
 * approval of the return, the retry key and the refusals.
 */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })
const created = (data: unknown) => ({ status: 201, body: { success: true, data, meta: {} } })
const money = (n: number) => n.toFixed(2)

const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false,
}
const rahim = { id: 'c-1', code: 'C-0001', name: 'Rahim Uddin', phone: '01711000000' }

function priceCart(body: { customer_id: string | null; lines: { quantity: string }[] }) {
  const total = body.lines.reduce((s, l) => s + 25 * Number(l.quantity), 0)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
    customer: body.customer_id ? { ...rahim, group_discount_percent: '0.00', credit: { outstanding: '0.00', credit_limit: '0.00', available: '0.00' } } : null,
    currency: 'BDT', tax_mode: 'exclusive',
    lines: body.lines.map((l, i) => ({
      position: i, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_stock: true, track_serials: false,
      max_discount_percent: null, quantity: l.quantity, unit_price: '25.00', tax_rate: '0.0000', discount: null, available: '12.000',
      line_subtotal: money(25 * Number(l.quantity)), discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: money(25 * Number(l.quantity)),
      tax_amount: '0.00', line_total: money(25 * Number(l.quantity)), list_price: '25.00', price_source: 'catalog', price_approved_by: null, open_price: false, promotion: null,
    })),
    invoice_discount: null, subtotal: money(total), item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00',
    net_total: money(total), tax_total: '0.00', total: money(total), promotions: [], coupon: null, savings_total: '0.00', discount_approved_by: null,
  }
}

const saleLine = (id: string, name: string, quantity: string, lineTotal: string, extra: Record<string, unknown> = {}) => ({
  id, variant_id: `v-${id}`, product_name: name, variant_name: null, sku: name.toUpperCase().replace(/\s/g, '-'), unit_code: 'pcs', quantity, unit_price: '25.00', discount: null,
  line_subtotal: lineTotal, discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: lineTotal, tax_rate: '0.0000', tax_amount: '0.00', line_total: lineTotal,
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000', ...extra,
})

/** The earlier invoice: 3 juices (1 already back) and a phone with a serial. */
const invoice = (patch: Record<string, unknown> = {}) => ({
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-12-01T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: rahim, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '575.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '575.00',
  paid_total: '575.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, payments: [], returns: [],
  lines: [
    saleLine('sl-1', 'Mango Juice', '3.000', '75.00', { returned_quantity: '1.000' }),
    saleLine('sl-2', 'Phone', '1.000', '500.00', { serials: ['SN-1'] }),
  ],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
  ...patch,
})

/** Values a return like the server: juice 25 a unit, the phone 500; refundable cash, a credit note, card up to 20. */
function preview(body: { lines: { sale_line_id: string; quantity: string; restock: boolean; serials?: string[] }[] }) {
  const lines = body.lines.map((l) => ({
    sale_line_id: l.sale_line_id, product_name: l.sale_line_id === 'sl-1' ? 'Mango Juice' : 'Phone', quantity: l.quantity, restock: l.restock, serials: l.serials ?? [],
    net_amount: '0.00', tax_amount: '0.00', line_total: money(l.sale_line_id === 'sl-1' ? 25 * Number(l.quantity) : 500),
  }))
  const total = money(lines.reduce((s, l) => s + Number(l.line_total), 0))
  return {
    lines, subtotal: total, tax_total: '0.00', total, completes_immediately: false,
    settlement: { credit: '0.00', refund_due: total, refundable: [{ method: 'cash', label: 'Cash', max: null }, { method: 'gift_card', label: 'Gift card', max: null }, { method: 'card', label: 'Card', max: '20.00' }] },
  }
}

const newSale = (patch: Record<string, unknown> = {}) => ({
  ...invoice(), id: 'sa-9', number: 'INV-MAIN-000010', sold_at: '2026-12-09T06:00:00Z', lines: [saleLine('nl-1', 'Mango Juice', '3.000', '75.00')], total: '75.00', subtotal: '75.00',
  payments: [
    { id: 'p-1', kind: 'payment', method: 'exchange', method_label: 'Exchange', amount: '50.00', tendered: null, reference: 'RET-MAIN-000003', created_at: '2026-12-09T06:00:00Z', created_by: 'Pos Cashier' },
    { id: 'p-2', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '25.00', tendered: '25.00', reference: null, created_at: '2026-12-09T06:00:00Z', created_by: 'Pos Cashier' },
  ],
  ...patch,
})

const theReturn = (refunds: { method: string; method_label: string; amount: string }[] = []) => ({
  id: 'r-3', number: 'RET-MAIN-000003', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000007' }, branch: { id: 'b-1', name: 'Main Branch' },
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer: rahim, reason: null, notes: null, currency: 'BDT', subtotal: '50.00', tax_total: '0.00', total: '50.00',
  credited_total: '0.00', refunded_total: '50.00', requested_by: null, requested_at: '2026-12-09T06:00:00Z', decided_by: null, decided_at: null, rejection_reason: null,
  lines: [], settlement: null, exchange_sale: { id: 'sa-9', number: 'INV-MAIN-000010', total: '75.00' },
  refunds: refunds.map((r) => ({ ...r, reference: null, created_by: null, created_at: '2026-12-09T06:00:00Z' })),
})

const cashier = (permissions: string[] = []): CurrentUser => ({ ...posCashier(), permissions: [...posCashier().permissions, ...permissions] })

function tillApi(extra: Parameters<typeof mockApi>[0] = {}, me: CurrentUser = cashier()) {
  return mockApi({
    'GET /auth/me': ok(me),
    'GET /pos/terminal': fail(404, 'TERMINAL_NOT_FOUND'),
    'GET /branches': paged(branchesWithStores()),
    'GET /categories': ok([]),
    'GET /customers': paged([]),
    'GET /register-sessions/current': ok(openSessionReport()),
    'GET /loyalty/settings': ok(loyaltyOff()),
    'GET /pos/catalog': paged([juice]),
    'POST /pos/price': (init) => ok(priceCart(JSON.parse(String(init.body)))),
    'GET /sales': paged([invoice()]),
    'GET /sales/sa-1': ok(invoice()),
    'GET /return-reasons': ok([{ id: 'rr-1', name: 'Damaged', restock_by_default: false, is_active: true }]),
    'POST /returns/preview': (init) => ok(preview(JSON.parse(String(init.body)))),
    'GET /pos/approvers': ok([{ id: 'u-9', name: 'Manager Mina' }]),
    ...extra,
  })
}

/** Exchange mode with the juices back (V = 50) and `juices` new ones in the cart. */
function exchangeCart(juices: number, value = '50.00') {
  const draft: ExchangeDraft = {
    invoice: { id: 'sa-1', number: 'INV-MAIN-000007', currency: 'BDT', customer: rahim },
    return: { sale_id: 'sa-1', return_reason_id: null, notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '2', restock: true }] },
    total: value, value, credit: '0.00',
    refundable: preview({ lines: [] }).settlement.refundable as ExchangeDraft['refundable'],
    lines: [{ product_name: 'Mango Juice', quantity: '2.000', line_total: value }],
    approvalId: null,
  }
  useCartStore.setState({ carts: { 'b-1': { storeId: 's-1', customer: rahim, notes: '', heldSaleId: null, pendingCheckout: null, exchange: draft, lines: [{
    key: 'k-1', variant_id: 'v-1', label: 'Mango Juice', sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_serials: false, price: '25.00',
    quantity: String(juices), discount: null, serials: [], unit_price: null, price_approval_id: null, open_price: false,
  }] } } })
}

const cartPanel = () => screen.getByRole('complementary', { name: 'Current sale' })

async function findInvoice(user: ReturnType<typeof userEvent.setup>, number = 'inv-main-000007') {
  await user.click(await screen.findByRole('button', { name: 'Exchange' }))
  const dialog = await screen.findByRole('dialog', { name: 'Exchange items' })
  await user.type(within(dialog).getByLabelText('Invoice number'), `${number}{Enter}`)
  return dialog
}

describe('POS1c exchanges at the till', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'XSRF-TOKEN=t'
    useCartStore.setState({ carts: {} })
    useTillLockStore.setState({ lockedUserId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('finds the invoice, values the return, and the customer pays the difference (retry keeps the key)', async () => {
    const user = userEvent.setup()
    const posted: Record<string, unknown>[] = []
    const keys: (string | null)[] = []
    let previewBody: unknown
    tillApi({
      'POST /returns/preview': (init) => {
        previewBody = JSON.parse(String(init.body))
        return ok(preview(JSON.parse(String(init.body))))
      },
      'POST /pos/exchanges': (init) => {
        posted.push(JSON.parse(String(init.body)))
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        return posted.length === 1 ? fail(503, 'SERVICE_UNAVAILABLE', 'The server is busy.') : created({ sale: newSale(), return: theReturn(), credit_note: null })
      },
    }, cashier(['returns.approve']))
    renderRoutes(routes, '/pos')
    await screen.findByRole('button', { name: /^Mango Juice/ })

    const dialog = await findInvoice(user)
    const juiceLine = (await within(dialog).findByText('Mango Juice')).closest('li')!
    expect(within(juiceLine).getByTestId('returnable')).toHaveTextContent('2')
    expect(within(dialog).getByRole('group', { name: 'Serials of Phone' })).toHaveTextContent('SN-1')
    expect(within(dialog).getByRole('button', { name: 'Check value' })).toBeDisabled()
    for (let i = 0; i < 3; i++) await user.click(within(dialog).getByRole('button', { name: 'More Mango Juice' }))
    expect(within(dialog).getByLabelText('Return quantity of Mango Juice')).toHaveValue('2')
    await user.click(within(dialog).getByRole('button', { name: 'Check value' }))
    expect(await within(dialog).findByTestId('exchange-value')).toHaveTextContent('BDT 50.00')
    expect(previewBody).toEqual({ sale_id: 'sa-1', return_reason_id: null, notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '2', restock: true }] })
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

    const banner = await within(cartPanel()).findByTestId('exchange-banner')
    expect(banner).toHaveTextContent('Exchange for INV-MAIN-000007 · returned BDT 50.00')
    expect(within(cartPanel()).getByRole('button', { name: /Hold/ })).toBeDisabled()
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: /^Mango Juice/ }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Customer pays BDT 25.00 more'))
    await user.click(within(cartPanel()).getByRole('button', { name: /^Pay BDT 25.00/ }))

    const payment = await screen.findByRole('dialog', { name: 'Payment' })
    expect(within(payment).getByTestId('exchange-credit')).toHaveTextContent('Exchange credit (INV-MAIN-000007) −BDT 50.00')
    expect(within(payment).getByLabelText('Amount of payment 1')).toHaveValue('25.00')
    await user.click(within(payment).getByRole('button', { name: 'Complete exchange' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    await user.click(within(payment).getByRole('button', { name: 'Complete exchange' }))

    expect(await screen.findByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })).toBeInTheDocument()
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(posted[1]).toEqual({
      return: { sale_id: 'sa-1', return_reason_id: null, notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '2', restock: true }] },
      store_id: 's-1', customer_id: 'c-1', lines: [{ variant_id: 'v-1', quantity: '3', discount: null }], notes: null,
      payments: [{ method: 'cash', amount: '25.00', reference: null }],
    })
    expect(useCartStore.getState().carts['b-1']?.exchange ?? null).toBeNull()
  })

  it('refunds the difference in cash and as a credit note after a manager approves the return by PIN', async () => {
    const user = userEvent.setup()
    const approvals: unknown[] = []
    let posted: Record<string, unknown> | undefined
    tillApi({
      'POST /pos/approvals': (init) => {
        approvals.push(JSON.parse(String(init.body)))
        return created({ id: 'ap-1', action: 'return', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-09T06:10:00Z' })
      },
      'POST /pos/exchanges': (init) => {
        posted = JSON.parse(String(init.body))
        return created({
          sale: newSale({ total: '25.00', payments: [] }),
          return: theReturn([{ method: 'exchange', method_label: 'Exchange', amount: '25.00' }, { method: 'cash', method_label: 'Cash', amount: '400.00' }, { method: 'gift_card', method_label: 'Gift card', amount: '75.00' }]),
          credit_note: { code: 'CRED-ITNO-TEAB-CD12', code_last4: 'CD12', amount: '75.00', expires_at: null },
        })
      },
    })
    renderRoutes(routes, '/pos')
    await screen.findByRole('button', { name: /^Mango Juice/ })

    const dialog = await findInvoice(user)
    await user.click(await within(dialog).findByRole('checkbox', { name: 'SN-1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Check value' }))
    expect(await within(dialog).findByTestId('exchange-value')).toHaveTextContent('BDT 500.00')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

    await within(cartPanel()).findByTestId('exchange-banner')
    await user.click(screen.getByRole('button', { name: /^Mango Juice/ }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Refund to customer BDT 475.00'))
    await user.keyboard('{F9}')

    const settle = await screen.findByRole('dialog', { name: 'Exchange' })
    expect(within(settle).getByTestId('exchange-credit')).toHaveTextContent('−BDT 25.00')
    expect(within(settle).getByTestId('exchange-refund')).toHaveTextContent('BDT 475.00')
    expect(within(settle).getByLabelText('Refund amount 1')).toHaveValue('475.00')
    await user.clear(within(settle).getByLabelText('Refund amount 1'))
    await user.type(within(settle).getByLabelText('Refund amount 1'), '400')
    await user.click(within(settle).getByRole('button', { name: 'Add refund method' }))
    expect(within(settle).getByLabelText('Refund amount 2')).toHaveValue('75.00')
    await user.click(within(settle).getByRole('button', { name: 'Complete exchange' }))

    const approval = await screen.findByRole('dialog', { name: 'Approve a return' })
    expect(approval).toHaveTextContent('Take back Phone × 1 from INV-MAIN-000007 (BDT 500.00) in an exchange.')
    expect(await within(approval).findByRole('radio', { name: 'Manager Mina' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('9753{Enter}')

    const note = await screen.findByRole('dialog', { name: 'Credit note issued' })
    expect(within(note).getByTestId('gift-code')).toHaveTextContent('CRED-ITNO-TEAB-CD12')
    expect(approvals).toEqual([{ action: 'return', approver_id: 'u-9', pin: '9753', store_id: 's-1', details: { sale_id: 'sa-1' } }])
    expect(posted).toMatchObject({
      approval_id: 'ap-1',
      return: { sale_id: 'sa-1', lines: [{ sale_line_id: 'sl-2', quantity: '1', restock: true, serials: ['SN-1'] }] },
      payments: [],
      refunds: [{ method: 'cash', amount: '400', reference: null }, { method: 'gift_card', amount: '75.00', reference: null }],
    })
    expect(JSON.stringify(localStorage)).not.toContain('CRED')
    await user.click(within(note).getByRole('button', { name: 'Done' }))

    const done = await screen.findByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })
    expect(within(done).getByTestId('exchange-refunded')).toHaveTextContent('Refunded to customer: BDT 475.00 (Cash 400.00, Gift card 75.00)')
    expect(screen.queryByText('CRED-ITNO-TEAB-CD12')).not.toBeInTheDocument()
  })

  it('an even exchange has nothing to pay; cancelling the approval sends nothing', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    tillApi({
      'POST /pos/approvals': created({ id: 'ap-2', action: 'return', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-09T06:10:00Z' }),
      'POST /pos/exchanges': (init) => {
        posted = JSON.parse(String(init.body))
        return created({ sale: newSale({ total: '50.00', payments: [] }), return: theReturn([{ method: 'exchange', method_label: 'Exchange', amount: '50.00' }]), credit_note: null })
      },
    })
    exchangeCart(2)
    renderRoutes(routes, '/pos')

    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Even exchange — nothing to pay'))
    await user.click(within(cartPanel()).getByRole('button', { name: /^Complete exchange/ }))
    const settle = await screen.findByRole('dialog', { name: 'Exchange' })
    expect(within(settle).getByTestId('exchange-even')).toHaveTextContent('Nothing to pay')
    expect(within(settle).queryByRole('group', { name: 'Refunds' })).not.toBeInTheDocument()

    await user.click(within(settle).getByRole('button', { name: 'Complete exchange' }))
    const approval = await screen.findByRole('dialog', { name: 'Approve a return' })
    await user.click(within(approval).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Approve a return' })).not.toBeInTheDocument())
    expect(posted).toBeUndefined()

    await user.click(within(settle).getByRole('button', { name: 'Complete exchange' }))
    await within(await screen.findByRole('dialog', { name: 'Approve a return' })).findByRole('radio', { name: 'Manager Mina' })
    await user.keyboard('9753{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })).toHaveTextContent('Change due')
    expect(posted).toMatchObject({ approval_id: 'ap-2', payments: [] })
    expect(posted).not.toHaveProperty('refunds')
  })

  it('shows a refund mismatch at the refund rows with the amount now due', async () => {
    const user = userEvent.setup()
    const bodies: { refunds?: unknown }[] = []
    tillApi({
      'POST /pos/exchanges': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return bodies.length === 1
          ? fail(422, 'REFUND_MISMATCH', 'The refunds must add up to the refund due.', { refund_due: '40.00' })
          : created({ sale: newSale(), return: theReturn([{ method: 'cash', method_label: 'Cash', amount: '40.00' }]), credit_note: null })
      },
    }, cashier(['returns.approve']))
    exchangeCart(2, '100.00')
    renderRoutes(routes, '/pos')

    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Refund to customer BDT 50.00'))
    await user.keyboard('{F9}')
    const settle = await screen.findByRole('dialog', { name: 'Exchange' })
    await user.click(within(settle).getByRole('button', { name: 'Complete exchange' }))

    expect(await within(settle).findByRole('alert')).toHaveTextContent('The refund due is now BDT 40.00')
    expect(within(settle).getByTestId('exchange-refund')).toHaveTextContent('BDT 40.00')
    expect(within(settle).getByLabelText('Refund amount 1')).toHaveValue('40.00')
    await user.click(within(settle).getByRole('button', { name: 'Complete exchange' }))
    expect(await screen.findByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })).toBeInTheDocument()
    expect(bodies.map((b) => b.refunds)).toEqual([[{ method: 'cash', amount: '50.00', reference: null }], [{ method: 'cash', amount: '40.00', reference: null }]])
    expect(bodies[0]).not.toHaveProperty('approval_id')
  })

  it('asks the manager again when the approval has expired, and resends', async () => {
    const user = userEvent.setup()
    const bodies: { approval_id?: string }[] = []
    let approvalCount = 0
    tillApi({
      'POST /pos/approvals': () => created({ id: `ap-${++approvalCount}`, action: 'return', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-09T06:10:00Z' }),
      'POST /pos/exchanges': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return bodies.length === 1
          ? fail(422, 'APPROVAL_INVALID', 'The approval has expired.')
          : created({ sale: newSale(), return: theReturn(), credit_note: null })
      },
    })
    exchangeCart(3)
    renderRoutes(routes, '/pos')

    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Customer pays BDT 25.00 more'))
    await user.keyboard('{F9}')
    const payment = await screen.findByRole('dialog', { name: 'Payment' })
    await user.click(within(payment).getByRole('button', { name: 'Complete exchange' }))
    await within(await screen.findByRole('dialog', { name: 'Approve a return' })).findByRole('radio', { name: 'Manager Mina' })
    await user.keyboard('9753{Enter}')

    const again = await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: 'Approve a return' })
      expect(dialog).toHaveTextContent('The earlier approval expired or was already used.')
      return dialog
    })
    await within(again).findByRole('radio', { name: 'Manager Mina' })
    await user.keyboard('9753{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })).toBeInTheDocument()
    expect(bodies.map((b) => b.approval_id)).toEqual(['ap-1', 'ap-2'])
  })

  it('refuses invoices of another branch and cancelled ones; another branch from the server closes the payment', async () => {
    const user = userEvent.setup()
    tillApi({
      'GET /sales': paged([invoice(), invoice({ id: 'sa-2', number: 'INV-MAIN-000070' })]),
      'GET /sales/sa-1': ok(invoice({ branch: { id: 'b-2', name: 'Uttara' } })),
      'GET /sales/sa-2': ok(invoice({ id: 'sa-2', number: 'INV-MAIN-000070', status: 'cancelled' })),
      'POST /pos/exchanges': fail(422, 'EXCHANGE_OTHER_BRANCH', 'The invoice is from another branch.'),
    }, cashier(['returns.approve']))
    renderRoutes(routes, '/pos')
    await screen.findByRole('button', { name: /^Mango Juice/ })

    const dialog = await findInvoice(user, 'INV-MAIN-0000')
    const matches = await within(dialog).findByRole('group', { name: 'Matching invoices' })
    await user.click(within(matches).getByRole('button', { name: /INV-MAIN-000070/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('INV-MAIN-000070 is cancelled; nothing can be returned.')
    expect(within(dialog).queryByRole('button', { name: 'Check value' })).not.toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Invoice number'))
    await user.type(within(dialog).getByLabelText('Invoice number'), 'INV-MAIN-000007{Enter}')
    expect(await within(dialog).findByText('INV-MAIN-000007 was sold at Uttara. Only invoices of this branch can be exchanged here.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    // The server has the last word (e.g. the invoice moved on meanwhile).
    exchangeCart(3)
    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Customer pays BDT 25.00 more'))
    await user.keyboard('{F9}')
    const payment = await screen.findByRole('dialog', { name: 'Payment' })
    await user.click(within(payment).getByRole('button', { name: 'Complete exchange' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Payment' })).not.toBeInTheDocument())
    expect(within(cartPanel()).getByRole('alert')).toHaveTextContent('INV-MAIN-000007 was sold in another branch. Only invoices of this branch can be exchanged here.')

    // Cancelling the exchange keeps the items for a normal sale.
    await user.click(within(cartPanel()).getByRole('button', { name: 'Cancel exchange' }))
    expect(within(cartPanel()).queryByTestId('exchange-banner')).not.toBeInTheDocument()
    expect(within(cartPanel()).getByRole('button', { name: /^Pay BDT 75.00/ })).toBeInTheDocument()
  })

  it('does not lock the till while the exchange request is in flight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const base = tillApi({
      'POST /pos/exchanges': created({ sale: newSale(), return: theReturn(), credit_note: null }),
    }, { ...cashier(['returns.approve']), pin_set: true })
    let release: (() => void) | null = null
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/pos/exchanges')) await new Promise<void>((resolve) => { release = resolve })
      return base(input, init)
    })
    exchangeCart(3)
    renderRoutes(routes, '/pos')

    await waitFor(() => expect(within(cartPanel()).getByTestId('exchange-difference')).toHaveTextContent('Customer pays BDT 25.00 more'))
    await user.keyboard('{F9}')
    const payment = await screen.findByRole('dialog', { name: 'Payment' })
    await user.click(within(payment).getByRole('button', { name: 'Complete exchange' }))
    await waitFor(() => expect(release).not.toBeNull())

    act(() => { vi.advanceTimersByTime(AUTO_LOCK_MS + 1_000) })
    expect(useTillLockStore.getState().lockedUserId).toBeNull()

    act(() => release?.())
    expect(await screen.findByRole('dialog', { name: 'Exchange INV-MAIN-000010 completed' })).toBeInTheDocument()
    // Once it is done, the idle timer runs again.
    act(() => { vi.advanceTimersByTime(AUTO_LOCK_MS + 1_000) })
    expect(useTillLockStore.getState().lockedUserId).toBe('u-4')
  })
})
