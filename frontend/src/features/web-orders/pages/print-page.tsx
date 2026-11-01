import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeftIcon, PrinterIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/use-auth'
import { usePrintQuery, type PrintDocument, type PrintKind, type PrintOrder, type PrintOrganization } from '@/features/web-orders/api'
import { formatDateTime, PAYMENT_METHOD_LABELS, paymentBadge, PRINT_KIND_LABELS, printParams, promotionKindLabel } from '@/features/web-orders/orders'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'

// Page set-up and colours for paper; the screen view mimics A4 sheets.
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  .print-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; max-width: none !important; }
  .print-sheet + .print-sheet { break-before: page; page-break-before: always; }
  .print-sheet table { page-break-inside: auto; }
  .print-sheet tr { break-inside: avoid; page-break-inside: avoid; }
}
`

function OrgHeader({ organization, kind }: { organization: PrintOrganization | null; kind: PrintKind }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-3">
      <div className="flex items-start gap-3">
        {organization?.logo_url && /^https?:\/\//i.test(organization.logo_url) && <img src={organization.logo_url} alt="" className="h-12 w-auto object-contain" />}
        <div className="text-xs leading-snug">
          <div className="text-base font-bold">{organization?.name ?? ''}</div>
          {organization?.address && <div className="whitespace-pre-line">{organization.address}</div>}
          {organization?.phone && <div>Phone {organization.phone}</div>}
          {organization?.email && <div>{organization.email}</div>}
          {organization?.tax_number && <div>BIN / Tax no. {organization.tax_number}</div>}
        </div>
      </div>
      <div className="text-right text-lg font-bold tracking-wide uppercase">{PRINT_KIND_LABELS[kind]}</div>
    </header>
  )
}

function Money({ value, currency }: { value: string | undefined; currency?: string }) {
  return <>{value === undefined ? '' : formatMoney(value, currency)}</>
}

function Totals({ order }: { order: PrintOrder }) {
  const rows: [string, string, boolean?][] = []
  if (order.subtotal !== undefined) rows.push(['Subtotal', formatMoney(order.subtotal)])
  for (const p of (order.promotions ?? []).filter((x) => x.kind !== 'shipping')) rows.push([`${p.name} (${promotionKindLabel(p.kind)})`, `−${formatMoney(p.amount)}`])
  if ((order.promotions ?? []).filter((x) => x.kind !== 'shipping').length === 0 && !isZeroDecimal(order.discount_total)) rows.push(['Discounts', `−${formatMoney(order.discount_total)}`])
  if (order.coupon_code) rows.push([`Coupon ${order.coupon_code}`, ''])
  if (order.tax_total !== undefined) rows.push([order.prices_include_tax ? 'VAT (included)' : 'VAT', formatMoney(order.tax_total)])
  if (order.shipping_total !== undefined) {
    const waived = !isZeroDecimal(order.shipping_discount)
    rows.push([waived ? `Delivery (${formatMoney(order.shipping_discount)} waived)` : 'Delivery', isZeroDecimal(order.shipping_total) ? 'Free' : formatMoney(order.shipping_total)])
  }
  if (!isZeroDecimal(order.cod_fee)) rows.push(['Cash on delivery fee', formatMoney(order.cod_fee)])
  if (order.total !== undefined) rows.push(['Total', formatMoney(order.total, order.currency), true])

  return (
    <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm" aria-label={`Totals of ${order.number}`}>
      {rows.map(([label, value, strong], i) => (
        <div key={i} className="contents">
          <dt className={strong ? 'border-t border-neutral-400 pt-1 font-bold' : ''}>{label}</dt>
          <dd className={strong ? 'border-t border-neutral-400 pt-1 text-right font-mono font-bold' : 'text-right font-mono'}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Sheet({ doc, order, timeZone }: { doc: PrintDocument; order: PrintOrder; timeZone: string | undefined }) {
  const invoice = doc.kind === 'invoice'
  const a = order.shipping_address
  return (
    <article className="print-sheet mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-white p-8 text-black shadow-md print:shadow-none" aria-label={`${PRINT_KIND_LABELS[doc.kind]} ${order.number}`}>
      <OrgHeader organization={doc.organization} kind={doc.kind} />
      <div className="grid gap-4 text-sm sm:grid-cols-3 print:grid-cols-3">
        <div>
          <div className="text-xs font-semibold text-neutral-600 uppercase">Order</div>
          <div className="font-mono text-base font-bold">{order.number}</div>
          <div>{formatDateTime(order.placed_at, timeZone)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-neutral-600 uppercase">Ship to</div>
          {a ? (
            <address className="not-italic">
              {a.recipient_name}{a.phone && ` · ${a.phone}`}
              <br />
              {a.address_line}{a.area && `, ${a.area}`}
              <br />
              {[a.district, a.division].filter(Boolean).join(', ')}{a.postcode && ` ${a.postcode}`}
            </address>
          ) : (
            <div>{order.contact.name}</div>
          )}
          {order.contact.phone && (!a || a.phone !== order.contact.phone) && <div>Contact {order.contact.phone}</div>}
        </div>
        <div>
          <div className="text-xs font-semibold text-neutral-600 uppercase">Payment & delivery</div>
          <div>
            {order.payment_method_label ?? PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method} · {paymentBadge(order.payment_status).label}
          </div>
          {order.shipping_method_name && <div>{order.shipping_method_name}</div>}
          {order.courier_name && <div>{order.courier_name}{order.tracking_number && <> · <span className="font-mono">{order.tracking_number}</span></>}</div>}
          {order.payment_method === 'cod' && order.payment_status === 'unpaid' && order.total !== undefined && (
            <div className="font-bold">Collect {formatMoney(order.total, order.currency)}</div>
          )}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left">
            <th className="py-1 pr-2">Item</th>
            <th className="py-1 pr-2">SKU</th>
            <th className="py-1 pr-2 text-right">Qty</th>
            {invoice && (
              <>
                <th className="py-1 pr-2 text-right">Price</th>
                <th className="py-1 pr-2 text-right">Discount</th>
                <th className="py-1 pr-2 text-right">VAT</th>
                <th className="py-1 text-right">Amount</th>
              </>
            )}
            {!invoice && <th className="w-12 py-1 text-center">Packed</th>}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-1 pr-2">{l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name}</td>
              <td className="py-1 pr-2 font-mono text-xs">{l.sku ?? ''}</td>
              <td className="py-1 pr-2 text-right font-mono">{trimDecimal(l.quantity)}</td>
              {invoice && (
                <>
                  <td className="py-1 pr-2 text-right font-mono"><Money value={l.unit_price} /></td>
                  <td className="py-1 pr-2 text-right font-mono">{isZeroDecimal(l.discount_amount) ? '—' : `−${formatMoney(l.discount_amount)}`}</td>
                  <td className="py-1 pr-2 text-right font-mono">{l.tax_amount === undefined || isZeroDecimal(l.tax_amount) ? '—' : formatMoney(l.tax_amount)}</td>
                  <td className="py-1 text-right font-mono"><Money value={l.line_total} /></td>
                </>
              )}
              {!invoice && <td className="py-1 text-center"><span className="inline-block size-4 border border-neutral-500" aria-hidden /></td>}
            </tr>
          ))}
        </tbody>
      </table>

      {invoice && <Totals order={order} />}
      {order.notes && <p className="text-sm"><span className="font-semibold">Customer note:</span> {order.notes}</p>}
    </article>
  )
}

/**
 * /web-orders/print?ids=a,b&kind=packing_slip|invoice — print-ready sheets outside the admin chrome,
 * one order per page. Opens the print dialog once, when the data has loaded.
 */
export function WebOrdersPrintPage() {
  const me = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ids, kind } = printParams(searchParams)
  const { data, error, isPending, refetch } = usePrintQuery(ids, kind)
  const printed = useRef(false)
  const ready = !!data && data.orders.length > 0

  useEffect(() => {
    if (!ready || printed.current) return
    printed.current = true
    // Let the sheets paint before the dialog freezes the page.
    const t = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(t)
  }, [ready])

  useEffect(() => {
    const previous = document.title
    document.title = `${PRINT_KIND_LABELS[kind]}s — ${ids.length} ${ids.length === 1 ? 'order' : 'orders'}`
    return () => {
      document.title = previous
    }
  }, [kind, ids.length])

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/web-orders'))

  return (
    <div className="min-h-svh bg-neutral-100 print:bg-white">
      <style>{PRINT_CSS}</style>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-background p-3 print:hidden">
        <Button variant="outline" onClick={back}><ArrowLeftIcon data-icon="inline-start" /> Back</Button>
        <h1 className="text-sm font-medium">
          {PRINT_KIND_LABELS[kind]}s · {ids.length} {ids.length === 1 ? 'order' : 'orders'}
        </h1>
        <Button onClick={() => window.print()} disabled={!ready}><PrinterIcon data-icon="inline-start" /> Print</Button>
      </div>
      <main className="flex flex-col gap-6 p-4 print:gap-0 print:p-0">
        {ids.length === 0 ? (
          <EmptyState title="No orders to print" description="Select orders on the web orders board and choose a print option." />
        ) : isPending ? (
          <LoadingState rows={6} label="Loading orders to print" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.orders.length === 0 ? (
          <EmptyState title="No orders to print" description="These orders could not be found." />
        ) : (
          data.orders.map((o) => <Sheet key={o.id} doc={data} order={o} timeZone={me.organization?.timezone} />)
        )}
      </main>
    </div>
  )
}
