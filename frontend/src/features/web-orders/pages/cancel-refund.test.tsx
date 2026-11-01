import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { WebOrder } from '@/features/web-orders/api'
import { cancelRefundDue } from '@/features/web-orders/orders'
import { webOrder } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
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

const refunder = () => makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.manage', 'web_orders.refund'] })
const manager = () => makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.manage'] })

const paidOrder = (overrides: Partial<WebOrder> = {}): WebOrder =>
  webOrder({
    status: 'confirmed',
    status_label: 'Confirmed',
    payment_status: 'paid',
    paid_total: '1560.00',
    refunded_total: '0.00',
    allowed_actions: ['process', 'cancel'],
    ...overrides,
  })

async function openCancel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
  return screen.findByRole('dialog', { name: 'Cancel WEB-000001?' })
}

describe('cancelRefundDue', () => {
  it('is what was paid minus what was refunded, for paid orders only', () => {
    expect(cancelRefundDue(paidOrder())).toBe('1560.00')
    expect(cancelRefundDue(paidOrder({ payment_status: 'partially_refunded', refunded_total: '560.00' }))).toBe('1000.00')
    expect(cancelRefundDue(paidOrder({ paid_total: undefined, refunded_total: undefined }))).toBe('1560.00')
    expect(cancelRefundDue(paidOrder({ refunded_total: '1560.00' }))).toBeNull()
    expect(cancelRefundDue(webOrder())).toBeNull()
    expect(cancelRefundDue(paidOrder({ cancel_refund_amount: '1200.00' }))).toBe('1200.00')
    expect(cancelRefundDue(paidOrder({ cancel_refund_amount: null }))).toBeNull()
  })
})

describe('cancelling a paid web order', () => {
  it('refunds the full amount by the chosen method', async () => {
    const user = userEvent.setup()
    let body: unknown
    let key: string | null = null
    mockApi({
      'GET /auth/me': ok(refunder()),
      'GET /web-orders/wo-1': ok(paidOrder()),
      'POST /web-orders/wo-1/cancel': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return ok(paidOrder({ status: 'cancelled', status_label: 'Cancelled', payment_status: 'refunded', refunded_total: '1560.00', allowed_actions: [] }))
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const dialog = await openCancel(user)
    expect(dialog).toHaveTextContent('1,560.00 is refunded in full')
    expect(within(dialog).getByTestId('cancel-refund-due')).toHaveTextContent('1,560.00')
    const submit = within(dialog).getByRole('button', { name: 'Cancel and refund' })

    await user.type(within(dialog).getByLabelText('Reason'), 'Out of stock')
    expect(submit).toBeDisabled()
    await user.click(within(dialog).getByRole('combobox', { name: 'Paid back by' }))
    await user.click(await screen.findByRole('option', { name: 'Bank transfer' }))
    await user.type(within(dialog).getByLabelText('Refund reference (optional)'), 'TRX-99')
    await user.click(submit)

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('WEB-000001 cancelled and refunded.'))
    expect(body).toEqual({ reason: 'Out of stock', refund: { method: 'bank_transfer', reference: 'TRX-99' } })
    expect(key).toBeTruthy()
  })

  it.each([
    ['CASH_SESSION_REQUIRED', 'you have none', 'POS terminal'],
    ['INSUFFICIENT_CASH', 'does not hold enough cash', 'Refund by bank transfer or mobile banking instead.'],
    ['REFUND_REQUIRED', 'Choose how the money goes back', null],
  ])('keeps the dialog open and explains %s', async (code, message, help) => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(refunder()),
      'GET /web-orders/wo-1': ok(paidOrder()),
      'POST /web-orders/wo-1/cancel': fail(422, code),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const dialog = await openCancel(user)
    await user.type(within(dialog).getByLabelText('Reason'), 'Customer asked')
    await user.click(within(dialog).getByRole('combobox', { name: 'Paid back by' }))
    await user.click(await screen.findByRole('option', { name: 'Cash' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel and refund' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(message)
    if (help) expect(alert).toHaveTextContent(help)
    expect(toastError).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Cancel WEB-000001?' })).toBeInTheDocument()
  })

  it('without the refund permission explains who can cancel and offers no refund fields', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /web-orders/wo-1': ok(paidOrder()),
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const dialog = await openCancel(user)
    expect(within(dialog).getByRole('note')).toHaveTextContent('needs the permission to refund web orders')
    expect(within(dialog).queryByRole('combobox', { name: 'Paid back by' })).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Customer asked')
    expect(within(dialog).getByRole('button', { name: 'Cancel and refund' })).toBeDisabled()
  })

  it('cancels an unpaid order without refund fields', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(refunder()),
      'GET /web-orders/wo-1': ok(webOrder()),
      'POST /web-orders/wo-1/cancel': (init) => {
        body = JSON.parse(String(init.body))
        return ok(webOrder({ status: 'cancelled', allowed_actions: [] }))
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const dialog = await openCancel(user)
    expect(within(dialog).queryByRole('group', { name: 'Refund' })).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason'), 'Never paid')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Never paid' }))
  })
})
