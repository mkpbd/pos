import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { StorefrontSettings } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/** P2b: share buttons and WhatsApp in Online store → Settings & domains. */

const base: StorefrontSettings = { is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null }

describe('sharing & WhatsApp settings', () => {
  it('switches share buttons off and saves a WhatsApp number in the server’s form', async () => {
    const user = userEvent.setup()
    let settings: StorefrontSettings = { ...base }
    const patches: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })),
      'GET /storefront/settings': () => ok(settings),
      'GET /storefront/domains': ok([]),
      'PATCH /storefront/settings': (init) => {
        const input = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(input)
        settings = { ...settings, ...input, ...(typeof input.whatsapp_number === 'string' ? { whatsapp_number: '8801712345678' } : {}) }
        return ok(settings)
      },
    })
    renderRoutes(routes, '/storefront')

    // Defaults: everything on; the WhatsApp buttons wait for a number.
    const share = await screen.findByRole('switch', { name: 'Show share buttons' })
    expect(share).toBeChecked()
    expect(screen.getByRole('switch', { name: '“Order on WhatsApp” button on product pages' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Floating WhatsApp chat button' })).toBeChecked()
    expect(screen.getAllByText(/Shown once a WhatsApp number is saved/)).toHaveLength(2)

    await user.click(share)
    await waitFor(() => expect(patches).toEqual([{ share_buttons: false }]))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Show share buttons' })).not.toBeChecked())

    const number = screen.getByLabelText('WhatsApp number')
    await user.type(number, '12345')
    await user.click(screen.getByRole('button', { name: 'Save number' }))
    expect(await screen.findByText('Enter a mobile number like 01712345678 or +8801712345678.')).toBeInTheDocument()
    expect(patches).toHaveLength(1)

    await user.clear(number)
    await user.type(number, '017 1234-5678')
    await user.click(screen.getByRole('button', { name: 'Save number' }))
    await waitFor(() => expect(patches.at(-1)).toEqual({ whatsapp_number: '01712345678' }))
    await waitFor(() => expect(screen.getByLabelText('WhatsApp number')).toHaveValue('+8801712345678'))
    expect(screen.getByRole('link', { name: /Try the chat link/ })).toHaveAttribute('href', 'https://wa.me/8801712345678')
    expect(screen.queryByText(/Shown once a WhatsApp number is saved/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Floating WhatsApp chat button' }))
    await waitFor(() => expect(patches.at(-1)).toEqual({ whatsapp_chat_button: false }))
  })

  it('shows the server’s refusal of a number', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })),
      'GET /storefront/settings': ok(base),
      'GET /storefront/domains': ok([]),
      'PATCH /storefront/settings': fail(422, 'VALIDATION_FAILED', 'Invalid', { whatsapp_number: ['This number cannot be used.'] }),
    })
    renderRoutes(routes, '/storefront')

    await user.type(await screen.findByLabelText('WhatsApp number'), '+447911123456')
    await user.click(screen.getByRole('button', { name: 'Save number' }))
    expect(await screen.findByText('This number cannot be used.')).toBeInTheDocument()
  })

  it('is read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': ok({ ...base, share_buttons: false, whatsapp_number: '8801712345678', whatsapp_order_button: false }),
      'GET /storefront/domains': ok([]),
    })
    renderRoutes(routes, '/storefront')

    expect(await screen.findByRole('switch', { name: 'Show share buttons' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Show share buttons' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: '“Order on WhatsApp” button on product pages' })).not.toBeChecked()
    expect(screen.getByLabelText('WhatsApp number')).toHaveValue('+8801712345678')
    expect(screen.getByLabelText('WhatsApp number')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save number' })).not.toBeInTheDocument()
  })
})
