import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { WebOrder } from '@/features/web-orders/api'
import type { PaymentClaim } from '@/features/web-orders/payment-claims-api'
import { boardTabCount, filtersFromSearchParams, filtersToSearchParams, paymentBadge, paymentMethodLabel, toListParams, visibleBoardTabs } from '@/features/web-orders/orders'
import { hasSendMoneyPayment, remainingAfterAdvance } from '@/features/web-orders/payment-claims'
import { couriers, orderManager, orderRow, orderViewer, webOrder } from '@/features/web-orders/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const claim = (overrides: Partial<PaymentClaim> = {}): PaymentClaim => ({
  id: 'pc-2',
  method: 'bkash_manual',
  purpose: 'full',
  amount: '1560.00',
  sender_phone: '01812345678',
  transaction_id: 'BKX7Q2M9TZ',
  status: 'submitted',
  reject_reason: null,
  submitted_at: '2026-11-24T05:00:00Z',
  reviewed_by: null,
  reviewed_at: null,
  ...overrides,
})

const bkashOrder = (overrides: Partial<WebOrder> = {}): WebOrder =>
  webOrder({
    payment_method: 'bkash_manual',
    payment_method_label: 'bKash (Send Money)',
    payment_instructions: null,
    advance_amount: '0.00',
    payment_due: {
      amount: '1560.00',
      currency: 'BDT',
      purpose: 'full',
      expires_at: '2026-11-25T04:30:00Z',
      methods: [{ code: 'bkash_manual', display_name: 'bKash', account_number: '01712345678', account_type: 'personal' }],
      claim: null,
    },
    payment_claims: [
      claim(),
      claim({ id: 'pc-1', transaction_id: 'BKOLD12345', status: 'rejected', reject_reason: 'No payment with this TrxID', reviewed_by: { id: 'u-1', name: 'Nadia Admin' }, reviewed_at: '2026-11-24T04:50:00Z', submitted_at: '2026-11-24T04:40:00Z' }),
    ],
    allowed_actions: ['confirm_payment', 'confirm_payment_claim', 'cancel'],
    ...overrides,
  })

describe('BD1c Send Money payments on the order page', () => {
  it('lists the transaction IDs and confirms the open one', async () => {
    const user = userEvent.setup()
    const calls: { url: string; key: string | null }[] = []
    let current = bkashOrder()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'POST /web-orders/wo-1/payment-claims/pc-2/confirm': (init, url) => {
        calls.push({ url: url.pathname, key: new Headers(init.headers).get('Idempotency-Key') })
        current = bkashOrder({
          status: 'confirmed',
          status_label: 'Confirmed',
          payment_status: 'paid',
          payment_due: null,
          payment_claims: [claim({ status: 'confirmed', reviewed_by: { id: 'u-1', name: 'Nadia Admin' }, reviewed_at: '2026-11-24T05:10:00Z' })],
          allowed_actions: ['process', 'cancel'],
        })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByTestId('payment-claims-card')
    expect(within(card).getByTestId('payment-due')).toHaveTextContent('Amount due BDT 1,560.00')
    expect(within(card).getByTestId('payment-due')).toHaveTextContent('bKash 01712345678 (Personal)')
    const items = within(card).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('bKash (Send Money)To check')
    expect(within(items[0]!).getByTestId('claim-trxid')).toHaveTextContent('BKX7Q2M9TZ')
    expect(items[0]).toHaveTextContent('01812345678')
    expect(within(items[0]!).getByRole('button', { name: 'Copy transaction ID BKX7Q2M9TZ' })).toBeInTheDocument()
    expect(items[1]).toHaveTextContent('Rejected')
    expect(within(items[1]!).getByTestId('claim-reject-reason')).toHaveTextContent('No payment with this TrxID')
    expect(items[1]).toHaveTextContent('Nadia Admin')
    expect(within(items[1]!).queryByRole('button', { name: 'Confirm payment' })).not.toBeInTheDocument()

    await user.click(within(within(card).getByRole('group', { name: 'Check transaction ID BKX7Q2M9TZ' })).getByRole('button', { name: 'Confirm payment' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirm BDT 1,560.00 by bKash (Send Money)?' })
    expect(dialog).toHaveTextContent('from 01812345678 with transaction ID BKX7Q2M9TZ in your bKash app')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.url).toBe('/api/v1/web-orders/wo-1/payment-claims/pc-2/confirm')
    expect(calls[0]?.key).toBeTruthy()
    expect(toastSuccess).toHaveBeenCalledWith('Payment of BDT 1,560.00 confirmed for WEB-000001.')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await within(screen.getByTestId('payment-claims-card')).findByText('Confirmed')).toBeInTheDocument()
    expect(screen.queryByTestId('payment-due')).not.toBeInTheDocument()
  })

  it('rejects a transaction ID with a reason the customer sees', async () => {
    const user = userEvent.setup()
    let body: unknown
    let current = bkashOrder()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'POST /web-orders/wo-1/payment-claims/pc-2/reject': (init) => {
        body = JSON.parse(String(init.body))
        current = bkashOrder({ payment_claims: [claim({ status: 'rejected', reject_reason: 'Wrong amount' })], allowed_actions: ['confirm_payment', 'cancel'] })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByTestId('payment-claims-card')
    await user.click(within(card).getByRole('button', { name: 'Reject' }))
    const dialog = screen.getByRole('dialog', { name: 'Reject transaction ID BKX7Q2M9TZ?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByText(/Tell the customer why/)).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong amount')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Wrong amount' }))
    expect(await within(screen.getByTestId('payment-claims-card')).findByText('Wrong amount')).toBeInTheDocument()
    expect(within(screen.getByTestId('payment-claims-card')).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('closes the dialog and refreshes when the claim was already checked', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(bkashOrder()),
      'POST /web-orders/wo-1/payment-claims/pc-2/confirm': fail(422, 'INVALID_STATUS_TRANSITION', 'Not submitted'),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByTestId('payment-claims-card')
    await user.click(within(card).getByRole('button', { name: 'Confirm payment' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This transaction ID has already been checked; the order was refreshed.'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows claims read-only without web_orders.manage', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/wo-1': ok(bkashOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')
    const card = await screen.findByTestId('payment-claims-card')
    expect(within(card).getAllByTestId('claim-trxid').map((e) => e.textContent)).toEqual(['BKX7Q2M9TZ', 'BKOLD12345'])
    expect(within(card).queryByRole('button', { name: 'Confirm payment' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('shows a partly paid cash on delivery order with its advance and the rest to collect', async () => {
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(webOrder({
        status: 'confirmed',
        status_label: 'Confirmed',
        payment_method: 'cod',
        payment_method_label: 'Cash on delivery',
        payment_status: 'partially_paid',
        payment_instructions: null,
        advance_amount: '60.00',
        paid_total: '60.00',
        payment_due: null,
        payment_claims: [claim({ purpose: 'advance', amount: '60.00', status: 'confirmed', method: 'nagad_manual' })],
        allowed_actions: ['process', 'cancel'],
      })),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByTestId('payment-claims-card')
    expect(within(card).getByTestId('advance-note')).toHaveTextContent('Advance delivery charge of BDT 60.00 paid; the rest is collected on delivery.')
    expect(within(card).getByRole('listitem')).toHaveTextContent('Nagad (Send Money)ConfirmedAdvance delivery charge')
    expect(screen.getAllByText('Partly paid').length).toBeGreaterThan(0)
    expect(screen.getByTestId('order-advance')).toHaveTextContent('60.00')
    expect(screen.getByTestId('order-cod-rest')).toHaveTextContent('BDT 1,500.00')
  })

  it('has no Send Money card for an ordinary order', async () => {
    mockApi({ 'GET /auth/me': ok(orderManager()), 'GET /web-orders/wo-1': ok(webOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByTestId('payment-claims-card')).not.toBeInTheDocument()
  })
})

describe('BD1c web orders list', () => {
  it('has a "Payment to check" tab and marks rows with a transaction ID to check', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    const counts = { pending_payment: 2, confirmed: 1, payment_check: 1 }
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/couriers': ok(couriers()),
      'GET /geography/districts': ok([]),
      'GET /web-orders': (_init, url) => {
        queries.push(url.searchParams)
        return ok(
          [
            orderRow({ payment_method: 'bkash_manual', payment_claim_status: 'submitted' }),
            orderRow({ id: 'wo-2', number: 'WEB-000002', payment_method: 'cod', status: 'confirmed', payment_status: 'partially_paid' }),
          ],
          { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 }, status_counts: counts },
        )
      },
    })
    const { router } = renderRoutes(routes, '/web-orders')

    expect(await screen.findByTestId('trxid-sent-wo-1')).toHaveTextContent('TrxID sent')
    expect(screen.queryByTestId('trxid-sent-wo-2')).not.toBeInTheDocument()
    expect(screen.getByText('bKash (Send Money)')).toBeInTheDocument()
    expect(screen.getByText('Partly paid')).toBeInTheDocument()
    const tabs = screen.getByRole('tablist', { name: 'Order status' })
    // "All" adds up the statuses only, not the cross-status "Payment to check".
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'All3', 'Pending payment2', 'Payment to check1', 'Confirmed1', 'Processing0', 'Shipped0', 'Delivered0', 'Cancelled0', 'COD to collect',
    ])

    await user.click(within(tabs).getByRole('tab', { name: /Payment to check/ }))
    await waitFor(() => expect(queries.at(-1)?.get('payment_check')).toBe('1'))
    expect(queries.at(-1)?.get('status')).toBeNull()
    expect(router.state.location.search).toBe('?payment_check=1')
  })
})

describe('BD1c helpers', () => {
  it('reads and writes the payment check tab in the URL', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('payment_check=1&page=2'))
    expect(filters.tab).toBe('payment_check')
    expect(filtersToSearchParams(filters).toString()).toBe('payment_check=1&page=2')
    expect(toListParams(filters, '')).toEqual({ page: 2, per_page: 25, payment_check: 1 })
  })

  it('shows the payment check tab only while transaction IDs wait (or it is open)', () => {
    expect(visibleBoardTabs('all', { pending_payment: 1 })).not.toContain('payment_check')
    expect(visibleBoardTabs('all', { payment_check: 2 })).toContain('payment_check')
    expect(visibleBoardTabs('payment_check', { payment_check: 0 })).toContain('payment_check')
    expect(boardTabCount('payment_check', { confirmed: 1 })).toBeNull()
    expect(boardTabCount('all', { confirmed: 1, payment_check: 4, cod_unremitted: 2 })).toBe(1)
  })

  it('labels the new methods and payment status', () => {
    expect(paymentMethodLabel('nagad_manual')).toBe('Nagad (Send Money)')
    expect(paymentMethodLabel('rocket_manual')).toBe('Rocket (Send Money)')
    expect(paymentMethodLabel('some_new_way')).toBe('some new way')
    expect(paymentBadge('partially_paid')).toEqual({ label: 'Partly paid', variant: 'info' })
  })

  it('works out what is left to collect after an advance', () => {
    expect(remainingAfterAdvance({ total: '1560.00', paid_total: '120.00', payment_status: 'partially_paid' })).toBe('1440.00')
    expect(remainingAfterAdvance({ total: '1560.00', paid_total: '1560.00', payment_status: 'paid' })).toBeNull()
    expect(remainingAfterAdvance({ total: '1560.00', payment_status: 'partially_paid' })).toBeNull()
    expect(hasSendMoneyPayment({ payment_due: null, payment_claims: [], advance_amount: '0.00' })).toBe(false)
    expect(hasSendMoneyPayment({ payment_due: null, payment_claims: [], advance_amount: '120.00' })).toBe(true)
  })
})
