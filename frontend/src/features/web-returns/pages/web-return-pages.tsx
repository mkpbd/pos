import { useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, BanIcon, CheckIcon, HandCoinsIcon, PackageCheckIcon, type LucideIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useWebReturnQuery, useWebReturnsQuery, type WebReturn, type WebReturnAction } from '@/features/web-returns/api'
import { ReturnActionDialog } from '@/features/web-returns/components/return-action-dialog'
import {
  ACTION_LABELS,
  customerName,
  historyActor,
  lineName,
  reasonLabel,
  refundMethodLabel,
  RETURN_TABS,
  returnActions,
  returnFiltersFromSearchParams,
  returnFiltersToSearchParams,
  returnStatusBadge,
  tabCount,
  tabLabel,
  toReturnListParams,
  trimQuantity,
  type ReturnFilters,
  type ReturnTab,
} from '@/features/web-returns/returns'
import { formatDateTime } from '@/features/web-orders/orders'
import { formatMoney, isZeroDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

// ── List ─────────────────────────────────────────────────────────────────────

/** /web-returns — returns on online orders, by status. */
export function WebReturnsPage() {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = returnFiltersFromSearchParams(searchParams)
  const [search, setSearch] = useState(filters.search)
  const term = useDebouncedValue(search.trim())
  const params = toReturnListParams(filters, term)
  const { data, error, isPending, refetch } = useWebReturnsQuery(params)
  const update = (patch: Partial<ReturnFilters>) => setSearchParams(returnFiltersToSearchParams({ ...filters, search: search.trim(), page: 1, ...patch }), { replace: true })
  const narrowed = !!term || filters.tab !== 'all'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Web returns"
        description="Returns on online orders: approve or reject requests, receive the goods back into stock and record the refund."
        actions={<ExportMenu list="webReturns" query={params} disabled={!data?.items.length} />}
      />

      <div className="overflow-x-auto">
        <Tabs value={filters.tab} onValueChange={(v) => update({ tab: v as ReturnTab })}>
          <TabsList aria-label="Return status">
            {RETURN_TABS.map((t) => {
              const count = tabCount(t, data?.statusCounts ?? null)
              return (
                <TabsTrigger key={t} value={t} className="gap-1.5">
                  {tabLabel(t)}
                  {count !== null && <span className="rounded-full bg-background/80 px-1.5 text-xs tabular-nums text-muted-foreground" data-testid={`count-${t}`}>{count}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      </div>

      <Input
        aria-label="Search web returns"
        placeholder="Return or order no., customer name"
        className="w-full sm:max-w-xs"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          if (filters.page !== 1) update({ search: e.target.value.trim() })
        }}
      />

      {isPending ? (
        <LoadingState rows={5} label="Loading returns" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={narrowed ? 'No returns match these filters' : 'No web returns yet'}
          description={narrowed ? undefined : 'Return requests from customers, and returns staff create on delivered orders, appear here.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Web returns">
              <TableHeader>
                <TableRow>
                  <TableHead>Return</TableHead>
                  <TableHead className="hidden sm:table-cell">Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Requested</TableHead>
                  <TableHead className="text-right">Refund</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => {
                  const status = returnStatusBadge(r.status, r.status_label)
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link to={`/web-returns/${r.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.number}</Link>
                        <div className="text-xs text-muted-foreground">{reasonLabel(r.reason_code, r.reason_label)}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Link to={`/web-orders/${r.order.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.order.number}</Link>
                      </TableCell>
                      <TableCell className="text-sm">{customerName(r) ?? <span className="text-muted-foreground">Guest</span>}</TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap md:table-cell">{formatDateTime(r.created_at, timeZone)}</TableCell>
                      <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(r.refund_amount, r.currency ?? currency)}</TableCell>
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

const ACTION_ICONS: Record<WebReturnAction, LucideIcon> = {
  approve: CheckIcon,
  reject: BanIcon,
  receive: PackageCheckIcon,
  refund: HandCoinsIcon,
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  )
}

function by(person: { name: string | null } | null | undefined): string {
  return person?.name ? ` · ${person.name}` : ''
}

/** Each step taken so far, from the timestamps (or the server's history when it sends one). */
function Timeline({ ret, timeZone }: { ret: WebReturn; timeZone: string | undefined }) {
  const entries =
    ret.history && ret.history.length > 0
      ? ret.history.map((h) => ({ label: h.label || returnStatusBadge(h.status).label, at: h.at, who: historyActor(h), note: h.note ?? null }))
      : [
          { label: 'Requested', at: ret.created_at, who: ret.requested_by === 'customer' ? 'Customer' : 'Staff', note: ret.customer_note },
          ret.approved_at ? { label: 'Approved', at: ret.approved_at, who: ret.approved_by?.name ?? 'Staff', note: ret.staff_note } : null,
          ret.rejected_at ? { label: 'Rejected', at: ret.rejected_at, who: ret.rejected_by?.name ?? 'Staff', note: ret.rejection_reason } : null,
          ret.received_at ? { label: 'Goods received', at: ret.received_at, who: ret.received_by?.name ?? 'Staff', note: null } : null,
          ret.refunded_at ? { label: 'Refunded', at: ret.refunded_at, who: ret.refunded_by?.name ?? 'Staff', note: null } : null,
          ret.cancelled_at ? { label: 'Cancelled by customer', at: ret.cancelled_at, who: 'Customer', note: null } : null,
        ].filter((e) => e !== null)

  return (
    <ol className="flex flex-col gap-3 border-l pl-4 text-sm" aria-label="Return history">
      {entries.map((h, i) => (
        <li key={i} className="relative">
          <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary" aria-hidden />
          <div className="font-medium">{h.label}</div>
          <div className="text-xs text-muted-foreground">{formatDateTime(h.at, timeZone)} · {h.who}</div>
          {h.note && <div className="text-xs">{h.note}</div>}
        </li>
      ))}
    </ol>
  )
}

/** /web-returns/:returnId — one return and the next step for it. */
export function WebReturnPage() {
  const { returnId } = useParams()
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const { data: ret, error, isPending, refetch } = useWebReturnQuery(returnId)
  const [action, setAction] = useState<WebReturnAction | null>(null)

  if (isPending) return <LoadingState rows={6} label="Loading return" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const c = ret.currency ?? me.organization?.base_currency
  const status = returnStatusBadge(ret.status, ret.status_label)
  const actions = can('web_orders.refund') ? returnActions(ret) : []
  const decided = ret.lines.some((l) => l.restock !== null)
  const name = customerName(ret)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to web returns"><Link to="/web-returns"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{ret.number}</h1>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Return actions" role="group">
            {actions.map((a) => {
              const Icon = ACTION_ICONS[a]
              return (
                <Button key={a} variant={a === 'reject' ? 'outline' : 'default'} onClick={() => setAction(a)}>
                  <Icon data-icon="inline-start" /> {ACTION_LABELS[a]}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      {ret.status === 'rejected' && ret.rejection_reason && (
        <p role="note" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Rejected:</span> {ret.rejection_reason}
        </p>
      )}
      {ret.override_window && (
        <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">Accepted after the return window closed.</p>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Return</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Field label="Order"><Link to={`/web-orders/${ret.order.id}`} className="font-mono underline-offset-4 hover:underline">{ret.order.number}</Link></Field>
              <Field label="Customer">{name ?? 'Guest'}</Field>
              <Field label="Reason">{reasonLabel(ret.reason_code, ret.reason_label)}</Field>
              <Field label="Requested by">{ret.requested_by === 'customer' ? 'Customer' : 'Staff'} · {formatDateTime(ret.created_at, timeZone)}</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Field label="Customer note">{ret.customer_note || '—'}</Field>
              <Field label="Staff note">{ret.staff_note || '—'}</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Refund</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Field label="Amount"><span className="font-mono" data-testid="refund-amount">{formatMoney(ret.refund_amount, c)}</span></Field>
              {!isZeroDecimal(ret.shipping_refund) && <Field label="Includes delivery"><span className="font-mono">{formatMoney(ret.shipping_refund)}</span></Field>}
              {ret.status === 'refunded' ? (
                <Field label="Paid back">
                  {refundMethodLabel(ret.refund_method, ret.refund_method_label)}
                  {ret.refund_reference && <span className="font-mono text-muted-foreground"> · {ret.refund_reference}</span>}
                  {ret.refunded_at && <span className="block text-xs font-normal text-muted-foreground">{formatDateTime(ret.refunded_at, timeZone)}{by(ret.refunded_by)}</span>}
                </Field>
              ) : (
                <Field label="Paid back">{ret.status === 'rejected' || ret.status === 'cancelled' ? 'No refund' : 'Not yet'}</Field>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Returned items">
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {decided && <TableHead>Stock</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ret.lines.map((l) => (
              <TableRow key={l.id ?? l.order_line_id}>
                <TableCell>
                  <div className="font-medium">{lineName(l)}</div>
                  {l.sku && <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>}
                </TableCell>
                <TableCell className="text-right">
                  {trimQuantity(l.quantity)}
                  {l.ordered_quantity && <span className="block text-xs text-muted-foreground">of {trimQuantity(l.ordered_quantity)}</span>}
                </TableCell>
                <TableCell className="text-right font-mono">{formatMoney(l.amount)}</TableCell>
                {decided && (
                  <TableCell data-testid="line-stock">
                    {l.restock ? <Badge variant="success">Restocked{l.restocked_quantity ? ` ${trimQuantity(l.restocked_quantity)}` : ''}</Badge> : <Badge variant="outline">Written off</Badge>}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent><Timeline ret={ret} timeZone={timeZone} /></CardContent>
      </Card>

      {action && <ReturnActionDialog key={action} ret={ret} action={action} onClose={() => setAction(null)} />}
    </div>
  )
}
