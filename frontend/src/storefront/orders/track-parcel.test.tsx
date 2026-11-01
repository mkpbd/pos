import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { orderFixture } from '../test-fixtures'
import { OrderDeliveryCard, OrderTimeline } from './order-view'

const shipped = (tracking_url: string | null) => ({
  ...orderFixture(),
  courier_name: 'Pathao',
  tracking_number: 'PT 123',
  tracking_url,
})

describe('Track parcel link (E10a)', () => {
  it('links the courier tracking page in a new tab on the order status page', () => {
    render(<OrderDeliveryCard order={shipped('https://merchant.pathao.com/tracking?consignment_id=PT%20123')} />)
    expect(screen.getByTestId('order-courier')).toHaveTextContent('Pathao, tracking number PT 123')
    const link = screen.getByRole('link', { name: /Track parcel/ })
    expect(link).toHaveAttribute('href', 'https://merchant.pathao.com/tracking?consignment_id=PT%20123')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('links it under the timeline of the account order page', () => {
    render(<OrderTimeline order={shipped('https://merchant.pathao.com/tracking?consignment_id=PT%20123')} withTracking />)
    expect(screen.getByTestId('order-tracking')).toHaveTextContent('Shipped with Pathao — tracking number PT 123')
    expect(screen.getByRole('link', { name: /Track parcel/ })).toBeInTheDocument()
  })

  it('shows no link without a tracking page or for unsafe addresses', () => {
    const { unmount } = render(<OrderDeliveryCard order={shipped(null)} />)
    expect(screen.queryByRole('link', { name: /Track parcel/ })).not.toBeInTheDocument()
    unmount()
    render(<OrderDeliveryCard order={shipped('javascript:alert(1)')} />)
    expect(screen.queryByRole('link', { name: /Track parcel/ })).not.toBeInTheDocument()
  })
})
