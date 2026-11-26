import type { PrintBlock } from '@/lib/escpos/document'
import { CODE_PAGE_LABELS } from '@/lib/escpos/code-pages'
import { api } from '@/lib/api/client'
import { addDecimal, compareDecimal, formatMoney, isZeroDecimal, subtractDecimal, sumDecimals, trimDecimal } from '@/lib/money'
import type { SlipData } from '@/features/pos/components/stored-value-slip'
import type { PrinterSettings } from '@/features/pos/printing/printer-settings'
import { lineLabel, type Sale, type SaleExchange } from '@/features/sales/api'
import { paymentRowLabel } from '@/features/sales/payment-label'

const rule: PrintBlock = { kind: 'rule' }
const row = (left: string, right: string, bold = false): PrintBlock => ({ kind: 'columns', left, right, bold })
const text = (value: string, extra: Omit<Extract<PrintBlock, { kind: 'text' }>, 'kind' | 'text'> = {}): PrintBlock => ({ kind: 'text', text: value, ...extra })

function formatDate(iso: string, timezone: string | null): string {
  return new Date(iso).toLocaleString(undefined, { timeZone: timezone ?? undefined, dateStyle: 'medium', timeStyle: 'short' })
}

/** POS1d: how long the till waits for the receipt link before printing without its QR code. */
const LINK_TIMEOUT_MS = 3000

/** `GET /sales/{id}/receipt-link` → the public receipt URL, or null (no storefront URL, error, slow). */
export async function fetchReceiptLink(saleId: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS)
  try {
    const link = (await api.get<{ url: string | null; token?: string }>(`/sales/${saleId}/receipt-link`, { signal: controller.signal })).data
    return typeof link?.url === 'string' && link.url !== '' ? link.url : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The sale took cash (a cash payment row): the drawer opens for it. */
export function tookCash(sale: Sale): boolean {
  return sale.payments.some((p) => p.kind === 'payment' && p.method === 'cash')
}

/**
 * The sale receipt for the printer: the same content as the on-screen thermal receipt (header,
 * lines, exchange, totals, payments, change, store credit left, footer) and, when the sale has a
 * public link, its QR code.
 */
export function saleDocument(sale: Sale, link: string | null = null): PrintBlock[] {
  const blocks: PrintBlock[] = []
  const c = sale.currency
  const r = sale.receipt
  const branch = r.branch
  const bin = r.tax_number?.trim() || null
  const taxInvoice = (r.is_tax_invoice ?? true) && !!bin
  const payments = sale.payments.filter((p) => p.kind === 'payment')
  const discount = addDecimal(sale.item_discount_total, sale.invoice_discount_total, 2)

  if (r.organization_name) blocks.push(text(r.organization_name, { align: 'center', bold: true, large: true }))
  if (bin) blocks.push(text(`BIN: ${bin}`, { align: 'center' }))
  if (branch) blocks.push(text(branch.name, { align: 'center' }))
  if (branch?.address) blocks.push(text(branch.address, { align: 'center' }))
  if (branch?.phone) blocks.push(text(`Tel: ${branch.phone}`, { align: 'center' }))
  if (r.header) blocks.push(text(r.header, { align: 'center' }))
  blocks.push(rule)

  blocks.push(text(`${taxInvoice ? 'Tax invoice' : 'Receipt'}: ${sale.number}`, { bold: true }))
  blocks.push(text(formatDate(sale.sold_at, r.timezone)))
  if (sale.cashier?.name) blocks.push(text(`Cashier: ${sale.cashier.name}`))
  blocks.push(text(`Customer: ${sale.customer ? `${sale.customer.name}${sale.customer.phone ? ` (${sale.customer.phone})` : ''}` : 'Walk-in'}`))
  if (sale.status === 'cancelled') blocks.push(text('*** CANCELLED ***', { align: 'center', bold: true }))
  blocks.push(rule)

  if (sale.exchange) {
    blocks.push(...exchangeBlocks(sale.exchange, c))
    blocks.push(rule)
    blocks.push(text('New items', { bold: true }))
  }

  for (const l of sale.lines) {
    blocks.push(text(lineLabel(l)))
    const changed = l.price_source === 'override' && l.list_price != null && compareDecimal(l.list_price, l.unit_price) !== 0
    blocks.push(row(`  ${trimDecimal(l.quantity)}${l.unit_code ? ` ${l.unit_code}` : ''} x ${formatMoney(l.unit_price)}${changed ? ` (was ${formatMoney(l.list_price)})` : ''}`, formatMoney(l.line_total)))
    if (changed && l.price_approved_by?.name) blocks.push(text(`  price approved by ${l.price_approved_by.name}`))
    if (!isZeroDecimal(l.discount_amount)) blocks.push(row(`  ${l.promotion ? l.promotion.name : 'discount'}`, `-${formatMoney(l.discount_amount)}`))
    if (l.serials.length > 0) blocks.push(text(`  S/N: ${l.serials.join(', ')}`))
    for (const b of l.batches) blocks.push(text(`  Batch ${b.batch_number ?? ''}${b.expires_on ? ` exp ${b.expires_on}` : ''}`))
  }
  blocks.push(rule)

  blocks.push(row('Subtotal', formatMoney(sale.subtotal)))
  if (!isZeroDecimal(discount)) blocks.push(row('Discount', `-${formatMoney(discount)}`))
  for (const p of (sale.promotions ?? []).filter((p) => !isZeroDecimal(p.amount))) blocks.push(row(`  incl. ${p.name}`, `-${formatMoney(p.amount)}`))
  if (sale.coupon_code) blocks.push(row('Coupon', sale.coupon_code))
  blocks.push(row(sale.tax_mode === 'inclusive' ? 'Tax (included)' : 'Tax', formatMoney(sale.tax_total)))
  blocks.push(row('TOTAL', formatMoney(sale.total, c), true))
  for (const p of payments) {
    const { label, reference } = paymentRowLabel(p)
    blocks.push(row(`${label}${reference ? ` (${reference})` : ''}`, formatMoney(p.tendered ?? p.amount)))
  }
  if (!isZeroDecimal(sale.change_total)) blocks.push(row('Change', formatMoney(sale.change_total)))
  if (!isZeroDecimal(sale.due_total)) blocks.push(row('Balance due', formatMoney(sale.due_total, c), true))
  if (sale.savings_total && compareDecimal(sale.savings_total, '0') > 0) blocks.push(row('You saved', formatMoney(sale.savings_total, c), true))
  const credit = r.customer_store_credit_balance
  if (sale.customer && credit != null && (!isZeroDecimal(credit) || payments.some((p) => p.method === 'store_credit'))) blocks.push(row('Store credit left', formatMoney(credit, c)))
  blocks.push(rule)

  blocks.push(text(r.footer || 'Thank you for shopping with us!', { align: 'center' }))
  if (link) {
    blocks.push({ kind: 'feed', lines: 1 })
    blocks.push(text('Your receipt online:', { align: 'center' }))
    blocks.push({ kind: 'qr', data: link })
  }
  return blocks
}

function exchangeBlocks(exchange: SaleExchange, currency: string): PrintBlock[] {
  const returned = sumDecimals(exchange.lines.map((l) => l.line_total))
  const owed = subtractDecimal(returned, exchange.value, 2)
  const refunded = subtractDecimal(exchange.value, exchange.applied, 2)
  const blocks: PrintBlock[] = [text(`Exchange for ${exchange.original_sale_number} (${exchange.return_number})`, { bold: true })]
  for (const l of exchange.lines) blocks.push(row(`${trimDecimal(l.quantity)} x ${lineLabel(l)}`, `-${formatMoney(l.line_total)}`))
  if (compareDecimal(owed, '0') > 0) blocks.push(row('Against amount owed', formatMoney(owed)))
  blocks.push(row('Returned value', `-${formatMoney(exchange.value, currency)}`, true))
  if (compareDecimal(refunded, '0') > 0) blocks.push(row('Refunded to customer', formatMoney(refunded, currency)))
  return blocks
}

/** POS1b slips (gift card sale, customer advance) for the printer. */
export function slipDocument(slip: SlipData): PrintBlock[] {
  const blocks: PrintBlock[] = []
  if (slip.organization) blocks.push(text(slip.organization, { align: 'center', bold: true, large: true }))
  if (slip.branch) blocks.push(text(slip.branch, { align: 'center' }))
  blocks.push(rule)
  blocks.push(text(`${slip.title}: ${slip.number}`, { bold: true }))
  blocks.push(text(new Date(slip.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })))
  if (slip.cashier) blocks.push(text(`Cashier: ${slip.cashier}`))
  blocks.push(rule)
  if (slip.code) {
    blocks.push(text('Card code', { align: 'center' }))
    blocks.push(text(slip.code, { align: 'center', bold: true, large: true }))
  }
  for (const r of slip.rows) blocks.push(row(r.label, r.value, r.bold))
  blocks.push(rule)
  blocks.push(text(slip.footer ?? 'Thank you!', { align: 'center' }))
  return blocks
}

/** The "Test print" page: the settings in use, a column sample and a QR code. */
export function testDocument(settings: PrinterSettings, shop: string | null): PrintBlock[] {
  return [
    text(shop || 'Receipt printer', { align: 'center', bold: true, large: true }),
    text('Test print', { align: 'center' }),
    rule,
    row('Paper', `${settings.paper} characters`),
    row('Characters', CODE_PAGE_LABELS[settings.codePage]),
    row('Picture mode', settings.raster === 'always' ? 'Always' : 'When needed'),
    row('Drawer', settings.openDrawer ? `Pin ${settings.drawerPin}` : 'Off'),
    rule,
    row('Mango Juice 1 L x 2', '50.00'),
    row('TOTAL', '50.00', true),
    rule,
    text('If you can read this, printing works.', { align: 'center' }),
    { kind: 'qr', data: 'TEST PRINT' },
  ]
}
