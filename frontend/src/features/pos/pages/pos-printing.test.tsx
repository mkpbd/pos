import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import { useCartStore } from '@/features/pos/cart-store'
import { DEFAULT_PRINTER_SETTINGS, savePrinterSettings, type PrinterSettings } from '@/features/pos/printing/printer-settings'
import { resetAutoPrints } from '@/features/pos/printing/till-printer'
import { useTillLockStore } from '@/features/pos/till-lock'
import { fakeSerial, fakeSerialPort, installNavigatorDevices, written, type FakeSerialPort } from '@/test/fake-printers'
import { branchesWithStores, loyaltyOff, openSessionReport, posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/**
 * POS1d at the till: the receipt prints by itself on the USB / serial printer after a sale (the
 * drawer opens when cash was taken), "Print" reprints, failures offer browser printing, and the
 * drawer opens without a sale (with `pos.no_sale`, or a manager's PIN approval).
 */

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))
const contains = (haystack: number[], needle: number[]) => haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b))
const KICK_PIN2 = [0x1b, 0x70, 0, 25, 250]
const CUT = [0x1d, 0x56, 0x42, 0x00]
const LINK = 'https://shop.test/receipt/tok123'

const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true,
}

const priced = {
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
  customer: null, currency: 'BDT', tax_mode: 'exclusive',
  lines: [{
    position: 0, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
    track_stock: true, track_serials: false, max_discount_percent: null, quantity: '1', unit_price: '25.00', tax_rate: '0.0000', discount: null,
    available: '12.000', line_subtotal: '25.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '25.00', tax_amount: '0.00', line_total: '25.00',
  }],
  invoice_discount: null, subtotal: '25.00', item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00', net_total: '25.00', tax_total: '0.00', total: '25.00',
}

const sale = (method: 'cash' | 'card') => ({
  id: 'sa-1', number: 'INV-MAIN-000001', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '25.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '25.00',
  paid_total: '25.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, returns: [],
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', quantity: '1.000', unit_price: '25.00', discount: null,
    line_subtotal: '25.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '25.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '25.00', unit_cost: null, batches: [], serials: [],
    returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000' }],
  payments: [{ id: 'pay-1', kind: 'payment', method, method_label: method === 'cash' ? 'Cash' : 'Card', amount: '25.00', tendered: method === 'cash' ? '25.00' : null, reference: null, created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' }],
  receipt: { organization_name: 'Corner Shop', header: null, footer: 'Come again!', branch: null, timezone: 'Asia/Dhaka' },
})

const cashier = (extra: string[] = []): CurrentUser => ({ ...posCashier(), permissions: [...posCashier().permissions, ...extra] })

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
    'POST /pos/price': ok(priced),
    'GET /sales/sa-1/receipt-link': ok({ url: LINK, token: 'tok123' }),
    ...extra,
  })
}

const serialDevice = { kind: 'serial' as const, name: 'Serial port (USB 0416:5011)', vendorId: 0x0416, productId: 0x5011, serialNumber: null }

function serialPrinter(settings: Partial<PrinterSettings> = {}): FakeSerialPort {
  const port = fakeSerialPort()
  installNavigatorDevices({ serial: fakeSerial([port]) })
  savePrinterSettings({ ...DEFAULT_PRINTER_SETTINGS, connection: 'serial', device: serialDevice, ...settings })
  return port
}

async function sellOneJuice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
  await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('BDT 25.00'))
  await user.keyboard('{F9}')
  const payment = await screen.findByRole('dialog', { name: 'Payment' })
  await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))
  return screen.findByRole('dialog', { name: 'Sale INV-MAIN-000001 completed' })
}

describe('POS1d printing and the cash drawer at the till', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'XSRF-TOKEN=t'
    useCartStore.setState({ carts: {} })
    useTillLockStore.setState({ lockedUserId: null })
    resetAutoPrints()
    toastSuccess.mockReset()
    toastError.mockReset()
  })
  afterEach(() => installNavigatorDevices({ serial: null, usb: null }))

  it('prints the receipt by itself after a cash sale, opening the drawer, with the receipt link as a QR code', async () => {
    const user = userEvent.setup()
    const port = serialPrinter()
    tillApi({ 'POST /pos/checkout': { status: 201, body: { success: true, data: sale('cash'), meta: {} } } })
    renderRoutes(routes, '/pos')

    const done = await sellOneJuice(user)
    await waitFor(() => expect(port.writes).toHaveLength(1))
    const bytes = written(port)
    expect(bytes.slice(0, 10)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16, ...KICK_PIN2])
    expect(contains(bytes, ascii('Receipt: INV-MAIN-000001'))).toBe(true)
    expect(contains(bytes, ascii('Come again!'))).toBe(true)
    expect(contains(bytes, [0x1d, 0x28, 0x6b, LINK.length + 3, 0, 0x31, 0x50, 0x30, ...ascii(LINK)])).toBe(true)
    expect(bytes.slice(-4)).toEqual(CUT)

    // Closing and reopening nothing prints again; "Send receipt" opens the send dialog.
    await user.click(within(done).getByRole('button', { name: 'Send receipt' }))
    expect(await screen.findByRole('dialog', { name: 'Send receipt' })).toBeInTheDocument()
    expect(port.writes).toHaveLength(1)
  })

  it('a card sale prints without the drawer; Print reprints; a failed print offers browser printing', async () => {
    const user = userEvent.setup()
    const port = serialPrinter()
    const print = vi.fn()
    vi.stubGlobal('print', print)
    tillApi({ 'POST /pos/checkout': { status: 201, body: { success: true, data: sale('card'), meta: {} } } })
    renderRoutes(routes, '/pos')

    const done = await sellOneJuice(user)
    await waitFor(() => expect(port.writes).toHaveLength(1))
    expect(contains(written(port), KICK_PIN2)).toBe(false)

    await user.click(within(done).getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(port.writes).toHaveLength(2))
    expect(contains(Array.from(port.writes[1] ?? []), KICK_PIN2)).toBe(false)

    port.failWrite = new Error('The device has been lost.')
    await user.click(within(done).getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const [message, options] = toastError.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('The receipt was not printed. Printing failed: The device has been lost.')
    expect(options.action.label).toBe('Print in browser')
    options.action.onClick()
    await waitFor(() => expect(print).toHaveBeenCalled())
  })

  it('with printing by itself off, a cash sale only opens the drawer', async () => {
    const user = userEvent.setup()
    const port = serialPrinter({ autoPrint: false, drawerPin: 5 })
    tillApi({ 'POST /pos/checkout': { status: 201, body: { success: true, data: sale('cash'), meta: {} } } })
    renderRoutes(routes, '/pos')

    await sellOneJuice(user)
    await waitFor(() => expect(port.writes).toHaveLength(1))
    expect(written(port)).toEqual([0x1b, 0x40, 0x1b, 0x70, 1, 25, 250])
  })

  it('prints a gift card sale slip by itself with its code and opens the drawer for the cash', async () => {
    const user = userEvent.setup()
    const port = serialPrinter()
    tillApi({
      'POST /gift-cards/sell': { status: 201, body: { success: true, data: {
        gift_card: { id: 'gc-9', code: 'ABCDEFGHJKLMNPQR', code_last4: 'NPQR', kind: 'gift_card', balance: '1000.00', currency: 'BDT', expires_at: null, customer: null },
        receipt_number: 'GCS-000001',
      }, meta: {} } },
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Cards & credit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sell gift card' }))
    const sell = await screen.findByRole('dialog', { name: 'Sell gift card' })
    await user.type(within(sell).getByLabelText('Card value'), '1000')
    await user.click(within(sell).getByRole('button', { name: 'Sell gift card' }))
    await screen.findByRole('dialog', { name: 'Gift card sold' })

    await waitFor(() => expect(port.writes).toHaveLength(1))
    const bytes = written(port)
    expect(bytes.slice(0, 10)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16, ...KICK_PIN2])
    expect(contains(bytes, ascii('Gift card sale: GCS-000001'))).toBe(true)
    expect(contains(bytes, ascii('ABCD-EFGH-JKLM-NPQR'))).toBe(true)
  })

  it('without a printer set up, nothing prints by itself and Print uses the browser', async () => {
    const user = userEvent.setup()
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const fetchMock = tillApi({ 'POST /pos/checkout': { status: 201, body: { success: true, data: sale('cash'), meta: {} } } })
    renderRoutes(routes, '/pos')

    const done = await sellOneJuice(user)
    await user.click(within(done).getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(print).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('receipt-link'))).toBe(false)
  })

  it('opens the drawer without a sale with pos.no_sale: the reason is recorded, then the printer kicks it', async () => {
    const user = userEvent.setup()
    const port = serialPrinter()
    const openings: { body: unknown; key: string | null }[] = []
    tillApi({
      'POST /pos/drawer-openings': (init) => {
        openings.push({ body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('Idempotency-Key') })
        return { status: 201, body: { success: true, data: { id: 'do-1', opened_at: '2026-12-10T06:00:00Z', approved_by: null }, meta: {} } }
      },
    }, cashier(['pos.no_sale']))
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Till' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open drawer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Open drawer' })
    await user.click(within(dialog).getByRole('button', { name: 'Open drawer' }))
    expect(within(dialog).getByText('Say why the drawer is opened.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Change for the next customer')
    await user.click(within(dialog).getByRole('button', { name: 'Open drawer' }))

    await waitFor(() => expect(port.writes).toHaveLength(1))
    expect(openings).toHaveLength(1)
    expect(openings[0]?.body).toEqual({ store_id: 's-1', reason: 'Change for the next customer' })
    expect(openings[0]?.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(written(port)).toEqual([0x1b, 0x40, ...KICK_PIN2])
    expect(toastSuccess).toHaveBeenCalledWith('Drawer opened.')
    expect(screen.queryByRole('dialog', { name: 'Open drawer' })).not.toBeInTheDocument()
  })

  it('without pos.no_sale a manager approves by PIN; with no printer the cashier opens it by hand', async () => {
    const user = userEvent.setup()
    const approvals: unknown[] = []
    const openings: unknown[] = []
    tillApi({
      'GET /pos/approvers': (_init, url) => (url.searchParams.get('action') === 'no_sale' ? ok([{ id: 'u-9', name: 'Manager Mina' }]) : ok([])),
      'POST /pos/approvals': (init) => {
        approvals.push(JSON.parse(String(init.body)))
        return { status: 201, body: { success: true, data: { id: 'ap-1', action: 'no_sale', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-10T06:10:00Z' }, meta: {} } }
      },
      'POST /pos/drawer-openings': (init) => {
        openings.push(JSON.parse(String(init.body)))
        return { status: 201, body: { success: true, data: { id: 'do-1', opened_at: '2026-12-10T06:00:00Z', approved_by: { id: 'u-9', name: 'Manager Mina' } }, meta: {} } }
      },
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Till' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open drawer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Open drawer' })
    expect(dialog).toHaveTextContent('after a manager approves with their PIN')
    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong change given')
    await user.click(within(dialog).getByRole('button', { name: 'Open drawer' }))

    const approval = await screen.findByRole('dialog', { name: 'Approve opening the drawer' })
    expect(approval).toHaveTextContent('Open the cash drawer without a sale: “Wrong change given”.')
    expect(await within(approval).findByRole('radio', { name: 'Manager Mina' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('9753{Enter}')

    await waitFor(() => expect(openings).toHaveLength(1))
    expect(approvals).toEqual([{ action: 'no_sale', approver_id: 'u-9', pin: '9753', store_id: 's-1' }])
    expect(openings[0]).toEqual({ store_id: 's-1', reason: 'Wrong change given', approval_id: 'ap-1' })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Drawer opening recorded — open it by hand.'))
  })

  it('shows the register session problem and asks for a manager when the server wants one', async () => {
    const user = userEvent.setup()
    let calls = 0
    const openings: unknown[] = []
    tillApi({
      'GET /pos/approvers': ok([{ id: 'u-9', name: 'Manager Mina' }]),
      'POST /pos/approvals': { status: 201, body: { success: true, data: { id: 'ap-2', action: 'no_sale', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-10T06:10:00Z' }, meta: {} } },
      'POST /pos/drawer-openings': (init) => {
        calls++
        openings.push(JSON.parse(String(init.body)))
        if (calls === 1) return fail(422, 'CASH_SESSION_REQUIRED', 'Open a register session first.')
        if (calls === 2) return fail(422, 'APPROVAL_REQUIRED', 'A manager must approve this.', { action: 'no_sale' })
        return { status: 201, body: { success: true, data: { id: 'do-1', opened_at: '2026-12-10T06:00:00Z', approved_by: null }, meta: {} } }
      },
    }, cashier(['pos.no_sale']))
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Till' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open drawer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Open drawer' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Count check')
    await user.click(within(dialog).getByRole('button', { name: 'Open drawer' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Open a register session in this branch first.')

    await user.click(within(dialog).getByRole('button', { name: 'Open drawer' }))
    const approval = await screen.findByRole('dialog', { name: 'Approve opening the drawer' })
    expect(approval).toHaveTextContent('A manager’s approval is needed.')
    await user.keyboard('9753{Enter}')
    await waitFor(() => expect(openings).toHaveLength(3))
    expect(openings[2]).toEqual({ store_id: 's-1', reason: 'Count check', approval_id: 'ap-2' })
  })
})
