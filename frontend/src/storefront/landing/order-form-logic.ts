import { ApiError } from '@/lib/api/client'
import { BD_MOBILE, normalizeBdPhone } from '../account/schemas'
import { loginPathFor } from '../account/safe-next'
import type { OrderFormEmailField, OrderFormNoteField } from '../builder/types'
import { isEmailAddress } from '../builder/validate'
import type { MessageKey } from '../i18n/en'
import type { Translate } from '../i18n/translate'
import type { CheckoutPreview, GeoId, OrderView, PaymentMethodCode, ProductDetail, ProductVariant } from '../types'
import type { Attribution } from './attribution'

/*
 * P2a one-product order form: the shopper's answers, checked in the browser the way the server
 * checks them, the bodies of POST /store/checkout/direct(/preview), and what a failed placement
 * tells the shopper. Pure (unit-tested); the element is ./order-form.tsx.
 */

export type DirectLine = { variant_id: string; quantity: number }

/** POST /store/checkout/direct/preview — partial input is fine; the answer has the checkout preview's shape. */
export type DirectPreviewInput = {
  document_id: string
  element_id: string
  lines: DirectLine[]
  address?: { district_id: GeoId }
  shipping_method_id?: string
  payment_method?: PaymentMethodCode
}

/** POST /store/checkout/direct (with an Idempotency-Key). */
export type DirectOrderInput = {
  document_id: string
  element_id: string
  lines: DirectLine[]
  contact: { name: string; phone: string; email?: string }
  address: { district_id: GeoId; division_id?: GeoId; area?: string; address_line: string }
  shipping_method_id: string
  payment_method: PaymentMethodCode
  note?: string
  expected_total: string
  attribution?: Attribution
}

/** 201 of POST /store/checkout/direct: the order, a guest's access token and the order page link (with the token). */
export type DirectPlacedOrder = { order: OrderView; access_token: string | null; order_url?: string | null }

/** The shopper's answers (text as typed). */
export type OrderFormValues = {
  name: string
  phone: string
  email: string
  division_id: string
  district_id: string
  area: string
  address_line: string
  note: string
  shipping_method_id: string
  payment_method: string
}

export type OrderFormField = keyof OrderFormValues | 'variant' | 'quantity'

/** The fields in the order they appear (the error summary lists them in this order). */
export const ORDER_FORM_FIELDS: readonly OrderFormField[] = [
  'variant',
  'quantity',
  'name',
  'phone',
  'email',
  'division_id',
  'district_id',
  'area',
  'address_line',
  'shipping_method_id',
  'payment_method',
  'note',
]

export const EMPTY_VALUES: OrderFormValues = {
  name: '',
  phone: '',
  email: '',
  division_id: '',
  district_id: '',
  area: '',
  address_line: '',
  note: '',
  shipping_method_id: '',
  payment_method: '',
}

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Bengali digits as Latin ones ("০১৭১১…" → "01711…"): Bangla keyboards type them. */
export function latinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)))
}

/** A typed mobile number as the server keeps it (01XXXXXXXXX), or the trimmed text when it is not one. */
export function normalizePhone(value: string): string {
  return normalizeBdPhone(latinDigits(value.trim()))
}

export type OrderFormRules = { email: OrderFormEmailField; note: OrderFormNoteField }

/** Every field's problem (a message key); empty = ready to place. */
export function orderFormErrors(values: OrderFormValues, rules: OrderFormRules, variant: ProductVariant | null): Partial<Record<OrderFormField, MessageKey>> {
  const errors: Partial<Record<OrderFormField, MessageKey>> = {}
  if (!variant) errors.variant = 'landing.orderForm.errorVariant'
  else if (!variant.in_stock) errors.variant = 'landing.orderForm.errorSoldOut'
  const name = values.name.trim()
  if (name.length < 2) errors.name = 'checkout.validation.name'
  else if (name.length > 120) errors.name = 'checkout.validation.max120'
  if (values.phone.trim() === '') errors.phone = 'checkout.validation.phoneRequired'
  else if (!BD_MOBILE.test(normalizePhone(values.phone))) errors.phone = 'checkout.validation.phoneInvalid'
  const email = values.email.trim()
  if (rules.email !== 'hidden') {
    if (email === '') {
      if (rules.email === 'required') errors.email = 'checkout.validation.emailRequired'
    } else if (!isEmailAddress(email)) errors.email = 'checkout.validation.emailInvalid'
  }
  if (values.division_id === '') errors.division_id = 'checkout.validation.division'
  if (values.district_id === '') errors.district_id = 'checkout.validation.district'
  if (values.area.trim().length > 100) errors.area = 'checkout.validation.max100'
  const line = values.address_line.trim()
  if (line.length < 3) errors.address_line = 'landing.orderForm.errorAddress'
  else if (line.length > 255) errors.address_line = 'checkout.validation.max255'
  // Delivery methods appear once the district is chosen (its own error says so first).
  if (values.district_id !== '' && values.shipping_method_id === '') errors.shipping_method_id = 'checkout.validation.shippingMethod'
  if (values.payment_method !== 'cod' && values.payment_method !== 'bank_transfer') errors.payment_method = 'checkout.validation.paymentMethod'
  if (rules.note !== 'hidden' && values.note.trim().length > 500) errors.note = 'checkout.validation.max500'
  return errors
}

/** The variant to start with: the default one when it is in stock, else the first in stock, else the default. */
export function startVariant(product: Pick<ProductDetail, 'variants' | 'default_variant_id'>): ProductVariant | null {
  const preferred = product.variants.find((v) => v.id === product.default_variant_id) ?? product.variants[0] ?? null
  if (preferred?.in_stock) return preferred
  return product.variants.find((v) => v.in_stock) ?? preferred
}

/** The add-on's variant (its default one, else the first in stock), or null when none can be ordered. */
export function upsellVariant(product: ProductDetail | null): ProductVariant | null {
  if (!product || !Array.isArray(product.variants)) return null
  const variant = startVariant(product)
  return variant?.in_stock ? variant : null
}

/** The highest quantity the shopper may choose: the element's maximum, lower when little is left in stock. */
export function maxQuantity(elementMax: number, variant: ProductVariant | null): number {
  const max = Math.max(1, Math.min(20, Math.floor(elementMax) || 1))
  const left = variant?.stock_left
  return typeof left === 'number' && left > 0 ? Math.min(max, Math.floor(left)) : max
}

/** The order lines: the product, plus the add-on (always one) when ticked. */
export function orderLines(variant: ProductVariant | null, quantity: number, upsell: ProductVariant | null): DirectLine[] {
  if (!variant) return []
  const lines: DirectLine[] = [{ variant_id: variant.id, quantity }]
  if (upsell) lines.push({ variant_id: upsell.id, quantity: 1 })
  return lines
}

/** Ids go back exactly as the server sent them (number or string). */
export type GeoIdLookup = (kind: 'division' | 'district', value: string) => GeoId

/** The pricing part of the form for the preview. */
export function toDirectPreviewInput(
  base: { documentId: string; elementId: string; lines: DirectLine[] },
  values: Pick<OrderFormValues, 'district_id' | 'shipping_method_id' | 'payment_method'>,
  geoId: GeoIdLookup,
): DirectPreviewInput {
  const input: DirectPreviewInput = { document_id: base.documentId, element_id: base.elementId, lines: base.lines }
  if (values.district_id) input.address = { district_id: geoId('district', values.district_id) }
  if (values.shipping_method_id) input.shipping_method_id = values.shipping_method_id
  if (values.payment_method === 'cod' || values.payment_method === 'bank_transfer') input.payment_method = values.payment_method
  return input
}

/** The body of POST /store/checkout/direct from checked values and the total the shopper saw. */
export function toDirectOrderInput(
  base: { documentId: string; elementId: string; lines: DirectLine[] },
  values: OrderFormValues,
  rules: OrderFormRules,
  expectedTotal: string,
  geoId: GeoIdLookup,
  attribution: Attribution | null,
): DirectOrderInput {
  const input: DirectOrderInput = {
    document_id: base.documentId,
    element_id: base.elementId,
    lines: base.lines,
    contact: { name: values.name.trim(), phone: normalizePhone(values.phone) },
    address: { district_id: geoId('district', values.district_id), division_id: geoId('division', values.division_id), address_line: values.address_line.trim() },
    shipping_method_id: values.shipping_method_id,
    payment_method: values.payment_method as PaymentMethodCode,
    expected_total: expectedTotal,
  }
  const email = values.email.trim()
  if (rules.email !== 'hidden' && email) input.contact.email = email
  const area = values.area.trim()
  if (area) input.address.area = area
  const note = values.note.trim()
  if (rules.note !== 'hidden' && note) input.note = note
  if (attribution) input.attribution = attribution
  return input
}

/** Server field keys (422 details) → form fields. */
const SERVER_FIELDS: Record<string, OrderFormField> = {
  'contact.name': 'name',
  'contact.phone': 'phone',
  'contact.email': 'email',
  'address.division_id': 'division_id',
  'address.district_id': 'district_id',
  'address.area': 'area',
  'address.address_line': 'address_line',
  address: 'address_line',
  shipping_method_id: 'shipping_method_id',
  payment_method: 'payment_method',
  note: 'note',
  'lines.0.variant_id': 'variant',
  'lines.0.quantity': 'quantity',
  lines: 'variant',
}

/** "contact.phone" → phone; null for keys the form does not show. */
export function orderFormFieldFor(serverKey: string): OrderFormField | null {
  return SERVER_FIELDS[serverKey] ?? SERVER_FIELDS[serverKey.replace(/\.\d+$/, '')] ?? null
}

/** What the form tells the shopper after a failed "Confirm order". */
export type OrderProblem = { code: string; message: string; field?: OrderFormField; link?: { to: string; label: string } }

export function orderProblem(error: unknown, t: Translate, pathname: string): OrderProblem {
  const retry = { code: 'RETRY', message: t('landing.orderForm.problem.retry') }
  if (!(error instanceof ApiError)) return retry
  switch (error.code) {
    case 'ORDER_FORM_UNAVAILABLE':
      return { code: error.code, message: t('landing.orderForm.problem.unavailable') }
    case 'ITEMS_UNAVAILABLE':
      return { code: error.code, message: t('landing.orderForm.problem.itemsUnavailable'), field: 'variant' }
    case 'INSUFFICIENT_STOCK':
      return { code: error.code, message: t('landing.orderForm.problem.stock'), field: 'quantity' }
    case 'CHECKOUT_UNAVAILABLE':
      return { code: error.code, message: t('checkout.problem.checkoutUnavailable') }
    case 'SHIPPING_UNAVAILABLE':
      return { code: error.code, message: t('checkout.problem.shippingUnavailable'), field: 'shipping_method_id' }
    case 'PAYMENT_METHOD_UNAVAILABLE':
      return { code: error.code, message: t('checkout.problem.paymentUnavailable'), field: 'payment_method' }
    case 'GUEST_CHECKOUT_DISABLED':
      return { code: error.code, message: t('landing.orderForm.problem.signIn'), link: { to: loginPathFor(pathname), label: t('checkout.problem.signIn') } }
    case 'TOTAL_CHANGED':
      return { code: error.code, message: t('checkout.problem.totalChanged') }
    case 'VALIDATION_FAILED':
      return { code: error.code, message: t('checkout.problem.checkFields') }
    case 'IDEMPOTENCY_REQUEST_IN_PROGRESS':
      return { code: error.code, message: t('landing.orderForm.problem.inProgress') }
  }
  if (error.status === 429) return { code: 'RATE_LIMITED', message: t('checkout.problem.tooManyAttempts') }
  if (error.status === 419) return { code: 'SESSION_EXPIRED', message: t('checkout.problem.sessionExpired') }
  if (error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE') return retry
  return { code: error.code, message: t('checkout.problem.failed') }
}

/** The fresh preview a 409 TOTAL_CHANGED or 422 ITEMS_UNAVAILABLE carries (details.preview), when it has one. */
export function freshPreview(error: unknown): CheckoutPreview | null {
  if (!(error instanceof ApiError) || (error.code !== 'TOTAL_CHANGED' && error.code !== 'ITEMS_UNAVAILABLE')) return null
  const preview = error.details.preview
  return preview && typeof preview === 'object' && 'total' in preview ? (preview as CheckoutPreview) : null
}

/** The order page link: the server's (with the guest token), else the plain order page (the token is kept for this tab). */
export function orderLink(placed: DirectPlacedOrder): string {
  const url = placed.order_url
  if (typeof url === 'string' && /^\/order\/[^/?#]+(\?token=[A-Za-z0-9._~-]+)?$/.test(url)) return url
  return `/order/${encodeURIComponent(placed.order.number)}`
}
