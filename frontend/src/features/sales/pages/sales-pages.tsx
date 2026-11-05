import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, BanIcon, BanknoteIcon, PercentIcon, PrinterIcon, ReceiptTextIcon, TrendingUpIcon, Undo2Icon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import { lineLabel, salesListQuery, useCancelSaleMutation, useSaleQuery, useSalesQuery, useSalesSummaryQuery, type SaleStatus } from '@/features/sales/api'
import { ReceiptDialog } from '@/features/sales/components/receipt-dialog'
import { RETURN_STATUS, returnableQuantity } from '@/features/returns/status'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const todayIso = () => new Date().toLocaleDateString('en-CA')

function SummaryCards({ date }: { date: string }) {
  const { data, error, isPending, refetch } = useSalesSummaryQuery({ date })
  if (isPending) return <LoadingState rows={2} label="Loading summary" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const c = data.currency
  const cards = [
    { label: 'Sales', icon: ReceiptTextIcon, value: String(data.sales_count), sub: `avg ${formatMoney(data.average_sale, c)}` },
    { label: 'Revenue (incl. tax)', icon: BanknoteIcon, value: formatMoney(data.total, c), sub: `net ${formatMoney(data.net_sales)} · tax ${formatMoney(data.tax)}` },
    ...(data.gross_profit !== null ? [{ label: 'Gross profit', icon: TrendingUpIcon, value: formatMoney(data.gross_profit, c), sub: `cost ${formatMoney(data.cost)}` }] : []),
    { label: 'Discounts', icon: PercentIcon, value: formatMoney(data.discounts, c), sub: `${data.cancelled_count} cancelled (${formatMoney(data.cancelled_total)})` },
    { label: 'Due on account', icon: WalletIcon, value: formatMoney(data.due, c), sub: `paid ${formatMoney(data.paid)}` },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.label} size="sm">
            <CardContent className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="mb-2">{card.label}</CardTitle>
                <div className="font-mono text-xl font-bold text-primary">{card.value}</div>
                <div className="text-xs text-muted-foreground">{card.sub}</div>
              </div>
              <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground sm:flex">
                <card.icon className="size-5" aria-hidden />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm" aria-label="Payments by method">
        {data.payments.map((p) => (
          <Badge key={p.method} variant="outline" className="font-normal">{p.label}: <span className="font-mono">{formatMoney(p.amount, c)}</span></Badge>
        ))}
      </div>
    </div>
  )
}

export function SalesPage() {
  const can = useCan()
  const [date, setDate] = useState(todayIso)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<SaleStatus | 'all'>('all')
  const term = useDebouncedValue(search.trim())
  const filters = { search: term || undefined, status: status === 'all' ? undefined : status, from: date, to: date }
  const { data, error, isPending, refetch } = useSalesQuery({ page, ...filters })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sales" description="Daily summary and sales history of your branches." actions={
          <>
            <ExportMenu list="sales" query={salesListQuery(filters)} disabled={!data?.items.length} />
            {can('pos.sell') && <Button asChild><Link to="/pos">Open POS terminal</Link></Button>}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sales-date">Day</Label>
          <Input id="sales-date" type="date" className="w-44" value={date} max={todayIso()} onChange={(e) => { setDate(e.target.value || todayIso()); setPage(1) }} />
        </div>
      </div>
      {can('sales.view') && <SummaryCards date={date} />}

      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search invoices" placeholder="Invoice number" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <Select value={status} onValueChange={(v) => { setStatus(v as SaleStatus | 'all'); setPage(1) }}>
          <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sales</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <LoadingState rows={5} label="Loading sales" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No sales on this day" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="hidden md:table-cell">Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Cashier</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link to={`/sales/${s.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{s.number}</Link>
                      {s.status === 'cancelled' && <Badge variant="destructive" className="ml-2">Cancelled</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{new Date(s.sold_at).toLocaleTimeString()}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{s.customer?.name ?? 'Walk-in'}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{s.cashier?.name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(s.total, s.currency)}</TableCell>
                    <TableCell className="hidden text-right font-mono sm:table-cell">{isZeroDecimal(s.due_total) ? '—' : formatMoney(s.due_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

export function SalePage() {
  const { saleId } = useParams()
  const can = useCan()
  const { data: sale, error, isPending, refetch } = useSaleQuery(saleId)
  const cancel = useCancelSaleMutation()
  const [printing, setPrinting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')

  if (isPending) return <LoadingState rows={6} label="Loading sale" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const c = sale.currency

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to sales"><Link to="/sales"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{sale.number}</h1>
          {sale.status === 'cancelled' ? <Badge variant="destructive">Cancelled</Badge> : <Badge variant="success">Completed</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPrinting(true)}><PrinterIcon data-icon="inline-start" /> Receipt</Button>
          {can('returns.create') && sale.status === 'completed' && sale.lines.some((l) => !isZeroDecimal(returnableQuantity(l)) && !returnableQuantity(l).startsWith('-')) && (
            <Button asChild variant="outline"><Link to={`/sales/${sale.id}/return`}><Undo2Icon data-icon="inline-start" /> Return items</Link></Button>
          )}
          {can('sales.cancel') && sale.status === 'completed' && sale.returns.length === 0 && (
            <Button variant="destructive" onClick={() => { setReason(''); setCancelling(true) }}><BanIcon data-icon="inline-start" /> Cancel sale</Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-4">
          <div><span className="text-muted-foreground">Sold</span><div className="font-medium">{new Date(sale.sold_at).toLocaleString()}</div></div>
          <div><span className="text-muted-foreground">Customer</span><div className="font-medium">{sale.customer?.name ?? 'Walk-in'}</div></div>
          <div><span className="text-muted-foreground">Cashier</span><div className="font-medium">{sale.cashier?.name ?? '—'}</div></div>
          <div><span className="text-muted-foreground">Store</span><div className="font-medium">{sale.store?.name} · {sale.branch?.name}</div></div>
          {sale.status === 'cancelled' && (
            <div className="sm:col-span-4"><span className="text-muted-foreground">Cancelled</span><div className="font-medium">{sale.cancelled_at && new Date(sale.cancelled_at).toLocaleString()} by {sale.cancelled_by ?? '—'}: {sale.cancellation_reason}</div></div>
          )}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Tax</TableHead>
              {sale.cost_total !== null && <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>}
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{lineLabel(l)}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {l.sku}
                    {l.batches.map((b) => ` · ${b.batch_number} (${trimDecimal(b.quantity)}${b.expires_on ? `, exp ${b.expires_on}` : ''})`).join('')}
                    {l.serials.length > 0 && ` · S/N ${l.serials.join(', ')}`}
                  </div>
                </TableCell>
                <TableCell className="text-right">{trimDecimal(l.quantity)} {l.unit_code}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(l.unit_price)}</TableCell>
                <TableCell className="text-right font-mono">{isZeroDecimal(l.discount_amount) && isZeroDecimal(l.invoice_discount_share) ? '—' : `−${formatMoney(l.discount_amount)}${isZeroDecimal(l.invoice_discount_share) ? '' : ` / −${formatMoney(l.invoice_discount_share)}`}`}</TableCell>
                <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(l.tax_amount)} <span className="text-xs text-muted-foreground">({trimDecimal(l.tax_rate)}%)</span></TableCell>
                {sale.cost_total !== null && <TableCell className="hidden text-right font-mono md:table-cell">{l.unit_cost && formatMoney(l.unit_cost, undefined, 4)}</TableCell>}
                <TableCell className="text-right font-mono">{formatMoney(l.line_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {sale.payments.length === 0 && <p className="text-muted-foreground">No payment taken (full amount on account).</p>}
            {sale.payments.map((p) => (
              <div key={p.id} className="flex justify-between gap-2">
                <span>
                  {p.kind === 'reversal' ? 'Refunded — ' : ''}{p.method_label}{p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  {p.tendered && <span className="text-muted-foreground"> (tendered {formatMoney(p.tendered)})</span>}
                </span>
                <span className="font-mono">{formatMoney(p.amount, c)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right font-mono">{formatMoney(sale.subtotal)}</dd>
              <dt className="text-muted-foreground">Discounts{sale.invoice_discount?.source === 'customer_group' && ' (incl. customer group)'}</dt>
              <dd className="text-right font-mono">−{formatMoney(sale.item_discount_total)} / −{formatMoney(sale.invoice_discount_total)}</dd>
              <dt className="text-muted-foreground">Tax ({sale.tax_mode})</dt><dd className="text-right font-mono">{formatMoney(sale.tax_total)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{formatMoney(sale.total, c)}</dd>
              <dt className="text-muted-foreground">Paid</dt><dd className="text-right font-mono">{formatMoney(sale.paid_total)}</dd>
              <dt className="text-muted-foreground">Change</dt><dd className="text-right font-mono">{formatMoney(sale.change_total)}</dd>
              <dt className="text-muted-foreground">Due</dt><dd className="text-right font-mono">{formatMoney(sale.due_total)}</dd>
              {sale.cost_total !== null && (<><dt className="text-muted-foreground">Cost of goods</dt><dd className="text-right font-mono">{formatMoney(sale.cost_total)}</dd></>)}
            </dl>
          </CardContent>
        </Card>
      </div>

      {sale.returns.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Returns</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {sale.returns.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {can('returns.view') ? <Link to={`/returns/${r.id}`} className="font-mono underline-offset-4 hover:underline">{r.number}</Link> : <span className="font-mono">{r.number}</span>}
                  <Badge variant={RETURN_STATUS[r.status].variant}>{RETURN_STATUS[r.status].label}</Badge>
                  <span className="text-muted-foreground">{new Date(r.requested_at).toLocaleString()}</span>
                </span>
                <span className="font-mono">{formatMoney(r.total, c)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ReceiptDialog sale={sale} open={printing} onOpenChange={setPrinting} title={`Receipt ${sale.number}`} />
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {sale.number}?</DialogTitle>
            <DialogDescription>
              All {sale.lines.length} lines go back into stock and {formatMoney(sale.paid_total, c)} is recorded as refunded. The invoice stays in the history as cancelled.
            </DialogDescription>
          </DialogHeader>
          <form
            id="cancel-sale-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!reason.trim()) return
              cancel.mutate({ id: sale.id, reason: reason.trim() }, {
                onSuccess: (s) => { toast.success(`${s.number} cancelled.`); setCancelling(false) },
                onError: (err) => toast.error(err.message),
              })
            }}
            className="flex flex-col gap-1.5"
          >
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input id="cancel-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. rung up by mistake" />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>Keep sale</Button>
            <Button type="submit" form="cancel-sale-form" variant="destructive" disabled={!reason.trim() || cancel.isPending}>Cancel sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
