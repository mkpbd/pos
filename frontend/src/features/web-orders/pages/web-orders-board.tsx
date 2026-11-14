import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { BanknoteIcon, Loader2Icon, MegaphoneIcon, PackageIcon, PrinterIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { useCouriersQuery, useDistrictsQuery } from '@/features/shipping/api'
import { sortCouriers } from '@/features/shipping/shipping'
import { useBulkProcessMutation, useWebOrdersQuery, type BulkResult, type WebOrderRow, type WebOrderSource, type WebPaymentMethod } from '@/features/web-orders/api'
import {
  BOARD_TABS,
  boardTabCount,
  boardTabLabel,
  bulkErrorLabel,
  bulkSummary,
  filtersFromSearchParams,
  filtersToSearchParams,
  formatDateTime,
  hasFilters,
  ORDER_SOURCE_LABELS,
  PAYMENT_METHOD_LABELS,
  paymentBadge,
  printPath,
  statusBadge,
  toListParams,
  type BoardTab,
  type WebOrderFilters,
} from '@/features/web-orders/orders'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

/** Campaign-page orders and campaign-credited orders say so under the order number (P2a). */
function OrderOriginLine({ order }: { order: WebOrderRow }) {
  if (order.source !== 'landing_page' && !order.campaign) return null
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs" data-testid={`order-origin-${order.id}`}>
      {order.source === 'landing_page' && <Badge variant="soft">Campaign page</Badge>}
      {order.campaign && <span className="text-muted-foreground"><span className="sr-only">Campaign: </span><MegaphoneIcon className="mr-0.5 inline size-3" aria-hidden />{order.campaign.name}</span>}
    </div>
  )
}

/** Per-order outcome of "Mark processing"; refused orders say why. */
function BulkResultDialog({ results, onClose }: { results: BulkResult[]; onClose: () => void }) {
  const refused = results.filter((r) => !r.ok)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark processing</DialogTitle>
          <DialogDescription>{bulkSummary(results)}</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-sm" aria-label="Results per order">
          {results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0">
              {r.number ? <Link to={`/web-orders/${r.id}`} className="font-mono underline-offset-4 hover:underline">{r.number}</Link> : <span className="text-muted-foreground">Unknown order</span>}
              {r.ok ? <Badge variant="success">Processing</Badge> : <span className="text-destructive">Not changed: {bulkErrorLabel(r.error_code, r.message)}</span>}
            </li>
          ))}
        </ul>
        {refused.length > 0 && <p className="text-sm text-muted-foreground">Only confirmed orders can move to Processing. Open an order to see where it stands.</p>}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** /web-orders — the fulfilment board: status tabs with counts, filters in the URL and bulk actions on a page of orders. */
export function WebOrdersPage() {
  const me = useAuth()
  const can = useCan()
  const navigate = useNavigate()
  const timeZone = me.organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = filtersFromSearchParams(searchParams)
  // The box is local so typing stays smooth; the URL follows the debounced term.
  const [search, setSearch] = useState(filters.search)
  const term = useDebouncedValue(search.trim())
  const params = toListParams(filters, term)
  const { data, error, isPending, refetch } = useWebOrdersQuery(params)
  const couriers = useCouriersQuery()
  const districts = useDistrictsQuery()
  const bulk = useBulkProcessMutation()
  const idempotency = useIdempotencyKey()
  const [results, setResults] = useState<BulkResult[] | null>(null)

  // Selection belongs to one page of one list: changing the tab, a filter or the page starts over.
  const listKey = JSON.stringify(params)
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: listKey, ids: [] })
  const selected = selection.key === listKey ? selection.ids : []
  const setSelected = (ids: string[]) => setSelection({ key: listKey, ids })

  const update = (patch: Partial<WebOrderFilters>) =>
    setSearchParams(filtersToSearchParams({ ...filters, search: search.trim(), page: 1, ...patch }), { replace: true })
  const filtered = hasFilters(filters, term)
  const rows = data?.items ?? []
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id))
  const someSelected = selected.length > 0 && !allSelected
  const canManage = can('web_orders.manage')

  const toggle = (row: WebOrderRow, on: boolean) => setSelected(on ? [...selected, row.id] : selected.filter((id) => id !== row.id))

  const markProcessing = () => {
    if (bulk.isPending || selected.length === 0) return
    const orderIds = [...selected]
    bulk.mutate(
      { orderIds, idempotencyKey: idempotency.keyFor({ orderIds }) },
      {
        onSuccess: (res) => {
          idempotency.settle()
          setResults(res)
          setSelected(selected.filter((id) => !res.some((r) => r.id === id && r.ok)))
        },
        onError: (e) => {
          idempotency.settle(e)
          toast.error(e.message)
          if (isRetryable(e)) toast.message('You can press the button again to retry safely.')
        },
      },
    )
  }

  const courierList = sortCouriers(couriers.data ?? [])
  const districtList = [...(districts.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Web orders"
        description="Orders placed on your online store. Confirm payments, pack, print, ship and track them here."
        actions={<ExportMenu list="webOrders" query={params} disabled={!data?.items.length} />}
      />

      <div className="overflow-x-auto">
        <Tabs value={filters.tab} onValueChange={(v) => update({ tab: v as BoardTab })}>
          <TabsList aria-label="Order status">
            {BOARD_TABS.map((t) => {
              const count = boardTabCount(t, data?.statusCounts ?? null)
              return (
                <TabsTrigger key={t} value={t} className="gap-1.5">
                  {boardTabLabel(t)}
                  {count !== null && <span className="rounded-full bg-background/80 px-1.5 text-xs tabular-nums text-muted-foreground" data-testid={`count-${t}`}>{count}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      </div>

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
        <Select value={filters.courierId ?? ALL} onValueChange={(v) => update({ courierId: v === ALL ? null : v })}>
          <SelectTrigger className="w-40" aria-label="Filter by courier"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All couriers</SelectItem>
            {courierList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{!c.is_active && ' (inactive)'}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.paymentMethod ?? ALL} onValueChange={(v) => update({ paymentMethod: v === ALL ? null : (v as WebPaymentMethod) })}>
          <SelectTrigger className="w-44" aria-label="Filter by payment method"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payment methods</SelectItem>
            {(Object.keys(PAYMENT_METHOD_LABELS) as WebPaymentMethod[]).map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.source ?? ALL} onValueChange={(v) => update({ source: v === ALL ? null : (v as WebOrderSource) })}>
          <SelectTrigger className="w-44" aria-label="Filter by where the order was placed"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Store and campaign pages</SelectItem>
            {(Object.keys(ORDER_SOURCE_LABELS) as WebOrderSource[]).map((s) => <SelectItem key={s} value={s}>{s === 'storefront' ? 'Online store only' : 'Campaign pages only'}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.districtId ? String(filters.districtId) : ALL} onValueChange={(v) => update({ districtId: v === ALL ? null : Number(v) })}>
          <SelectTrigger className="w-40" aria-label="Filter by district"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All districts</SelectItem>
            {districtList.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
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
              setSearchParams(filtersToSearchParams({ ...filters, courierId: null, paymentMethod: null, districtId: null, source: null, search: '', from: '', to: '', page: 1 }), { replace: true })
            }}
          >
            <XIcon data-icon="inline-start" /> Clear filters
          </Button>
        )}
      </div>

      {filters.tab === 'cod_unremitted' && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Delivered cash-on-delivery orders whose money the courier has not paid over yet.
          {can('web_orders.remit') && (
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link to="/cod-remittances/new"><BanknoteIcon data-icon="inline-start" /> Record a remittance</Link>
            </Button>
          )}
        </p>
      )}

      {selected.length > 0 && (
        <div role="toolbar" aria-label="Selected orders" className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
          <span className="px-1 text-sm font-medium" aria-live="polite">{selected.length} selected</span>
          {canManage && (
            <Button size="sm" onClick={markProcessing} disabled={bulk.isPending}>
              {bulk.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PackageIcon data-icon="inline-start" />} Mark processing
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate(printPath(selected, 'packing_slip'))}><PrinterIcon data-icon="inline-start" /> Print packing slips</Button>
          <Button size="sm" variant="outline" onClick={() => navigate(printPath(selected, 'invoice'))}><PrinterIcon data-icon="inline-start" /> Print invoices</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>
        </div>
      )}

      {isPending ? (
        <LoadingState rows={6} label="Loading web orders" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered || filters.tab !== 'all' ? 'No orders match these filters' : 'No web orders yet'}
          description={filtered || filters.tab !== 'all' ? undefined : 'Orders placed on the online store appear here.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Web orders">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all orders on this page"
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={(v) => setSelected(v === true ? rows.map((r) => r.id) : [])}
                    />
                  </TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead className="hidden md:table-cell">Placed</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => {
                  const status = statusBadge(o.status)
                  const payment = paymentBadge(o.payment_status)
                  const isSelected = selected.includes(o.id)
                  return (
                    <TableRow key={o.id} data-state={isSelected ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox aria-label={`Select ${o.number}`} checked={isSelected} onCheckedChange={(v) => toggle(o, v === true)} />
                      </TableCell>
                      <TableCell>
                        <Link to={`/web-orders/${o.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{o.number}</Link>
                        <div className="text-xs text-muted-foreground">{o.item_count} {o.item_count === 1 ? 'item' : 'items'}</div>
                        <OrderOriginLine order={o} />
                      </TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap md:table-cell">{formatDateTime(o.placed_at, timeZone)}</TableCell>
                      <TableCell className="text-sm">
                        {o.contact_name}
                        {(o.contact_phone || o.district) && <div className="text-xs text-muted-foreground">{[o.contact_phone, o.district].filter(Boolean).join(' · ')}</div>}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {PAYMENT_METHOD_LABELS[o.payment_method] ?? o.payment_method}
                        <div><Badge variant={payment.variant}>{payment.label}</Badge></div>
                      </TableCell>
                      <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(o.total, o.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {o.courier_name && <div className="mt-0.5 text-xs text-muted-foreground">{o.courier_name}</div>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={(page) => update({ page })} />
        </>
      )}

      {results && <BulkResultDialog results={results} onClose={() => setResults(null)} />}
    </div>
  )
}
