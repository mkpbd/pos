import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Courier } from '@/features/shipping/api'
import { courierSchema, toCourierInput, trackingUrl } from '@/features/shipping/shipping'
import { couriers, orderManager } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('courier helpers', () => {
  it('validates the tracking link template', () => {
    const base = { name: 'Pathao', phone: '', is_active: true, sort_order: 0 }
    expect(courierSchema.safeParse({ ...base, tracking_url_template: '' }).success).toBe(true)
    expect(courierSchema.safeParse({ ...base, tracking_url_template: 'https://x.test/t?id={tracking}' }).success).toBe(true)
    expect(courierSchema.safeParse({ ...base, tracking_url_template: 'https://x.test/t' }).success).toBe(false)
    expect(courierSchema.safeParse({ ...base, tracking_url_template: 'javascript:alert({tracking})' }).success).toBe(false)
    expect(courierSchema.safeParse({ ...base, name: ' ', tracking_url_template: '' }).success).toBe(false)
    expect(toCourierInput({ ...base, tracking_url_template: '' })).toEqual({ name: 'Pathao', phone: null, tracking_url_template: null, is_active: true, sort_order: 0 })
  })

  it('builds the tracking link with the url-encoded number', () => {
    expect(trackingUrl('https://x.test/t?id={tracking}', 'A 1/2')).toBe('https://x.test/t?id=A%201%2F2')
    expect(trackingUrl(null, 'A1')).toBeNull()
    expect(trackingUrl('https://x.test/t?id={tracking}', null)).toBeNull()
  })
})

describe('couriers tab', () => {
  it('lists couriers next to the zones tab and adds one', async () => {
    const user = userEvent.setup()
    let list: Courier[] = couriers()
    let created: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/couriers': () => ok(list),
      'POST /shipping/couriers': (init) => {
        created = JSON.parse(String(init.body))
        const courier = { id: 'c-4', ...(created as Omit<Courier, 'id'>) }
        list = [...list, courier]
        return { status: 201, ...ok(courier) }
      },
    })
    renderRoutes(routes, '/storefront/shipping/couriers')

    const table = await screen.findByRole('table', { name: 'Couriers' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['Pathao09610003030', 'Steadfast', 'RedX'])
    expect(screen.getByRole('link', { name: 'Couriers' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Zones & methods' })).toHaveAttribute('href', '/storefront/shipping')
    expect(screen.getByRole('switch', { name: 'RedX active' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'New courier' }))
    const dialog = await screen.findByRole('dialog', { name: 'New courier' })
    await user.type(within(dialog).getByLabelText('Name'), 'eCourier')
    await user.type(within(dialog).getByLabelText('Tracking link (optional)'), 'https://ecourier.test/track')
    await user.click(within(dialog).getByRole('button', { name: 'Add courier' }))
    expect(await within(dialog).findByText('Must contain {tracking} where the tracking number goes.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Tracking link (optional)'), '?id={{tracking}')
    expect(within(dialog).getByText('https://ecourier.test/track?id=ABC123')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add courier' }))

    await waitFor(() => expect(created).toEqual({ name: 'eCourier', phone: null, tracking_url_template: 'https://ecourier.test/track?id={tracking}', is_active: true, sort_order: 3 }))
    expect(toastSuccess).toHaveBeenCalledWith('eCourier saved.')
    expect(await screen.findByText('eCourier')).toBeInTheDocument()
  })

  it('switches a courier off and on', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/couriers': ok(couriers()),
      'PATCH /shipping/couriers/c-2': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...couriers()[1], is_active: false })
      },
    })
    renderRoutes(routes, '/storefront/shipping/couriers')

    await user.click(await screen.findByRole('switch', { name: 'Steadfast active' }))
    await waitFor(() => expect(patched).toEqual({ is_active: false }))
    expect(toastSuccess).toHaveBeenCalledWith('Steadfast switched off.')
  })

  it('edits a courier', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/couriers': ok(couriers()),
      'PATCH /shipping/couriers/c-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...couriers()[0], phone: '0170' })
      },
    })
    renderRoutes(routes, '/storefront/shipping/couriers')

    await user.click(await screen.findByRole('button', { name: 'Edit Pathao' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Pathao' })
    const phone = within(dialog).getByLabelText('Phone (optional)')
    await user.clear(phone)
    await user.type(phone, '0170')
    await user.click(within(dialog).getByRole('button', { name: 'Save courier' }))
    await waitFor(() => expect(patched).toMatchObject({ name: 'Pathao', phone: '0170', tracking_url_template: 'https://merchant.pathao.com/tracking?consignment_id={tracking}' }))
  })

  it('explains that a courier with shipments cannot be deleted', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/couriers': ok(couriers()),
      'DELETE /shipping/couriers/c-1': fail(409, 'IN_USE', 'Courier is in use.'),
    })
    renderRoutes(routes, '/storefront/shipping/couriers')

    await user.click(await screen.findByRole('button', { name: 'Delete Pathao' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Pathao?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Pathao has shipments, so it cannot be deleted')))
  })

  it('needs shipping management rights', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['web_orders.view'] })) })
    renderRoutes(routes, '/storefront/shipping/couriers')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})
