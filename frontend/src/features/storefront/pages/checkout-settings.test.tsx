import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const settings = (guest?: boolean) => ({
  is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null,
  ...(guest === undefined ? {} : { guest_checkout_enabled: guest }),
})

describe('guest checkout setting', () => {
  it('turns guest checkout off', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })),
      'GET /storefront/settings': ok(settings(true)),
      'GET /storefront/domains': ok([]),
      'GET /branches': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
      'PATCH /storefront/settings': (init) => {
        patched = JSON.parse(String(init.body))
        return ok(settings(false))
      },
    })
    renderRoutes(routes, '/storefront')

    const toggle = await screen.findByRole('switch', { name: 'Allow guest checkout' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await waitFor(() => expect(patched).toEqual({ guest_checkout_enabled: false }))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('defaults to on and is read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': ok(settings()),
      'GET /storefront/domains': ok([]),
      'GET /branches': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
    })
    renderRoutes(routes, '/storefront')

    const toggle = await screen.findByRole('switch', { name: 'Allow guest checkout' })
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
  })
})
