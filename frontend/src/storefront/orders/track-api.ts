import { storeApi } from '../http'
import type { OrderStatus, PaymentMethodCode } from '../types'

/**
 * BD1a §6: GET /store/orders/track?number=&phone= — an order found by its number and the mobile
 * number it was placed with, without an account. Only the status, payment, total, item count, the
 * status history and the courier's tracking: no name, address, lines or e-mail.
 */
export type TrackedOrder = {
  number: string
  status: OrderStatus
  payment_method: PaymentMethodCode | (string & {})
  payment_status: 'unpaid' | 'paid' | (string & {})
  placed_at: string
  total: string
  item_count: number | string
  history: { status: OrderStatus; at: string }[]
  shipment: { courier_name: string | null; tracking_number: string | null; tracking_url: string | null; status: string | null } | null
}

export function trackOrder(number: string, phone: string): Promise<TrackedOrder> {
  return storeApi.get<TrackedOrder>('/store/orders/track', { query: { number, phone } }).then((r) => r.data)
}
