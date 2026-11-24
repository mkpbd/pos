import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { StaffQuoteInput } from '@/features/web-orders/order-entry-api'
import { districts, divisions, orderClerk, quote, romperProduct } from '@/features/web-orders/order-entry-test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

describe('BD1c new order form: Send Money payment choice', () => {
  it('offers the Send Money methods with their names and explains the wait for the transaction ID', async () => {
    const user = userEvent.setup()
    const quotes: StaffQuoteInput[] = []
    mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /geography/divisions': ok(divisions),
      'GET /geography/districts': ok(districts),
      'GET /products': paged([romperProduct]),
      'POST /web-orders/quote': (init) => {
        const input = JSON.parse(String(init.body)) as StaffQuoteInput
        quotes.push(input)
        return ok(quote({
          payment_method: input.payment_method ?? null,
          payment_methods: [
            { code: 'cod', name: 'Cash on delivery' },
            { code: 'bkash_manual', name: 'bKash (Send Money)' },
            // An older server without a name still reads well.
            { code: 'nagad_manual', name: '' },
          ],
        }))
      },
    })
    renderRoutes(routes, '/web-orders/new')

    expect(await screen.findByRole('heading', { name: 'New order' })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Add a product' }))
    await user.click(await screen.findByRole('option', { name: /Baby Romper — Size M/ }))

    const bkash = await screen.findByRole('radio', { name: 'bKash (Send Money)' }, { timeout: 4000 })
    expect(screen.getByRole('radio', { name: 'Nagad (Send Money)' })).toBeInTheDocument()
    expect(screen.queryByTestId('send-money-note')).not.toBeInTheDocument()
    await user.click(bkash)
    expect(screen.getByTestId('send-money-note')).toHaveTextContent('waits as Awaiting payment until you confirm the customer\'s transaction ID')
    await waitFor(() => expect(quotes.at(-1)?.payment_method).toBe('bkash_manual'), { timeout: 4000 })
  })
})
