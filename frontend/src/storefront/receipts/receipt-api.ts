import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { addDecimal } from '@/lib/money'
import { storeApi } from '../http'

/**
 * POS1d: GET /store/receipts/{token} — the receipt of a shop sale, opened from the link in the
 * receipt SMS / e-mail, without signing in. Only what the printed receipt shows: the shop header and
 * footer, lines, totals, payments (a gift card by its last 4 only), the exchange, the customer's name
 * and the cashier's first name — no costs, contact details or internal ids.
 */

export type PublicReceiptLine = {
  product_name: string
  variant_name: string | null
  quantity: string
  unit_code: string | null
  unit_price: string
  /** Line discount (positive); "0.00" when none. */
  discount_amount: string
  line_total: string
}

export type PublicReceiptPayment = { method: string; method_label: string; amount: string; tendered: string | null; reference: string | null }

export type PublicReceiptExchange = {
  return_number: string
  original_sale_number: string
  value: string
  applied: string
  lines: { product_name: string; variant_name: string | null; quantity: string; line_total: string }[]
}

export type PublicReceipt = {
  number: string
  status: 'completed' | 'cancelled'
  sold_at: string
  currency: string
  tax_mode: 'inclusive' | 'exclusive'
  receipt: {
    organization_name: string | null
    tax_number: string | null
    is_tax_invoice: boolean
    header: string | null
    footer: string | null
    branch: { name: string; address: string | null; phone: string | null } | null
    timezone: string | null
  }
  lines: PublicReceiptLine[]
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  paid_total: string
  change_total: string
  due_total: string
  savings_total: string | null
  payments: PublicReceiptPayment[]
  exchange: PublicReceiptExchange | null
  customer_name: string | null
  cashier_name: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null)
const amount = (...values: unknown[]): string => values.map(str).find((v) => v !== null) ?? '0.00'
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
/** A name from `{name}` or a plain string. */
const nameOf = (v: unknown): string | null => (isObj(v) ? str(v.name) : str(v))

/**
 * Reads the server's receipt tolerantly: totals flat or under `totals`, a line's name as
 * `product_name` or `name`, a payment's label as `method_label` or `label`, people as `{name}` or text.
 */
export function normalizePublicReceipt(raw: unknown): PublicReceipt {
  const r = isObj(raw) ? raw : {}
  const totals = isObj(r.totals) ? { ...r, ...r.totals } : r
  const head = isObj(r.receipt) ? r.receipt : {}
  const branch = isObj(head.branch) ? head.branch : null
  const exchange = isObj(r.exchange) ? r.exchange : null
  const discount = str(totals.discount_total) ?? addDecimal(amount(totals.item_discount_total), amount(totals.invoice_discount_total), 2)
  const taxNumber = str(head.tax_number)?.trim() || null

  return {
    number: str(r.number) ?? '',
    status: r.status === 'cancelled' ? 'cancelled' : 'completed',
    sold_at: str(r.sold_at) ?? '',
    currency: str(r.currency) ?? 'BDT',
    tax_mode: r.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    receipt: {
      organization_name: str(head.organization_name),
      tax_number: taxNumber,
      is_tax_invoice: head.is_tax_invoice === false ? false : !!taxNumber,
      header: str(head.header),
      footer: str(head.footer),
      branch: branch ? { name: str(branch.name) ?? '', address: str(branch.address), phone: str(branch.phone) } : null,
      timezone: str(head.timezone),
    },
    lines: list(r.lines).map((l) => ({
      product_name: str(l.product_name) ?? str(l.name) ?? '',
      variant_name: str(l.variant_name) ?? str(l.variant),
      quantity: amount(l.quantity),
      unit_code: str(l.unit_code),
      unit_price: amount(l.unit_price),
      discount_amount: amount(l.discount_amount, typeof l.discount === 'string' ? l.discount : null),
      line_total: amount(l.line_total, l.total),
    })),
    subtotal: amount(totals.subtotal),
    discount_total: discount,
    tax_total: amount(totals.tax_total, totals.tax),
    total: amount(totals.total),
    paid_total: amount(totals.paid_total),
    change_total: amount(totals.change_total, totals.change),
    due_total: amount(totals.due_total),
    savings_total: str(totals.savings_total),
    payments: list(r.payments)
      .filter((p) => p.kind === undefined || p.kind === 'payment')
      .map((p) => ({
        method: str(p.method) ?? '',
        method_label: str(p.method_label) ?? str(p.label) ?? str(p.method) ?? '',
        amount: amount(p.amount),
        tendered: str(p.tendered),
        reference: str(p.reference) ?? ((last4) => (last4 ? `••••${last4}` : null))(str(p.gift_card_last4) ?? str(p.last4)),
      })),
    exchange: exchange
      ? {
          return_number: str(exchange.return_number) ?? '',
          original_sale_number: str(exchange.original_sale_number) ?? '',
          value: amount(exchange.value),
          applied: amount(exchange.applied),
          lines: list(exchange.lines).map((l) => ({
            product_name: str(l.product_name) ?? str(l.name) ?? '',
            variant_name: str(l.variant_name) ?? str(l.variant),
            quantity: amount(l.quantity),
            line_total: amount(l.line_total, l.total),
          })),
        }
      : null,
    customer_name: str(r.customer_name) ?? nameOf(r.customer),
    cashier_name: str(r.cashier_name) ?? nameOf(r.cashier),
  }
}

export const receiptKeys = { receipt: (token: string) => ['store', 'receipts', token] as const }

export function usePublicReceiptQuery(token: string) {
  return useQuery({
    queryKey: receiptKeys.receipt(token),
    queryFn: ({ signal }) => storeApi.get<unknown>(`/store/receipts/${encodeURIComponent(token)}`, { signal }).then((r) => normalizePublicReceipt(r.data)),
    // A wrong token stays wrong; only a server or network failure is retried once.
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    enabled: token !== '',
  })
}
