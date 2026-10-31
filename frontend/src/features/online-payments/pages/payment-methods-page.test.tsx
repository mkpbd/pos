import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { PaymentGateway } from '@/features/online-payments/api'
import { orderManager } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const gateways = (): PaymentGateway[] => [
  { code: 'bank_transfer', display_name: 'Bank transfer', is_enabled: false, instructions: null, settings: { hold_hours: 48 }, sort_order: 1 },
  { code: 'cod', display_name: 'Cash on delivery', is_enabled: true, instructions: null, settings: { max_order_total: null }, sort_order: 0 },
]

describe('online store payment methods', () => {
  it('enables bank transfer with instructions and a hold time', async () => {
    const user = userEvent.setup()
    let put: { url: string; body: unknown } | undefined
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /payment-gateways': ok(gateways()),
      'PUT /payment-gateways/bank_transfer': (init, url) => {
        put = { url: url.pathname, body: JSON.parse(String(init.body)) }
        return ok({ ...gateways()[0], ...(put.body as object), code: 'bank_transfer' })
      },
    })
    renderRoutes(routes, '/storefront/payments')

    const forms = await screen.findAllByRole('form')
    expect(forms.map((f) => f.getAttribute('aria-label'))).toEqual(['Cash on delivery settings', 'Bank transfer settings'])
    const bank = screen.getByRole('form', { name: 'Bank transfer settings' })

    await user.click(within(bank).getByRole('switch', { name: 'Offer bank transfer at checkout' }))
    const hours = within(bank).getByLabelText('Hold unpaid orders for (hours)')
    await user.clear(hours)
    await user.type(hours, '200')
    await user.click(within(bank).getByRole('button', { name: 'Save bank transfer' }))
    expect(await within(bank).findByText('Whole hours between 1 and 168.')).toBeInTheDocument()
    expect(within(bank).getByText('Tell customers where to send the money.')).toBeInTheDocument()

    await user.clear(hours)
    await user.type(hours, '24')
    await user.type(within(bank).getByLabelText('Instructions'), 'Demo Bank, account 0000000000')
    await user.click(within(bank).getByRole('button', { name: 'Save bank transfer' }))

    await waitFor(() => expect(put?.body).toEqual({
      is_enabled: true, display_name: 'Bank transfer', instructions: 'Demo Bank, account 0000000000', settings: { hold_hours: 24 }, sort_order: 1,
    }))
    expect(put?.url).toBe('/api/v1/payment-gateways/bank_transfer')
  })

  it('limits cash on delivery to a maximum order total', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /payment-gateways': ok(gateways()),
      'PUT /payment-gateways/cod': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ ...gateways()[1], ...(body as object) })
      },
    })
    renderRoutes(routes, '/storefront/payments')

    const cod = await screen.findByRole('form', { name: 'Cash on delivery settings' })
    await user.type(within(cod).getByLabelText('Maximum order total (BDT)'), '10000')
    await user.click(within(cod).getByRole('button', { name: 'Save cash on delivery' }))
    await waitFor(() => expect(body).toEqual({ is_enabled: true, display_name: 'Cash on delivery', instructions: null, settings: { max_order_total: '10000' }, sort_order: 0 }))
  })

  it('needs payment_gateways.manage', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })) })
    renderRoutes(routes, '/storefront/payments')
    expect(await screen.findByText(/permission/i)).toBeInTheDocument()
  })
})
