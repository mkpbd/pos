import type { WebOrder, WebPaymentMethod } from '@/features/web-orders/api'
import type {
  EditOrderInput,
  OrderChannel,
  OrderEdit,
  QuoteLine,
  StaffOrderInput,
  StaffQuote,
  StaffQuoteInput,
} from '@/features/web-orders/order-entry-api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, formatMoney, trimDecimal } from '@/lib/money'
import { normalizedMobile } from '@/features/web-orders/risk'

/** BD1b order entry and edit: the form's draft and how it becomes the quote and save bodies. */

export const CHANNEL_LABELS: Record<OrderChannel, string> = {
  phone: 'Phone',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  walk_in: 'Walk-in',
  other: 'Other',
}

export function channelLabel(channel: string | null | undefined): string | null {
  if (!channel) return null
  return CHANNEL_LABELS[channel as OrderChannel] ?? channel.replaceAll('_', ' ')
}

/** "Staff · Phone" for a staff-entered order; null for shop orders. */
export function staffSourceLabel(order: { source?: string | null; channel?: string | null }): string | null {
  if (order.source !== 'staff') return null
  const channel = channelLabel(order.channel)
  return channel ? `Staff · ${channel}` : 'Staff'
}

export type DraftCustomer = { id: string; name: string; code: string | null; phone: string | null; email: string | null }

export type DraftLine = { variant_id: string; label: string; sku: string | null; quantity: string }

export type OrderDraft = {
  customer: DraftCustomer | null
  contact: { name: string; phone: string; email: string }
  lines: DraftLine[]
  address: { recipient_name: string; phone: string; division_id: number | null; district_id: number | null; area: string; address_line: string; postcode: string }
  /** Until the recipient is typed in, it follows the contact. */
  recipientEdited: boolean
  shipping_method_id: string
  payment_method: WebPaymentMethod | ''
  channel: OrderChannel | ''
  coupon_code: string
  notes: string
  reason: string
}

export const NOTES_MAX = 500
export const REASON_MAX = 200
export const LINES_MAX = 100

export function emptyDraft(): OrderDraft {
  return {
    customer: null,
    contact: { name: '', phone: '', email: '' },
    lines: [],
    address: { recipient_name: '', phone: '', division_id: null, district_id: null, area: '', address_line: '', postcode: '' },
    recipientEdited: false,
    shipping_method_id: '',
    payment_method: '',
    channel: 'phone',
    coupon_code: '',
    notes: '',
    reason: '',
  }
}

export function lineLabel(productName: string, variantName: string | null | undefined): string {
  return variantName ? `${productName} — ${variantName}` : productName
}

/**
 * The edit form starts from the order. Null when the order lacks what an edit needs
 * (line variants, address ids) — a server from before BD1b.
 */
export function draftFromOrder(order: WebOrder): OrderDraft | null {
  const a = order.shipping_address
  if (!a || a.division_id == null || a.district_id == null) return null
  if (order.lines.some((l) => !l.variant_id)) return null
  const customerId = order.customer_id ?? order.customer?.id ?? null
  return {
    customer: customerId ? { id: customerId, name: order.customer?.name ?? order.contact.name, code: order.customer?.code ?? null, phone: null, email: null } : null,
    contact: { name: order.contact.name, phone: order.contact.phone ?? '', email: order.contact.email ?? '' },
    lines: order.lines.map((l) => ({ variant_id: l.variant_id as string, label: lineLabel(l.product_name, l.variant_name), sku: l.sku, quantity: trimDecimal(l.quantity) })),
    address: {
      recipient_name: a.recipient_name,
      phone: a.phone ?? '',
      division_id: Number(a.division_id),
      district_id: Number(a.district_id),
      area: a.area ?? '',
      address_line: a.address_line,
      postcode: a.postcode ?? '',
    },
    recipientEdited: a.recipient_name !== order.contact.name || (a.phone ?? '') !== (order.contact.phone ?? ''),
    shipping_method_id: order.shipping_method_id ?? '',
    payment_method: order.payment_method,
    channel: '',
    coupon_code: order.coupon_code ?? '',
    notes: order.notes ?? '',
    reason: '',
  }
}

/** Contact edits carry over to the recipient until the recipient is changed by hand. */
export function withContact(draft: OrderDraft, patch: Partial<OrderDraft['contact']>): OrderDraft {
  const contact = { ...draft.contact, ...patch }
  if (draft.recipientEdited) return { ...draft, contact }
  return { ...draft, contact, address: { ...draft.address, recipient_name: contact.name, phone: contact.phone } }
}

export function withCustomer(draft: OrderDraft, customer: DraftCustomer | null): OrderDraft {
  if (!customer) return { ...draft, customer: null }
  return withContact({ ...draft, customer }, { name: customer.name, phone: customer.phone ?? draft.contact.phone, email: customer.email ?? draft.contact.email })
}

/** Adding a product already on the order raises its quantity by one instead of adding a second line. */
export function withLineAdded(draft: OrderDraft, line: Omit<DraftLine, 'quantity'>): OrderDraft {
  const existing = draft.lines.find((l) => l.variant_id === line.variant_id)
  if (existing) {
    const next = QUANTITY.test(existing.quantity) ? bumpQuantity(existing.quantity) : '1'
    return { ...draft, lines: draft.lines.map((l) => (l === existing ? { ...l, quantity: next } : l)) }
  }
  return { ...draft, lines: [...draft.lines, { ...line, quantity: '1' }] }
}

function bumpQuantity(quantity: string): string {
  const [whole = '0', fraction] = quantity.split('.')
  const bumped = (BigInt(whole) + 1n).toString()
  return fraction ? `${bumped}.${fraction}` : bumped
}

/** A positive quantity with at most three decimals ("2", "1.5"). */
const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/

export function validQuantity(quantity: string): boolean {
  const q = quantity.trim()
  return QUANTITY.test(q) && compareDecimal(q, '0') > 0
}

/** The typed mobile number as the server keeps it (01XXXXXXXXX), or null while it is not a valid one. */
export function normalizedPhone(input: string): string | null {
  return normalizedMobile(input)
}

/**
 * The quote body for the draft; null until there is something to price (a product with a valid quantity).
 * Partial details are left out rather than sent half-filled.
 */
export function quoteInputFrom(draft: OrderDraft, opts: { orderId?: string; paymentMethod?: WebPaymentMethod | '' } = {}): StaffQuoteInput | null {
  const lines = draft.lines.filter((l) => validQuantity(l.quantity)).map((l) => ({ variant_id: l.variant_id, quantity: l.quantity.trim() }))
  if (lines.length === 0) return null
  const input: StaffQuoteInput = { lines }
  if (opts.orderId) input.order_id = opts.orderId
  if (draft.customer) input.customer_id = draft.customer.id
  const phone = normalizedPhone(draft.contact.phone)
  if (phone && draft.contact.name.trim()) {
    input.contact = { name: draft.contact.name.trim(), phone, ...(draft.contact.email.trim() ? { email: draft.contact.email.trim() } : {}) }
  }
  if (draft.address.district_id !== null) {
    input.address = { district_id: draft.address.district_id, ...(draft.address.division_id !== null ? { division_id: draft.address.division_id } : {}) }
  }
  if (draft.shipping_method_id) input.shipping_method_id = draft.shipping_method_id
  const payment = opts.paymentMethod ?? draft.payment_method
  if (payment) input.payment_method = payment
  if (draft.coupon_code.trim()) input.coupon_code = draft.coupon_code.trim()
  return input
}

/** The delivery method that applies: the one picked if the quote still offers it, else the quote's own pick. */
export function effectiveShippingMethod(draft: OrderDraft, quote: StaffQuote | undefined): string {
  if (!quote) return ''
  if (draft.shipping_method_id && quote.shipping_methods.some((m) => m.id === draft.shipping_method_id)) return draft.shipping_method_id
  return quote.shipping_method_id ?? ''
}

/** The payment method that applies on a new order: the one picked if offered, or the only one there is. */
export function effectivePaymentMethod(draft: OrderDraft, quote: StaffQuote | undefined): WebPaymentMethod | '' {
  const methods = quote?.payment_methods ?? []
  if (draft.payment_method && methods.some((m) => m.code === draft.payment_method)) return draft.payment_method
  return methods.length === 1 && methods[0] ? methods[0].code : ''
}

export type DraftErrors = Record<string, string>

/** What the form checks before submitting; the server checks everything again. Keys are body paths. */
export function validateDraft(draft: OrderDraft, mode: 'create' | 'edit', chosen: { shippingMethodId: string; paymentMethod: WebPaymentMethod | '' }): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.contact.name.trim()) errors['contact.name'] = 'Enter the customer’s name.'
  if (!draft.contact.phone.trim()) errors['contact.phone'] = 'Enter the customer’s mobile number.'
  else if (!normalizedPhone(draft.contact.phone)) errors['contact.phone'] = 'Enter a Bangladesh mobile number (01XXXXXXXXX).'
  if (draft.contact.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact.email.trim())) errors['contact.email'] = 'Enter a valid e-mail address or leave it empty.'
  if (draft.lines.length === 0) errors.lines = 'Add at least one product.'
  else if (draft.lines.length > LINES_MAX) errors.lines = `An order can have at most ${LINES_MAX} products.`
  draft.lines.forEach((l, i) => {
    if (!validQuantity(l.quantity)) errors[`lines.${i}.quantity`] = 'Enter a quantity above 0 (up to 3 decimals).'
  })
  if (!draft.address.recipient_name.trim()) errors['address.recipient_name'] = 'Enter who receives the parcel.'
  if (!draft.address.phone.trim()) errors['address.phone'] = 'Enter the recipient’s mobile number.'
  else if (!normalizedPhone(draft.address.phone)) errors['address.phone'] = 'Enter a Bangladesh mobile number (01XXXXXXXXX).'
  if (draft.address.division_id === null) errors['address.division_id'] = 'Choose a division.'
  if (draft.address.district_id === null) errors['address.district_id'] = 'Choose a district.'
  if (!draft.address.address_line.trim()) errors['address.address_line'] = 'Enter the address.'
  if (!chosen.shippingMethodId) errors.shipping_method_id = 'Choose a delivery method.'
  if (mode === 'create') {
    if (!chosen.paymentMethod) errors.payment_method = 'Choose how the customer pays.'
    if (!draft.channel) errors.channel = 'Choose where the order came from.'
  }
  if (draft.notes.length > NOTES_MAX) errors.notes = `At most ${NOTES_MAX} characters.`
  if (draft.reason.length > REASON_MAX) errors.reason = `At most ${REASON_MAX} characters.`
  return errors
}

function addressBody(draft: OrderDraft): StaffOrderInput['address'] {
  const a = draft.address
  return {
    recipient_name: a.recipient_name.trim(),
    phone: normalizedPhone(a.phone) ?? a.phone.trim(),
    division_id: a.division_id as number,
    district_id: a.district_id as number,
    ...(a.area.trim() ? { area: a.area.trim() } : {}),
    address_line: a.address_line.trim(),
    ...(a.postcode.trim() ? { postcode: a.postcode.trim() } : {}),
  }
}

function common(draft: OrderDraft, shippingMethodId: string, expectedTotal: string) {
  return {
    contact: {
      name: draft.contact.name.trim(),
      phone: normalizedPhone(draft.contact.phone) ?? draft.contact.phone.trim(),
      ...(draft.contact.email.trim() ? { email: draft.contact.email.trim() } : {}),
    },
    lines: draft.lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity.trim() })),
    address: addressBody(draft),
    shipping_method_id: shippingMethodId,
    ...(draft.coupon_code.trim() ? { coupon_code: draft.coupon_code.trim() } : {}),
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    expected_total: expectedTotal,
  }
}

export function createBodyFrom(draft: OrderDraft, chosen: { shippingMethodId: string; paymentMethod: WebPaymentMethod }, expectedTotal: string): StaffOrderInput {
  return {
    ...(draft.customer ? { customer_id: draft.customer.id } : {}),
    ...common(draft, chosen.shippingMethodId, expectedTotal),
    payment_method: chosen.paymentMethod,
    channel: (draft.channel || 'other') as OrderChannel,
  }
}

export function editBodyFrom(draft: OrderDraft, shippingMethodId: string, expectedTotal: string): EditOrderInput {
  return { ...common(draft, shippingMethodId, expectedTotal), ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) }
}

/** The stock problem of a priced line, if any. */
export function lineIssue(line: QuoteLine | undefined): string | null {
  if (!line) return null
  if (line.purchasable === false) return 'Not available for sale.'
  const overStock = line.exceeds_stock === true || (line.available !== null && line.available !== undefined && compareDecimal(line.quantity, line.available) > 0)
  if (!overStock) return null
  return line.available !== null && line.available !== undefined && compareDecimal(line.available, '0') > 0 ? `Only ${trimDecimal(line.available)} in stock.` : 'Out of stock.'
}

const NOT_EDITABLE: Record<string, string> = {
  status: 'This order can no longer be changed: it has moved past processing or was cancelled.',
  paid: 'This order is paid, so it can no longer be changed.',
  shipped: 'This order has been handed to a courier, so it can no longer be changed.',
}

export function notEditableMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'ORDER_NOT_EDITABLE') return null
  const reason = typeof error.details.reason === 'string' ? error.details.reason : ''
  return NOT_EDITABLE[reason] ?? 'This order can no longer be changed.'
}

/** The new preview of a 409 TOTAL_CHANGED, when the server sent one. */
export function changedPreview(error: unknown): StaffQuote | null {
  if (!(error instanceof ApiError) || error.code !== 'TOTAL_CHANGED') return null
  const preview = error.details.preview
  return preview && typeof preview === 'object' && 'total' in preview ? (preview as StaffQuote) : null
}

/** Form-level messages for refusals that belong to no single field. */
const SUBMIT_ERRORS: Record<string, string> = {
  ITEMS_UNAVAILABLE: 'Some products are not in stock in the quantity asked, or are no longer sold. Check the lines marked below.',
  SHIPPING_UNAVAILABLE: 'The chosen delivery method does not deliver to this district any more. Choose another one.',
  CHECKOUT_UNAVAILABLE: 'Online orders cannot be taken right now: no store is set up to fulfil them.',
  PAYMENT_METHOD_UNAVAILABLE: 'The chosen payment method cannot be used for this order. Choose another one.',
  INVALID_STATUS_TRANSITION: 'The order has moved on since you opened it. Open it again to see where it stands.',
}

export function submitErrorMessage(error: unknown): string {
  if (error instanceof ApiError && SUBMIT_ERRORS[error.code]) return SUBMIT_ERRORS[error.code] as string
  return error instanceof Error ? error.message : 'Something went wrong.'
}

// ── Changes on the detail ────────────────────────────────────────────────────

/** "Baby Romper — Size M: 2 → 3", "Added Socks × 2", "Removed Hat (1)". */
export function editLineText(line: OrderEdit['lines'][number]): string {
  if (line.before === null) return `Added ${line.name} × ${trimDecimal(line.after)}`
  if (line.after === null) return `Removed ${line.name} (was ${trimDecimal(line.before)})`
  return `${line.name}: ${trimDecimal(line.before)} → ${trimDecimal(line.after)}`
}

export function editTotalText(edit: OrderEdit, currency?: string): string {
  return compareDecimal(edit.total_before, edit.total_after) === 0
    ? `Total unchanged at ${formatMoney(edit.total_after, currency)}`
    : `Total ${formatMoney(edit.total_before, currency)} → ${formatMoney(edit.total_after, currency)}`
}

/** Other changed details, in words. */
export function editDetails(edit: OrderEdit): string[] {
  const details: string[] = []
  if (edit.contact_changed) details.push('Customer contact changed')
  if (edit.address_changed) details.push('Delivery address changed')
  if (edit.shipping_before !== edit.shipping_after && (edit.shipping_before || edit.shipping_after)) {
    details.push(`Delivery method ${edit.shipping_before ?? '—'} → ${edit.shipping_after ?? '—'}`)
  }
  return details
}
