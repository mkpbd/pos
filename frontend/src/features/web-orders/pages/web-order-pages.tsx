import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, BanIcon, CheckIcon, HandCoinsIcon, PackageCheckIcon, PackageIcon, PrinterIcon, TruckIcon, type LucideIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useWebOrderQuery, WEB_ORDER_ACTIONS, type WebOrder, type WebOrderAction } from '@/features/web-orders/api'
import { OrderActionDialog } from '@/features/web-orders/components/order-action-dialog'
import { ShipmentCard } from '@/features/web-orders/components/shipment-card'
import { OrderReturnsCard } from '@/features/web-returns/components/order-returns-card'
import {
  ACTION_LABELS,
  customerCancellation,
  etaLabel,
  formatDateTime,
  historyActor,
  historyLabel,
  isCustomerCancellation,
  PAYMENT_METHOD_LABELS,
  paymentBadge,
  paymentRecorder,
  printPath,
  promotionKindLabel,
  statusBadge,
} from '@/features/web-orders/orders'
import { addDecimal, formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'

export { WebOrdersPage } from '@/features/web-orders/pages/web-orders-board'

// ── Detail ───────────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<WebOrderAction, LucideIcon> = {
  confirm_payment: CheckIcon,
  process: PackageIcon,
  ship: TruckIcon,
  deliver: PackageCheckIcon,
  record_cod_payment: HandCoinsIcon,
  cancel: BanIcon,
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  )
}

/** A discount in the totals: the promotion's name, its kind and the amount taken off. */
function DiscountRow({ label, detail, amount }: { label: string; detail?: string; amount: string }) {
  return (
    <>
      <dt className="text-muted-foreground">
        {label}
        {detail && <span className="block text-xs">{detail}</span>}
      </dt>
      <dd className="text-right font-mono text-success-soft-foreground">−{formatMoney(amount)}</dd>
    </>
  )
}

function PaymentCard({ order, timeZone }: { order: WebOrder; timeZone: string | undefined }) {
  const canRemit = useCan()('web_orders.remit')
  const payment = paymentBadge(order.payment_status)
  const awaitingTransfer = order.payment_method === 'bank_transfer' && order.status === 'pending_payment'

  return (
    <Card>
      <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{order.payment_method_label || PAYMENT_METHOD_LABELS[order.payment_method]}</span>
          <Badge variant={payment.variant}>{payment.label}</Badge>
        </div>
        {awaitingTransfer && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-2" data-testid="awaiting-transfer">
            Waiting for the customer's bank transfer.
            {order.expires_at && <> The order is cancelled automatically if it is not confirmed by <strong>{formatDateTime(order.expires_at, timeZone)}</strong>.</>}
          </p>
        )}
        {order.payment_instructions && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">Instructions the customer received</summary>
            <p className="mt-1 whitespace-pre-line">{order.payment_instructions}</p>
          </details>
        )}
        {order.cod_remittance && (
          <p data-testid="order-remittance">
            Paid through courier remittance{' '}
            {canRemit ? (
              <Link to={`/cod-remittances/${order.cod_remittance.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{order.cod_remittance.number}</Link>
            ) : (
              <span className="font-mono font-medium">{order.cod_remittance.number}</span>
            )}
          </p>
        )}
        {!isZeroDecimal(order.refunded_total) && (
          <p data-testid="order-refunded">Refunded <span className="font-mono font-medium">{formatMoney(order.refunded_total, order.currency)}</span> on returns.</p>
        )}
        {order.payments.length === 0 ? (
          <p className="text-muted-foreground">No payment recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Payments">
            {order.payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-2 border-t pt-2">
                <span>
                  {p.direction === 'out' && 'Refund · '}
                  {p.method_label ?? p.method.replaceAll('_', ' ')}
                  {p.reference && <span className="font-mono text-muted-foreground"> · {p.reference}</span>}
                  <span className="block text-xs text-muted-foreground">{formatDateTime(p.recorded_at, timeZone)} · {paymentRecorder(p)}</span>
                </span>
                <span className="font-mono" data-testid={p.direction === 'out' ? 'payment-refund' : undefined}>{p.direction === 'out' && '−'}{formatMoney(p.amount, order.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function WebOrderPage() {
  const { orderId } = useParams()
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const { data: order, error, isPending, refetch } = useWebOrderQuery(orderId)
  const [action, setAction] = useState<WebOrderAction | null>(null)

  if (isPending) return <LoadingState rows={6} label="Loading order" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const c = order.currency
  const status = statusBadge(order.status)
  const actions = can('web_orders.manage') ? WEB_ORDER_ACTIONS.filter((a) => order.allowed_actions.includes(a)) : []
  const address = order.shipping_address
  const eta = etaLabel(order.eta_min_days, order.eta_max_days)
  const lineDiscounts = order.lines.some((l) => !isZeroDecimal(l.discount_amount))
  const discountLines = (order.promotions ?? []).filter((p) => p.kind !== 'shipping')
  const shippingPromotion = (order.promotions ?? []).find((p) => p.kind === 'shipping')
  const shippingWaived = !isZeroDecimal(order.shipping_discount)
  const cancelledByCustomer = customerCancellation(order)
  const customerReason = cancelledByCustomer ? order.cancel_reason || cancelledByCustomer.note || null : null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to web orders"><Link to="/web-orders"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{order.number}</h1>
          <Badge variant={status.variant}>{order.status_label || status.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap gap-2" aria-label="Print" role="group">
            <Button asChild variant="outline"><Link to={printPath([order.id], 'packing_slip')}><PrinterIcon data-icon="inline-start" /> Packing slip</Link></Button>
            <Button asChild variant="outline"><Link to={printPath([order.id], 'invoice')}><PrinterIcon data-icon="inline-start" /> Invoice</Link></Button>
          </div>
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Order actions" role="group">
              {actions.map((a) => {
                const Icon = ACTION_ICONS[a]
                return (
                  <Button key={a} variant={a === 'cancel' ? 'outline' : 'default'} onClick={() => setAction(a)}>
                    <Icon data-icon="inline-start" /> {ACTION_LABELS[a]}
                  </Button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <p className="-mt-4 text-sm text-muted-foreground">Placed {formatDateTime(order.placed_at, timeZone)}</p>

      {cancelledByCustomer ? (
        <p role="note" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Cancelled by customer</span>
          {customerReason ? <>: {customerReason}</> : ' (no reason given)'}
        </p>
      ) : (
        order.status === 'cancelled' &&
        order.cancel_reason && (
          <p role="note" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="font-medium">Cancelled:</span> {order.cancel_reason}
          </p>
        )
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Field label="Name">{order.contact.name}</Field>
              {order.contact.phone && <Field label="Phone">{order.contact.phone}</Field>}
              {order.contact.email && <Field label="E-mail">{order.contact.email}</Field>}
              <Field label="Account">{order.customer ? `${order.customer.name}${order.customer.code ? ` (${order.customer.code})` : ''}` : 'Guest checkout'}</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Delivery</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              {address ? (
                <Field label="Address">
                  <address className="not-italic">
                    {address.recipient_name}{address.phone && ` · ${address.phone}`}
                    <br />
                    {address.address_line}
                    {address.area && <>, {address.area}</>}
                    <br />
                    {[address.district, address.division].filter(Boolean).join(', ')}
                    {address.postcode && ` ${address.postcode}`}
                  </address>
                </Field>
              ) : (
                <Field label="Address">—</Field>
              )}
              <Field label="Method">{order.shipping_method_name ?? '—'}{eta && <span className="font-normal text-muted-foreground"> · {eta}</span>}</Field>
              {!order.shipment && (order.courier_name || order.tracking_number) && (
                <Field label="Courier">
                  {order.courier_name ?? '—'}
                  {order.tracking_number && <span className="block font-mono text-xs">Tracking {order.tracking_number}</span>}
                </Field>
              )}
            </dl>
          </CardContent>
        </Card>
        <PaymentCard order={order} timeZone={timeZone} />
      </div>

      {order.shipment && <ShipmentCard order={order} shipment={order.shipment} timeZone={timeZone} canManage={can('web_orders.manage')} />}

      <OrderReturnsCard order={order} timeZone={timeZone} />

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
              {lineDiscounts && <TableHead className="text-right">Discount</TableHead>}
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {l.image_url ? (
                      <img src={l.image_url} alt="" className="size-10 shrink-0 rounded border object-cover" loading="lazy" />
                    ) : (
                      <div className="size-10 shrink-0 rounded border bg-muted" aria-hidden />
                    )}
                    <div>
                      <div className="font-medium">{l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name}</div>
                      {l.sku && <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">{trimDecimal(l.quantity)}</TableCell>
                <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(l.unit_price)}</TableCell>
                {lineDiscounts && (
                  <TableCell className="text-right font-mono whitespace-nowrap" data-testid="line-discount">{isZeroDecimal(l.discount_amount) ? '—' : `−${formatMoney(l.discount_amount)}`}</TableCell>
                )}
                <TableCell className="text-right font-mono">{formatMoney(l.line_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm" aria-label="Order totals">
              <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right font-mono">{formatMoney(order.subtotal)}</dd>
              {discountLines.map((p, i) => (
                <DiscountRow key={i} label={p.name} detail={promotionKindLabel(p.kind)} amount={p.amount} />
              ))}
              {discountLines.length === 0 && !isZeroDecimal(order.discount_total) && <DiscountRow label="Discounts" amount={order.discount_total ?? '0'} />}
              <dt className="text-muted-foreground">{order.prices_include_tax ? 'VAT (included)' : 'VAT'}</dt><dd className="text-right font-mono">{formatMoney(order.tax_total)}</dd>
              <dt className="text-muted-foreground">
                Delivery
                {shippingWaived && <span className="block text-xs">{shippingPromotion?.name ?? 'Free shipping'} · {formatMoney(order.shipping_discount)} waived</span>}
              </dt>
              <dd className="text-right font-mono" data-testid="order-delivery">
                {shippingWaived && <s className="mr-1 text-muted-foreground">{formatMoney(addDecimal(order.shipping_total, order.shipping_discount ?? '0', 2))}</s>}
                {isZeroDecimal(order.shipping_total) ? 'Free' : formatMoney(order.shipping_total)}
              </dd>
              {!isZeroDecimal(order.cod_fee) && <><dt className="text-muted-foreground">Cash on delivery fee</dt><dd className="text-right font-mono">{formatMoney(order.cod_fee)}</dd></>}
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold" data-testid="order-total">{formatMoney(order.total, c)}</dd>
            </dl>
            {order.coupon_code && (
              <p className="mt-4 text-sm" data-testid="order-coupon"><span className="text-muted-foreground">Coupon code:</span> <span className="font-mono font-medium">{order.coupon_code}</span></p>
            )}
            {!isZeroDecimal(order.discount_total) && (
              <p className="mt-1 text-sm text-muted-foreground">Total discount {formatMoney(order.discount_total, c)}{shippingWaived && ` plus ${formatMoney(order.shipping_discount)} delivery`}.</p>
            )}
            {order.notes && <p className="mt-4 text-sm"><span className="text-muted-foreground">Customer note:</span> {order.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 border-l pl-4 text-sm" aria-label="Status history">
              {order.history.map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
                  <div className="font-medium">{historyLabel(h)}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(h.at, timeZone)} · {historyActor(h)}</div>
                  {h.note && <div className="text-xs">{isCustomerCancellation(h) ? `Reason: ${h.note}` : h.note}</div>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      {(order.ip || order.user_agent) && (
        <p className="text-xs break-all text-muted-foreground">
          Placed from {order.ip ?? 'unknown address'}{order.user_agent && ` · ${order.user_agent}`}
        </p>
      )}

      {action && <OrderActionDialog key={action} order={order} action={action} onClose={() => setAction(null)} />}
    </div>
  )
}
