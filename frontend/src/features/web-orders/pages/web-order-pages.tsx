import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, BanIcon, CheckIcon, HandCoinsIcon, PackageCheckIcon, PackageIcon, TruckIcon, XIcon, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useWebOrderQuery, useWebOrdersQuery, WEB_ORDER_ACTIONS, type WebOrder, type WebOrderAction, type WebOrderStatus, type WebPaymentStatus } from '@/features/web-orders/api'
import { OrderActionDialog } from '@/features/web-orders/components/order-action-dialog'
import {
  ACTION_LABELS,
  customerCancellation,
  etaLabel,
  FILTER_STATUSES,
  filtersFromSearchParams,
  filtersToSearchParams,
  formatDateTime,
  historyActor,
  historyLabel,
  isCustomerCancellation,
  ORDER_STATUS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
  paymentBadge,
  paymentRecorder,
  promotionKindLabel,
  statusBadge,
  toListParams,
  type WebOrderFilters,
} from '@/features/web-orders/orders'
import { addDecimal, formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

// ── List ─────────────────────────────────────────────────────────────────────

export function WebOrdersPage() {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = filtersFromSearchParams(searchParams)
  // The box is local so typing stays smooth; the URL follows the debounced term.
  const [search, setSearch] = useState(filters.search)
  const term = useDebouncedValue(search.trim())
  const { data, error, isPending, refetch } = useWebOrdersQuery(toListParams(filters, term))

  const update = (patch: Partial<WebOrderFilters>) =>
    setSearchParams(filtersToSearchParams({ ...filters, search: search.trim(), page: 1, ...patch }), { replace: true })
  const filtered = !!(filters.status || filters.paymentStatus || filters.from || filters.to || term)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Web orders" description="Orders placed on your online store. Confirm payments, ship and track them here." />
      <div className="flex flex-wrap items-end gap-3">
        <Input
          aria-label="Search web orders"
          placeholder="Order no., name, phone or e-mail"
          className="w-full sm:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (filters.page !== 1) update({ search: e.target.value.trim() })
          }}
        />
        <Select value={filters.status ?? ALL} onValueChange={(v) => update({ status: v === ALL ? null : (v as WebOrderStatus) })}>
          <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {FILTER_STATUSES.map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.paymentStatus ?? ALL} onValueChange={(v) => update({ paymentStatus: v === ALL ? null : (v as WebPaymentStatus) })}>
          <SelectTrigger className="w-40" aria-label="Filter by payment"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Paid and unpaid</SelectItem>
            {(Object.keys(PAYMENT_STATUS) as WebPaymentStatus[]).map((s) => <SelectItem key={s} value={s}>{PAYMENT_STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orders-from">Placed from</Label>
          <Input id="orders-from" type="date" className="w-40" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orders-to">To</Label>
          <Input id="orders-to" type="date" className="w-40" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('')
              setSearchParams(new URLSearchParams(), { replace: true })
            }}
          >
            <XIcon data-icon="inline-start" /> Clear filters
          </Button>
        )}
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading web orders" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={filtered ? 'No orders match these filters' : 'No web orders yet'} description={filtered ? undefined : 'Orders placed on the online store appear here.'} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead className="hidden md:table-cell">Placed</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => {
                  const status = statusBadge(o.status)
                  const payment = paymentBadge(o.payment_status)
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link to={`/web-orders/${o.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{o.number}</Link>
                        <div className="text-xs text-muted-foreground">{o.item_count} {o.item_count === 1 ? 'item' : 'items'}</div>
                      </TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap md:table-cell">{formatDateTime(o.placed_at, timeZone)}</TableCell>
                      <TableCell className="text-sm">
                        {o.contact_name}
                        {o.contact_phone && <div className="text-xs text-muted-foreground">{o.contact_phone}</div>}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {PAYMENT_METHOD_LABELS[o.payment_method] ?? o.payment_method}
                        <div><Badge variant={payment.variant}>{payment.label}</Badge></div>
                      </TableCell>
                      <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(o.total, o.currency)}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={(page) => update({ page })} />
        </>
      )}
    </div>
  )
}

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
        {order.payments.length === 0 ? (
          <p className="text-muted-foreground">No payment recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Payments">
            {order.payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-2 border-t pt-2">
                <span>
                  {p.method_label ?? p.method.replaceAll('_', ' ')}
                  {p.reference && <span className="font-mono text-muted-foreground"> · {p.reference}</span>}
                  <span className="block text-xs text-muted-foreground">{formatDateTime(p.recorded_at, timeZone)} · {paymentRecorder(p)}</span>
                </span>
                <span className="font-mono">{formatMoney(p.amount, order.currency)}</span>
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
              {(order.courier_name || order.tracking_number) && (
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
