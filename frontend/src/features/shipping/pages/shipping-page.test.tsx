import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { ShippingZone } from '@/features/shipping/api'
import { orderManager } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: toastSuccess }) }
})

beforeEach(() => toastSuccess.mockReset())

const divisions = [{ id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }, { id: 2, name: 'Chattogram', name_bn: 'চট্টগ্রাম' }]
const districts = [
  { id: 26, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' },
  { id: 47, division_id: 3, name: 'Gazipur', name_bn: 'গাজীপুর' },
  { id: 12, division_id: 2, name: 'Cumilla', name_bn: 'কুমিল্লা' },
  { id: 15, division_id: 2, name: 'Chattogram', name_bn: 'চট্টগ্রাম' },
]

const insideDhaka = (): ShippingZone => ({
  id: 'z-1', name: 'Inside Dhaka', is_active: true, sort_order: 0, districts: [{ id: 26, name: 'Dhaka' }],
  methods: [{ id: 'sm-1', zone_id: 'z-1', name: 'Home delivery', description: null, fee: '60.00', free_over: '2000.00', cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2, is_active: true, sort_order: 0 }],
})

const geo = { 'GET /geography/divisions': ok(divisions), 'GET /geography/districts': ok(districts) }

describe('shipping zones', () => {
  it('creates a zone from districts by division, locking districts of other zones', async () => {
    const user = userEvent.setup()
    let zones = [insideDhaka()]
    let created: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/zones': () => ok(zones),
      ...geo,
      'POST /shipping/zones': (init) => {
        created = JSON.parse(String(init.body))
        const zone = { id: 'z-2', name: 'Outside Dhaka', is_active: true, sort_order: 1, districts: [{ id: 47, name: 'Gazipur' }, { id: 12, name: 'Cumilla' }, { id: 15, name: 'Chattogram' }], methods: [] }
        zones = [...zones, zone]
        return { status: 201, ...ok(zone) }
      },
    })
    renderRoutes(routes, '/storefront/shipping')

    expect(await screen.findByText('Inside Dhaka')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Shipping' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('table', { name: 'Delivery methods in Inside Dhaka' })).getByText('BDT 60.00 · free over BDT 2,000.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New zone' }))
    const dialog = await screen.findByRole('dialog', { name: 'New shipping zone' })
    const dhaka = await within(dialog).findByRole('checkbox', { name: 'Dhaka' })
    expect(dhaka).toBeDisabled()
    expect(within(dialog).getByText('in Inside Dhaka')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Zone name'), 'Outside Dhaka')
    await user.click(within(dialog).getByRole('checkbox', { name: 'All of Chattogram division' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'All of Dhaka division' }))
    expect(dhaka).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Gazipur' })).toBeChecked()
    expect(within(dialog).getByText('(3 selected)')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Create zone' }))

    await waitFor(() => expect(created).toEqual({ name: 'Outside Dhaka', is_active: true, sort_order: 1, district_ids: [12, 15, 47] }))
    expect(toastSuccess).toHaveBeenCalledWith('Outside Dhaka saved.')
    expect(await screen.findByText('Outside Dhaka')).toBeInTheDocument()
  })

  it('explains a district taken by another zone meanwhile', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/zones': ok([insideDhaka()]),
      ...geo,
      'PATCH /shipping/zones/z-1': fail(422, 'DISTRICT_IN_OTHER_ZONE', 'District already in a zone.', { district_ids: [47] }),
    })
    renderRoutes(routes, '/storefront/shipping')

    await user.click(await screen.findByRole('button', { name: 'Edit zone' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Inside Dhaka' })
    expect(await within(dialog).findByRole('checkbox', { name: 'Dhaka' })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Gazipur' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save zone' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Remove Gazipur')
  })

  it('adds, edits and deletes delivery methods', async () => {
    const user = userEvent.setup()
    let created: unknown
    let patched: unknown
    let deleted = false
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/zones': ok([insideDhaka()]),
      ...geo,
      'POST /shipping/zones/z-1/methods': (init) => {
        created = JSON.parse(String(init.body))
        return { status: 201, ...ok({ id: 'sm-2', ...(created as object) }) }
      },
      'PATCH /shipping/methods/sm-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ id: 'sm-1', ...(patched as object) })
      },
      'DELETE /shipping/methods/sm-1': () => {
        deleted = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/storefront/shipping')

    await user.click(await screen.findByRole('button', { name: 'Add method' }))
    let dialog = await screen.findByRole('dialog', { name: 'New delivery method in Inside Dhaka' })
    await user.type(within(dialog).getByLabelText('Name'), 'Express')
    await user.clear(within(dialog).getByLabelText('Delivery fee (BDT)'))
    await user.type(within(dialog).getByLabelText('Delivery fee (BDT)'), '150')
    await user.clear(within(dialog).getByLabelText('Delivery to (days)'))
    await user.type(within(dialog).getByLabelText('Delivery to (days)'), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Add method' }))
    expect(await within(dialog).findByText('At least the minimum.')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Delivery to (days)'))
    await user.type(within(dialog).getByLabelText('Delivery to (days)'), '1')
    await user.click(within(dialog).getByRole('switch', { name: 'Cash on delivery allowed' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add method' }))
    await waitFor(() => expect(created).toEqual({
      name: 'Express', description: null, fee: '150', free_over: null, cod_allowed: false, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 1, is_active: true, sort_order: 1,
    }))

    await user.click(screen.getByRole('button', { name: 'Edit Home delivery' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Home delivery' })
    await user.clear(within(dialog).getByLabelText('COD fee (BDT)'))
    await user.type(within(dialog).getByLabelText('COD fee (BDT)'), '20')
    await user.click(within(dialog).getByRole('button', { name: 'Save method' }))
    await waitFor(() => expect(patched).toMatchObject({ name: 'Home delivery', fee: '60.00', free_over: '2000.00', cod_allowed: true, cod_fee: '20' }))

    await user.click(screen.getByRole('button', { name: 'Delete Home delivery' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Home delivery?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('shows the Shipping and Payments tabs only to their managers', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': ok({ is_enabled: false, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, guest_checkout_enabled: true, updated_at: null }),
      'GET /storefront/domains': ok([]),
    })
    renderRoutes(routes, '/storefront')
    expect(await screen.findByRole('link', { name: 'Settings & domains' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Shipping' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument()
  })
})
