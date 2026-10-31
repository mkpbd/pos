import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { addDecimal, formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { lineLabel, type Sale } from '@/features/sales/api'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

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
        {branch && <div>{branch.name}</div>}
        {branch?.address && <div className="whitespace-pre-line">{branch.address}</div>}
        {branch?.phone && <div>Tel: {branch.phone}</div>}
        {sale.receipt.header && <div className="mt-1 whitespace-pre-line">{sale.receipt.header}</div>}
      </div>

      <Rule thermal={thermal} />
      <div className={cn(!thermal && 'mb-3 grid grid-cols-2 gap-1')}>
        <div>{sale.tax_mode === 'inclusive' ? 'Invoice' : 'Tax invoice'}: <b>{sale.number}</b></div>
        <div>{formatDate(sale.sold_at, sale.receipt.timezone)}</div>
        {sale.cashier?.name && <div>Cashier: {sale.cashier.name}</div>}
        <div>Customer: {sale.customer ? `${sale.customer.name}${sale.customer.phone ? ` (${sale.customer.phone})` : ''}` : 'Walk-in'}</div>
      </div>
      {sale.status === 'cancelled' && <div className="my-1 border border-black text-center font-bold">CANCELLED</div>}
      <Rule thermal={thermal} />

      {thermal ? (
        <div className="flex flex-col gap-1">
          {sale.lines.map((l) => (
            <div key={l.id}>
              <div>{lineLabel(l)}</div>
              <div className="flex justify-between">
                <span>{trimDecimal(l.quantity)}{l.unit_code ? ` ${l.unit_code}` : ''} × {formatMoney(l.unit_price)}</span>
                <span>{formatMoney(l.line_total)}</span>
              </div>
              {!isZeroDecimal(l.discount_amount) && <div className="flex justify-between"><span>  discount</span><span>-{formatMoney(l.discount_amount)}</span></div>}
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
                </td>
                <td className="py-1 text-right">{trimDecimal(l.quantity)} {l.unit_code}</td>
                <td className="py-1 text-right">{formatMoney(l.unit_price)}</td>
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
        <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
        {!isZeroDecimal(discount) && <Row label="Discount" value={`-${formatMoney(discount)}`} />}
        <Row label={sale.tax_mode === 'inclusive' ? 'Tax (included)' : 'Tax'} value={formatMoney(sale.tax_total)} />
        <Row label="TOTAL" value={formatMoney(sale.total, c)} bold />
        {payments.map((p) => <Row key={p.id} label={`${p.method_label}${p.reference ? ` (${p.reference})` : ''}`} value={formatMoney(p.tendered ?? p.amount)} />)}
        {!isZeroDecimal(sale.change_total) && <Row label="Change" value={formatMoney(sale.change_total)} />}
        {!isZeroDecimal(sale.due_total) && <Row label="Balance due" value={formatMoney(sale.due_total, c)} bold />}
      </div>
      <Rule thermal={thermal} />
      <div className="text-center">
        {sale.receipt.footer ? <div className="whitespace-pre-line">{sale.receipt.footer}</div> : <div>Thank you for shopping with us!</div>}
      </div>
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
