import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { PaymentGateway } from '@/features/online-payments/api'
import { orderManager } from '@/features/web-orders/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const sendMoney = (code: string, name: string, sort: number): PaymentGateway => ({
  code, display_name: name, is_enabled: false, instructions: null, settings: { account_number: null, account_type: 'personal', hold_hours: 24 }, sort_order: sort,
})

const gateways = (): PaymentGateway[] => [
  { code: 'cod', display_name: 'Cash on delivery', is_enabled: true, instructions: null, settings: { max_order_total: null }, sort_order: 0 },
  { code: 'bank_transfer', display_name: 'Bank transfer', is_enabled: false, instructions: null, settings: { hold_hours: 48 }, sort_order: 1 },
  sendMoney('bkash_manual', 'bKash', 2),
  sendMoney('nagad_manual', 'Nagad', 3),
  sendMoney('rocket_manual', 'Rocket', 4),
]

describe('BD1c Send Money payment methods', () => {
  it('lists bKash, Nagad and Rocket and enables bKash with a receiving number', async () => {
    const user = userEvent.setup()
    let put: { url: string; body: unknown } | undefined
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /payment-gateways': ok(gateways()),
      'PUT /payment-gateways/bkash_manual': (init, url) => {
        put = { url: url.pathname, body: JSON.parse(String(init.body)) }
        return ok({ ...gateways()[2], ...(put.body as object) })
      },
    })
    renderRoutes(routes, '/storefront/payments')

    const forms = await screen.findAllByRole('form')
    expect(forms.map((f) => f.getAttribute('aria-label'))).toEqual([
      'Cash on delivery settings', 'Bank transfer settings', 'bKash (Send Money) settings', 'Nagad (Send Money) settings', 'Rocket (Send Money) settings',
    ])
    expect(screen.getByRole('heading', { name: 'bKash, Nagad and Rocket — Send Money' })).toBeInTheDocument()

    const bkash = screen.getByRole('form', { name: 'bKash (Send Money) settings' })
    expect(within(bkash).getByRole('radio', { name: 'Personal' })).toBeChecked()
    await user.click(within(bkash).getByRole('switch', { name: 'Offer bKash (Send Money) at checkout' }))
    await user.click(within(bkash).getByRole('button', { name: 'Save bKash (Send Money)' }))
    expect(await within(bkash).findByText('Enter the number customers send the money to.')).toBeInTheDocument()

    const number = within(bkash).getByLabelText('Receiving number')
    await user.type(number, '12345')
    await user.click(within(bkash).getByRole('button', { name: 'Save bKash (Send Money)' }))
    expect(await within(bkash).findByText('Enter a Bangladeshi mobile number, e.g. 01712345678.')).toBeInTheDocument()

    await user.clear(number)
    await user.type(number, '+880 1712-345678')
    await user.click(within(bkash).getByRole('radio', { name: 'Merchant' }))
    const hours = within(bkash).getByLabelText('Hold unpaid orders for (hours)')
    expect(hours).toHaveValue('24')
    await user.clear(hours)
    await user.type(hours, '12')
    await user.type(within(bkash).getByLabelText('Instructions'), 'Use Payment, reference = order number.')
    await user.click(within(bkash).getByRole('button', { name: 'Save bKash (Send Money)' }))

    await waitFor(() => expect(put?.body).toEqual({
      is_enabled: true,
      display_name: 'bKash',
      instructions: 'Use Payment, reference = order number.',
      settings: { account_number: '01712345678', account_type: 'merchant', hold_hours: 12 },
      sort_order: 2,
    }))
    expect(put?.url).toBe('/api/v1/payment-gateways/bkash_manual')
  })

  it('shows the server’s account number error next to the field', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /payment-gateways': ok(gateways()),
      'PUT /payment-gateways/nagad_manual': fail(422, 'VALIDATION_FAILED', 'Invalid', { 'settings.account_number': ['This number cannot receive Send Money.'] }),
    })
    renderRoutes(routes, '/storefront/payments')

    const nagad = await screen.findByRole('form', { name: 'Nagad (Send Money) settings' })
    await user.type(within(nagad).getByLabelText('Receiving number'), '01812345678')
    await user.click(within(nagad).getByRole('button', { name: 'Save Nagad (Send Money)' }))
    expect(await within(nagad).findByText('This number cannot receive Send Money.')).toBeInTheDocument()
  })
})
