import type { Cart, CartLine, OrderView, ProductDetail, ProductVariant } from '../types'
import { track, type CommerceData, type TrackItem } from './track'

/*
 * BD1c: the pixel events' data from what the pages already have. Ids are SKUs (a variant's id when
 * it has none); amounts are the server's decimal strings as numbers — for the ad pixels only,
 * never for anything the shop charges.
 */

const amount = (value: string | number | null | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

const total = (items: TrackItem[]) => Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100

/** A product (the chosen variant, else its default one) at today's price, one unit. */
export function productData(product: Pick<ProductDetail, 'id' | 'name' | 'price' | 'variants' | 'default_variant_id'>, variant: Pick<ProductVariant, 'id' | 'sku' | 'price' | 'promo_price'> | null, currency: string | null, quantity = 1): CommerceData {
  const chosen = variant ?? product.variants.find((v) => v.id === product.default_variant_id) ?? product.variants[0] ?? null
  const price = amount(chosen ? (chosen.promo_price ?? chosen.price) : product.price)
  const items = [{ id: chosen?.sku || chosen?.id || product.id, name: product.name, price, quantity }]
  return { currency, value: total(items), items }
}

function cartItem(line: Pick<CartLine, 'sku' | 'variant_id' | 'product' | 'unit_price' | 'quantity'>, quantity?: number): TrackItem {
  return { id: line.sku || line.variant_id, name: line.product?.name ?? '', price: amount(line.unit_price), quantity: quantity ?? amount(line.quantity) }
}

/** The whole cart (begin checkout): its purchasable lines and total. */
export function cartData(cart: Pick<Cart, 'items' | 'total' | 'currency'>): CommerceData {
  const items = (Array.isArray(cart.items) ? cart.items : []).filter((line) => line.purchasable !== false).map((line) => cartItem(line))
  return { currency: cart.currency, value: amount(cart.total) || total(items), items }
}

/** A finished order (purchase). */
export function orderData(order: Pick<OrderView, 'lines' | 'total' | 'currency'>): CommerceData {
  const items = (Array.isArray(order.lines) ? order.lines : []).map((line) => ({ id: line.sku, name: line.product_name, price: amount(line.unit_price), quantity: amount(line.quantity) }))
  return { currency: order.currency, value: amount(order.total), items }
}

/** After a successful add: the added line (from the repriced cart) and the quantity added. */
export function trackAddToCart(cart: Cart | null | undefined, input: { variant_id: string; quantity: string }): void {
  try {
    const line = cart?.items?.find((item) => item.variant_id === input.variant_id)
    if (!line) return
    const items = [cartItem(line, amount(input.quantity) || 1)]
    track('add_to_cart', { currency: cart?.currency ?? null, value: total(items), items })
  } catch {
    // Reporting never breaks adding to the cart.
  }
}

/** An order placed (thank-you page, landing-page thanks): sent once per order. */
export function trackPurchase(order: Pick<OrderView, 'number' | 'lines' | 'total' | 'currency'>): void {
  try {
    track('purchase', { ...orderData(order), order_number: order.number })
  } catch {
    // Never breaks the thank-you page.
  }
}
