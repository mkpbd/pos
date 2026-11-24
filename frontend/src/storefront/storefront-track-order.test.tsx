import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, customerFixture } from './test-fixtures'
import type { Customer } from './types'
import type { TrackedOrder } from './orders/track-api'

/* BD1a §8: /track-order — a guest's order by its number and mobile number. */

const tracked = (patch: Partial<TrackedOrder> = {}): TrackedOrder => ({
  number: 'WEB-000123',
  status: 'shipped',
  payment_method: 'cod',
  payment_status: 'unpaid',
  placed_at: '2026-11-20T10:00:00+06:00',
  total: '1250.00',
  item_count: 3,
  history: [
    { status: 'confirmed', at: '2026-11-20T10:00:00+06:00' },
    { status: 'processing', at: '2026-11-21T09:00:00+06:00' },
    { status: 'shipped', at: '2026-11-22T15:30:00+06:00' },
  ],
  shipment: { courier_name: 'Pathao', tracking_number: 'PT-998877', tracking_url: 'https://courier.example/track/PT-998877', status: 'in_transit' },
  ...patch,
})

function serve(me: Customer | null, track: (url: URL) => ReturnType<typeof ok>) {
  const lookups: Record<string, string>[] = []
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(me),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/orders/track': (_init, url) => {
      lookups.push({ number: url.searchParams.get('number') ?? '', phone: url.searchParams.get('phone') ?? '' })
      return track(url)
    },
  })
  return lookups
}

describe('track an order without an account', () => {
  it('prefills the number, checks the fields, says when nothing matches and shows the timeline with the courier link', async () => {
    let attempt = 0
    const lookups = serve(null, () => {
      attempt += 1
      return attempt === 1 ? fail(404, 'ORDER_NOT_FOUND', 'Not found') : ok(tracked())
    })
    renderRoutes(storefrontRoutes, '/track-order?number=WEB-000123')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Track your order' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Track your order | Berry Kids'))
    const number = screen.getByLabelText('Order number')
    expect(number).toHaveValue('WEB-000123')
    expect(within(screen.getByTestId('track-order-page')).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?next=%2Faccount%2Forders')

    await user.click(screen.getByRole('button', { name: 'Track order' }))
    expect(screen.getByLabelText('Mobile number')).toHaveAccessibleDescription('Please enter a mobile number.')
    await user.type(screen.getByLabelText('Mobile number'), '12345')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    expect(screen.getByLabelText('Mobile number')).toHaveAccessibleDescription('Please enter a Bangladeshi mobile number, e.g. 01712345678.')
    expect(lookups).toEqual([])

    await user.clear(screen.getByLabelText('Mobile number'))
    await user.type(screen.getByLabelText('Mobile number'), '+880 1711-223344')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find an order with this number and mobile number. Please check both and try again.')
    expect(lookups).toEqual([{ number: 'WEB-000123', phone: '01711223344' }])

    await user.click(screen.getByRole('button', { name: 'Track order' }))
    const card = await screen.findByTestId('tracked-order')
    expect(within(card).getByRole('heading', { name: 'Order WEB-000123' })).toBeInTheDocument()
    expect(within(card).getByTestId('order-status')).toHaveTextContent('Shipped')
    expect(within(card).getByTestId('tracked-total')).toHaveTextContent('৳1,250.00')
    expect(within(card).getByTestId('tracked-payment')).toHaveTextContent('Cash on delivery · Pay on delivery')
    expect(card).toHaveTextContent('Items3')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const history = screen.getByTestId('order-history')
    expect(within(history).getAllByRole('listitem').map((item) => item.querySelector('span:not([aria-hidden])')?.textContent)).toEqual(['Confirmed', 'Processing', 'Shipped'])
    expect(screen.getByTestId('order-tracking')).toHaveTextContent('PT-998877')
    expect(screen.getByTestId('track-parcel')).toHaveAttribute('href', 'https://courier.example/track/PT-998877')
  })

  it('shows an order without a shipment, and no sign-in hint to a signed-in shopper', async () => {
    serve(customerFixture(), () => ok(tracked({ status: 'confirmed', payment_method: 'bank_transfer', payment_status: 'paid', shipment: null, history: [{ status: 'confirmed', at: '2026-11-20T10:00:00+06:00' }] })))
    renderRoutes(storefrontRoutes, '/track-order')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Order number'), 'web-000123')
    await user.type(screen.getByLabelText('Mobile number'), '01711223344')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    const card = await screen.findByTestId('tracked-order')
    expect(within(card).getByTestId('tracked-payment')).toHaveTextContent('Bank transfer · Paid')
    expect(screen.queryByTestId('order-tracking')).not.toBeInTheDocument()
    expect(screen.queryByText(/to see all your orders/)).not.toBeInTheDocument()
  })

  it('needs the order number', async () => {
    const lookups = serve(null, () => ok(tracked()))
    renderRoutes(storefrontRoutes, '/track-order')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Mobile number'), '01711223344')
    await user.click(screen.getByRole('button', { name: 'Track order' }))
    expect(screen.getByLabelText('Order number')).toHaveAccessibleDescription('Please enter the order number.')
    expect(lookups).toEqual([])
  })
})
