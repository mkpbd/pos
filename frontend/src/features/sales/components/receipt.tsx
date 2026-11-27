import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { addDecimal, compareDecimal, formatMoney, isZeroDecimal, subtractDecimal, sumDecimals, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { lineLabel, type Mushak, type Sale, type SaleExchange, type SaleLine } from '@/features/sales/api'
import { paymentRowLabel } from '@/features/sales/payment-label'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

/** POS1a: the line was sold below or above its list price (changed at the till). */
const priceChanged = (l: SaleLine): l is SaleLine & { list_price: string } =>
  l.price_source === 'override' && l.list_price != null && compareDecimal(l.list_price, l.unit_price) !== 0

const PAGE: Record<ReceiptFormat, string> = {
  '58mm': '@page { size: 58mm auto; margin: 0 }',
  '80mm': '@page { size: 80mm auto; margin: 0 }',
  a4: '@page { size: A4; margin: 15mm }',
}

function formatDate(iso: string, timezone: string | null): string {
  return new Date(iso).toLocaleString(undefined, { timeZone: timezone ?? undefined, dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The customer's receipt / invoice. Thermal formats are a single narrow column in a
 * monospace font; A4 is a regular invoice. Shown on screen too (preview), so it uses
 * plain colors that print well.
 */
export function Receipt({ sale, format }: { sale: Sale; format: ReceiptFormat }) {
  const thermal = format !== 'a4'
  const c = sale.currency
  const branch = sale.receipt.branch
  const discount = addDecimal(sale.item_discount_total, sale.invoice_discount_total, 2)
  const payments = sale.payments.filter((p) => p.kind === 'payment')
  // VAT1: the Mushak-6.3 block, present only when the shop has a BIN.
  const mushak = sale.mushak ?? null
  const bin = sale.receipt.tax_number?.trim() || mushak?.seller.bin || null
  // Only a seller with a BIN issues a tax invoice; without one the document is a plain receipt.
  const taxInvoice = (sale.receipt.is_tax_invoice ?? true) && !!bin
  // On A4 the 6.3 table and totals replace the plain line table and totals; the rest stays.
  const mushakA4 = mushak && !thermal ? mushak : null

  return (
    <div
      className={cn(
        'bg-white text-black',
        thermal ? 'font-mono text-[11px] leading-snug' : 'p-2 text-sm',
        format === '58mm' && 'w-[48mm] px-[2mm] py-[3mm]',
        format === '80mm' && 'w-[72mm] px-[3mm] py-[4mm]',
      )}
      data-testid="receipt"
    >
      <div className={cn('text-center', !thermal && 'mb-4')}>
        <div className={cn('font-bold', thermal ? 'text-[13px]' : 'text-xl')}>{sale.receipt.organization_name}</div>
        {bin && <div>BIN: {bin}</div>}
        {branch && <div>{branch.name}</div>}
        {branch?.address && <div className="whitespace-pre-line">{branch.address}</div>}
        {branch?.phone && <div>Tel: {branch.phone}</div>}
        {sale.receipt.header && <div className="mt-1 whitespace-pre-line">{sale.receipt.header}</div>}
      </div>

      <Rule thermal={thermal} />
      <div className={cn(!thermal && 'mb-3 grid grid-cols-2 gap-1')}>
        {mushak && thermal && <div className="font-bold">Mushak-6.3</div>}
        <div>{taxInvoice ? 'Tax invoice' : 'Receipt'}: <b>{sale.number}</b></div>
        <div>{formatDate(sale.sold_at, sale.receipt.timezone)}</div>
        {sale.cashier?.name && <div>Cashier: {sale.cashier.name}</div>}
        <div>Customer: {sale.customer ? `${sale.customer.name}${sale.customer.phone ? ` (${sale.customer.phone})` : ''}` : 'Walk-in'}</div>
        {thermal && mushak?.buyer.bin && <div>Buyer BIN: {mushak.buyer.bin}</div>}
      </div>
      {sale.status === 'cancelled' && <div className="my-1 border border-black text-center font-bold">CANCELLED</div>}
      <Rule thermal={thermal} />

      {/* POS1c: the items brought back, then the new items under their own heading. */}
      {sale.exchange && (
        <>
          <ExchangeSection exchange={sale.exchange} thermal={thermal} currency={c} />
          <Rule thermal={thermal} />
          <div className={cn('font-bold', !thermal && 'mb-1')}>New items</div>
        </>
      )}

      {mushakA4 ? (
        <MushakInvoice mushak={mushakA4} timeZone={sale.receipt.timezone} cancelled={mushakA4.cancelled === true || sale.status === 'cancelled'} />
      ) : thermal ? (
        <div className="flex flex-col gap-1">
          {sale.lines.map((l) => (
            <div key={l.id}>
              <div>{lineLabel(l)}</div>
              <div className="flex justify-between">
                <span>{trimDecimal(l.quantity)}{l.unit_code ? ` ${l.unit_code}` : ''} × {priceChanged(l) && <><s>{formatMoney(l.list_price)}</s> </>}{formatMoney(l.unit_price)}</span>
                <span>{formatMoney(l.line_total)}</span>
              </div>
              {priceChanged(l) && l.price_approved_by?.name && <div>  price approved by {l.price_approved_by.name}</div>}
              {!isZeroDecimal(l.discount_amount) && <div className="flex justify-between"><span>  {l.promotion ? l.promotion.name : 'discount'}</span><span>-{formatMoney(l.discount_amount)}</span></div>}
              {mushak && <div className="flex justify-between"><span>  {mushak.prices_include_tax ? 'incl. VAT' : 'VAT'} {trimDecimal(l.tax_rate)}%</span><span>{formatMoney(l.tax_amount)}</span></div>}
              {l.serials.length > 0 && <div>  S/N: {l.serials.join(', ')}</div>}
              {l.batches.map((b) => <div key={`${b.batch_number}`}>  Batch {b.batch_number}{b.expires_on ? ` exp ${b.expires_on}` : ''}</div>)}
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black">
              <th className="py-1">Item</th>
              <th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">Price</th>
              <th className="py-1 text-right">Discount</th>
              <th className="py-1 text-right">Tax</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-300 align-top">
                <td className="py-1">
                  {lineLabel(l)}
                  <div className="text-xs text-gray-600">{l.sku}{l.serials.length > 0 && ` · S/N ${l.serials.join(', ')}`}{l.batches.map((b) => ` · Batch ${b.batch_number}`).join('')}</div>
                  {l.promotion && <div className="text-xs text-gray-600">Offer: {l.promotion.name}</div>}
                  {priceChanged(l) && l.price_approved_by?.name && <div className="text-xs text-gray-600">Price approved by {l.price_approved_by.name}</div>}
                </td>
                <td className="py-1 text-right">{trimDecimal(l.quantity)} {l.unit_code}</td>
                <td className="py-1 text-right">
                  {priceChanged(l) && <div className="text-xs text-gray-600"><s>{formatMoney(l.list_price)}</s></div>}
                  {formatMoney(l.unit_price)}
                </td>
                <td className="py-1 text-right">{isZeroDecimal(l.discount_amount) ? '—' : formatMoney(l.discount_amount)}</td>
                <td className="py-1 text-right">{trimDecimal(l.tax_rate)}%</td>
                <td className="py-1 text-right">{formatMoney(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Rule thermal={thermal} />
      <div className={cn('flex flex-col', !thermal && 'ml-auto w-72 gap-0.5')}>
        {!mushakA4 && (
          <>
            <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
            {!isZeroDecimal(discount) && <Row label="Discount" value={`-${formatMoney(discount)}`} />}
            {/* POS1a: the offers inside the discount above, and the coupon. */}
            {(sale.promotions ?? []).filter((p) => !isZeroDecimal(p.amount)).map((p, i) => (
              <Row key={`${p.name}-${i}`} label={`  incl. ${p.name}`} value={`-${formatMoney(p.amount)}`} />
            ))}
            {sale.coupon_code && <Row label="Coupon" value={sale.coupon_code} />}
            <Row label={sale.tax_mode === 'inclusive' ? 'Tax (included)' : 'Tax'} value={formatMoney(sale.tax_total)} />
            <Row label="TOTAL" value={formatMoney(sale.total, c)} bold />
          </>
        )}
        {payments.map((p) => {
          // POS1b: a gift card row's reference names the card ("Gift card ••••1234").
          const { label, reference } = paymentRowLabel(p)
          return <Row key={p.id} label={`${label}${reference ? ` (${reference})` : ''}`} value={formatMoney(p.tendered ?? p.amount)} />
        })}
        {!isZeroDecimal(sale.change_total) && <Row label="Change" value={formatMoney(sale.change_total)} />}
        {!isZeroDecimal(sale.due_total) && <Row label="Balance due" value={formatMoney(sale.due_total, c)} bold />}
        {sale.savings_total && compareDecimal(sale.savings_total, '0') > 0 && <Row label="You saved" value={formatMoney(sale.savings_total, c)} bold />}
        {/* POS1b: what the customer still has to spend after this sale. */}
        {sale.customer && sale.receipt.customer_store_credit_balance != null
          && (!isZeroDecimal(sale.receipt.customer_store_credit_balance) || payments.some((p) => p.method === 'store_credit')) && <Row label="Store credit left" value={formatMoney(sale.receipt.customer_store_credit_balance, c)} />}
      </div>
      <Rule thermal={thermal} />
      <div className="text-center">
        {sale.receipt.footer ? <div className="whitespace-pre-line">{sale.receipt.footer}</div> : <div>Thank you for shopping with us!</div>}
      </div>
    </div>
  )
}

/**
 * POS1c: "Exchange for INV-… (RET-…)" with the returned items as negative amounts and the value
 * that paid this sale. When part of the return went against what the customer still owed on the old
 * invoice, that part is shown; when the value was more than this sale, the difference given back.
 */
function ExchangeSection({ exchange, thermal, currency }: { exchange: SaleExchange; thermal: boolean; currency: string }) {
  const returned = sumDecimals(exchange.lines.map((l) => l.line_total))
  const owed = subtractDecimal(returned, exchange.value, 2)
  const refunded = subtractDecimal(exchange.value, exchange.applied, 2)
  return (
    <div className={cn('flex flex-col', !thermal && 'mb-3 w-full gap-0.5')} data-testid="receipt-exchange">
      <div className="font-bold">Exchange for {exchange.original_sale_number} ({exchange.return_number})</div>
      {exchange.lines.map((l, i) => (
        <Row key={i} label={`${trimDecimal(l.quantity)} × ${lineLabel(l)}`} value={`-${formatMoney(l.line_total)}`} />
      ))}
      {compareDecimal(owed, '0') > 0 && <Row label="Against amount owed" value={formatMoney(owed)} />}
      <Row label="Returned value" value={`-${formatMoney(exchange.value, currency)}`} bold />
      {compareDecimal(refunded, '0') > 0 && <Row label="Refunded to customer" value={formatMoney(refunded, currency)} />}
    </div>
  )
}

/**
 * VAT1: the Mushak-6.3 tax invoice on A4 — seller and buyer with their BINs, invoice number and
 * time of issue, the lines (value excl. VAT, SD, VAT rate, VAT, total), totals and a signature line.
 * Every figure is the server's (stored line snapshots); nothing is computed here. Shared with the
 * web order print page.
 */
export function MushakInvoice({ mushak, timeZone, cancelled = false }: { mushak: Mushak; timeZone: string | null | undefined; cancelled?: boolean }) {
  const t = mushak.totals
  return (
    <div className="relative flex flex-col gap-4" data-testid="mushak-invoice">
      {cancelled && (
        <div className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 -rotate-12 border-4 border-red-700 px-6 py-1 text-3xl font-bold tracking-widest text-red-700 uppercase opacity-80" data-testid="cancelled-stamp">
          Cancelled
        </div>
      )}
      <div className="text-center text-lg font-bold">Mushak-6.3 — Tax invoice</div>
      <div className="grid grid-cols-2 gap-4">
        <div data-testid="mushak-seller">
          <div className="text-xs font-semibold text-gray-600 uppercase">Seller</div>
          <div className="font-bold">{mushak.seller.name}</div>
          <div>BIN: {mushak.seller.bin}</div>
          {mushak.seller.address && <div className="whitespace-pre-line">{mushak.seller.address}</div>}
        </div>
        <div data-testid="mushak-buyer">
          <div className="text-xs font-semibold text-gray-600 uppercase">Buyer</div>
          <div className="font-bold">{mushak.buyer.name}</div>
          <div>BIN: {mushak.buyer.bin ?? '—'}</div>
          {mushak.buyer.address && <div className="whitespace-pre-line">{mushak.buyer.address}</div>}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <div>Invoice no.: <b>{mushak.invoice_number}</b></div>
        <div>Date & time of issue: {formatDate(mushak.issued_at, timeZone ?? null)}</div>
      </div>
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-y border-black">
            <th className="py-1 pr-1">Description</th>
            <th className="py-1 pr-1">Unit</th>
            <th className="py-1 pr-1 text-right">Qty</th>
            <th className="py-1 pr-1 text-right">Unit price</th>
            <th className="py-1 pr-1 text-right">Value</th>
            <th className="py-1 pr-1 text-right">SD</th>
            <th className="py-1 pr-1 text-right">VAT rate</th>
            <th className="py-1 pr-1 text-right">VAT</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {mushak.lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-300 align-top">
              <td className="py-1 pr-1">{l.description}</td>
              <td className="py-1 pr-1">{l.unit ?? ''}</td>
              <td className="py-1 pr-1 text-right">{trimDecimal(l.quantity)}</td>
              <td className="py-1 pr-1 text-right">{formatMoney(l.unit_price)}</td>
              <td className="py-1 pr-1 text-right">{formatMoney(l.value)}</td>
              <td className="py-1 pr-1 text-right">{formatMoney(l.sd_amount)}</td>
              <td className="py-1 pr-1 text-right">{trimDecimal(l.vat_rate)}%</td>
              <td className="py-1 pr-1 text-right">{formatMoney(l.vat_amount)}</td>
              <td className="py-1 text-right">{formatMoney(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto flex w-72 flex-col gap-0.5" data-testid="mushak-totals">
        <Row label="Value (excl. VAT)" value={formatMoney(t.value)} />
        <Row label="Supplementary duty" value={formatMoney(t.sd)} />
        <Row label={mushak.prices_include_tax ? 'VAT (included in prices)' : 'VAT'} value={formatMoney(t.vat)} />
        <Row label="Total" value={formatMoney(t.total)} bold />
      </div>
      <div className="mt-12 ml-auto w-56 border-t border-black pt-1 text-center">Authorised signature</div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', bold && 'font-bold')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function Rule({ thermal }: { thermal: boolean }) {
  return thermal ? <div className="my-1 border-t border-dashed border-black" /> : <div className="my-2 border-t border-gray-400" />
}

/**
 * Prints a receipt: renders it into a print-only portal, sets the page size for the format
 * and opens the browser's print dialog (pick the receipt printer there; cash drawers that
 * are wired to the printer open with the print job when the driver is set to do so).
 */
export function ReceiptPrinter({ sale, format, onDone }: { sale: Sale; format: ReceiptFormat; onDone: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.print()
      onDone()
    })
    return () => cancelAnimationFrame(frame)
  }, [onDone])

  return createPortal(
    <div className="print-root">
      <style>{PAGE[format]}</style>
      <Receipt sale={sale} format={format} />
    </div>,
    document.body,
  )
}
