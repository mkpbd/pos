import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { CodRemittance } from '@/features/cod-remittances/api'
import { feeError, formatDay, invalidOrders, netOf, remittanceFiltersFromSearchParams, toRemittanceListParams } from '@/features/cod-remittances/remittances'
import { couriers, orderManager, orderRow, remitter } from '@/features/web-orders/test-data'
import { ApiError } from '@/lib/api/client'
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

const paged = (items: unknown[], total = items.length) => ok(items, { pagination: { current_page: 1, per_page: 25, total, last_page: 1 } })

const remittance = (overrides: Partial<CodRemittance> = {}): CodRemittance => ({
  id: 'rem-1',
  number: 'REM-000001',
  courier_id: 'c-1',
  courier: { id: 'c-1', name: 'Pathao' },
  reference: 'PTH-STMT-77',
  received_at: '2026-11-01',
  method: 'bank_transfer',
  gross_amount: '2560.00',
  fee_amount: '50.00',
  net_amount: '2510.00',
  order_count: 2,
  currency: 'BDT',
  note: null,
  created_by: { id: 'u-1', name: 'Rahim Uddin' },
  expense: { id: 'ex-1', number: 'EXP-000009' },
  created_at: '2026-11-01T09:00:00Z',
  lines: [
    { order_id: 'wo-1', number: 'WEB-000001', amount: '1560.00' },
    { order_id: 'wo-2', number: 'WEB-000002', amount: '1000.00' },
  ],
  ...overrides,
})

const delivered = [
  orderRow({ id: 'wo-1', number: 'WEB-000001', status: 'delivered', payment_method: 'cod', total: '1560.00', courier_name: 'Pathao', tracking_number: 'PT 1' }),
  orderRow({ id: 'wo-2', number: 'WEB-000002', status: 'delivered', payment_method: 'cod', total: '1000.00', courier_name: 'Pathao' }),
  orderRow({ id: 'wo-3', number: 'WEB-000003', status: 'delivered', payment_method: 'cod', total: '500.50', courier_name: 'Pathao' }),
]

describe('remittance helpers', () => {
  it('checks the fee against the gross and computes the net exactly', () => {
    expect(feeError('50', '2560.00')).toBeNull()
    expect(feeError('2560.01', '2560.00')).toMatch(/cannot be more/)
    expect(feeError('-1', '10')).toMatch(/non-negative/)
    expect(feeError('1.234', '10')).toMatch(/2 decimals/)
    expect(netOf('2560.50', '50.25')).toBe('2510.25')
  })

  it('reads REMITTANCE_INVALID details', () => {
    const error = new ApiError(422, 'REMITTANCE_INVALID', 'Invalid', { orders: [{ id: 'wo-2', number: 'WEB-000002', reason: 'already_paid' }, 'junk'] })
    expect(invalidOrders(error)).toEqual([{ id: 'wo-2', number: 'WEB-000002', reason: 'already_paid' }])
    expect(invalidOrders(new ApiError(422, 'VALIDATION_FAILED', 'x'))).toEqual([])
  })

  it('maps list filters and formats received days', () => {
    expect(toRemittanceListParams(remittanceFiltersFromSearchParams(new URLSearchParams('courier_id=c-1&from=2026-10-01&to=bad&page=2')))).toEqual({ page: 2, courier_id: 'c-1', date_from: '2026-10-01' })
    expect(formatDay('2026-11-01', 'Asia/Dhaka')).toContain('2026')
  })
})

describe('COD remittances pages', () => {
  it('lists remittances with filters and is in the sidebar for remitters', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(remitter()),
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /shipping/couriers': ok(couriers()),
      'GET /cod-remittances': (_init, url) => {
        queries.push(url.searchParams)
        return paged([remittance()])
      },
    })
    renderRoutes(routes, '/cod-remittances')

    expect(await screen.findByRole('link', { name: 'REM-000001' })).toHaveAttribute('href', '/cod-remittances/rem-1')
    expect(screen.getByRole('link', { name: 'COD remittances' })).toHaveAttribute('href', '/cod-remittances')
    const row = screen.getAllByRole('row')[1]!
    expect(row).toHaveTextContent('Pathao')
    expect(row).toHaveTextContent('PTH-STMT-77')
    expect(row).toHaveTextContent('BDT 2,510.00')
    expect(row).toHaveTextContent('Bank transfer · 2 orders')

    await user.click(screen.getByRole('combobox', { name: 'Filter by courier' }))
    await user.click(await screen.findByRole('option', { name: 'Pathao' }))
    await waitFor(() => expect(queries.at(-1)?.get('courier_id')).toBe('c-1'))
    await user.type(screen.getByLabelText('Received from'), '2026-10-01')
    await waitFor(() => expect(queries.at(-1)?.get('date_from')).toBe('2026-10-01'))
  })

  it('is closed to staff without the remit permission', async () => {
    mockApi({ 'GET /auth/me': ok(orderManager()) })
    renderRoutes(routes, '/cod-remittances')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })

  it('records a remittance: courier, orders with running total, amounts, idempotency key', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | null = null
    let candidateQuery: URLSearchParams | undefined
    mockApi({
      'GET /auth/me': ok(remitter()),
      'GET /shipping/couriers': ok(couriers()),
      'GET /web-orders': (_init, url) => {
        candidateQuery = url.searchParams
        return paged(delivered)
      },
      'POST /cod-remittances': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return { status: 201, ...ok(remittance()) }
      },
      'GET /cod-remittances/rem-1': ok(remittance()),
    })
    const { router } = renderRoutes(routes, '/cod-remittances/new')

    await user.click(await screen.findByLabelText('Courier that paid'))
    await user.click(await screen.findByRole('option', { name: 'Pathao' }))
    const table = await screen.findByRole('table', { name: 'Orders to remit' })
    expect(Object.fromEntries(candidateQuery ?? [])).toEqual({ page: '1', per_page: '100', courier_id: 'c-1', cod_unremitted: '1' })

    await user.click(within(table).getByRole('checkbox', { name: 'Select WEB-000001' }))
    await user.click(within(table).getByRole('checkbox', { name: 'Select WEB-000002' }))
    expect(screen.getByTestId('running-total')).toHaveTextContent('2 orders selected · collected BDT 2,560.00')

    const fee = screen.getByLabelText(/Courier fee/)
    await user.clear(fee)
    await user.type(fee, '9999')
    expect(screen.getByText('The fee cannot be more than the cash collected.')).toBeInTheDocument()
    await user.clear(fee)
    await user.type(fee, '50')
    expect(screen.getByTestId('net-amount')).toHaveTextContent('BDT 2,510.00')
    await user.type(screen.getByLabelText("Courier's statement no. (optional)"), 'PTH-STMT-77')
    const received = screen.getByLabelText('Received on')
    await user.clear(received)
    await user.type(received, '2026-10-30')
    await user.click(screen.getByRole('button', { name: 'Record remittance' }))

    await waitFor(() => expect(body).toEqual({
      courier_id: 'c-1', reference: 'PTH-STMT-77', received_at: '2026-10-30', method: 'bank_transfer', fee_amount: '50', order_ids: ['wo-1', 'wo-2'], note: null,
    }))
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(router.state.location.pathname).toBe('/cod-remittances/rem-1'))
    expect(toastSuccess).toHaveBeenCalledWith('REM-000001 recorded: 2 orders marked paid.')
    expect(await screen.findByRole('heading', { name: 'REM-000001' })).toBeInTheDocument()
  })

  it('shows REMITTANCE_INVALID reasons next to the refused orders and keeps the key for a retry', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    mockApi({
      'GET /auth/me': ok(remitter()),
      'GET /shipping/couriers': ok(couriers()),
      'GET /web-orders': paged(delivered),
      'POST /cod-remittances': (init) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        if (keys.length === 1) return fail(503, 'SERVICE_UNAVAILABLE', 'Down')
        return fail(422, 'REMITTANCE_INVALID', 'Some orders cannot be remitted.', {
          orders: [{ id: 'wo-3', number: 'WEB-000003', reason: 'already_paid' }, { id: 'wo-9', number: 'WEB-000009', reason: 'other_courier' }],
        })
      },
    })
    renderRoutes(routes, '/cod-remittances/new')

    await user.click(await screen.findByLabelText('Courier that paid'))
    await user.click(await screen.findByRole('option', { name: 'Pathao' }))
    const table = await screen.findByRole('table', { name: 'Orders to remit' })
    await user.click(within(table).getByRole('checkbox', { name: 'Select all orders on this page' }))
    expect(screen.getByTestId('running-total')).toHaveTextContent('3 orders selected · collected BDT 3,060.50')

    await user.click(screen.getByRole('button', { name: 'Record remittance' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Down'))
    await user.click(screen.getByRole('button', { name: 'Record remittance' }))

    const alert = await screen.findByRole('alert')
    expect(keys[0]).toBe(keys[1])
    expect(alert).toHaveTextContent('Nothing was recorded: 2 orders can no longer be remitted.')
    expect(alert).toHaveTextContent('WEB-000009: Shipped with another courier')
    expect(within(table).getByTestId('invalid-reason')).toHaveTextContent('Already paid')
    await user.click(within(alert).getByRole('button', { name: 'Remove them from the selection' }))
    expect(screen.getByTestId('running-total')).toHaveTextContent('2 orders selected · collected BDT 2,560.00')
    expect(screen.queryByTestId('invalid-reason')).not.toBeInTheDocument()
  })

  it('says when a courier has nothing to collect', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(remitter()), 'GET /shipping/couriers': ok(couriers()), 'GET /web-orders': paged([]) })
    renderRoutes(routes, '/cod-remittances/new')
    await user.click(await screen.findByLabelText('Courier that paid'))
    await user.click(await screen.findByRole('option', { name: 'Steadfast' }))
    expect(await screen.findByText('Nothing to collect')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record remittance' })).toBeDisabled()
  })

  it('shows a remittance with its orders', async () => {
    mockApi({ 'GET /auth/me': ok(remitter()), 'GET /cod-remittances/rem-1': ok(remittance({ note: 'October statement' })) })
    renderRoutes(routes, '/cod-remittances/rem-1')

    expect(await screen.findByRole('heading', { name: 'REM-000001' })).toBeInTheDocument()
    expect(screen.getByText('PTH-STMT-77')).toBeInTheDocument()
    expect(screen.getByText('October statement')).toBeInTheDocument()
    expect(screen.getByText('EXP-000009')).toBeInTheDocument()
    expect(screen.getByTestId('net-amount')).toHaveTextContent('BDT 2,510.00')
    const lines = screen.getByRole('table', { name: 'Orders in this remittance' })
    expect(within(lines).getByRole('link', { name: 'WEB-000001' })).toHaveAttribute('href', '/web-orders/wo-1')
    expect(within(lines).getByText('BDT 1,000.00')).toBeInTheDocument()
  })
})
