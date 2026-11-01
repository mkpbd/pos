import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/use-auth'
import { useCodRemittanceQuery, useCodRemittancesQuery, useCreateCodRemittanceMutation, type CodRemittanceInput, type RemittanceMethod } from '@/features/cod-remittances/api'
import {
  courierName,
  feeError,
  formatDay,
  grossOf,
  invalidOrders,
  lineNumber,
  METHOD_LABELS,
  methodLabel,
  netOf,
  reasonLabel,
  remittanceFiltersFromSearchParams,
  remittanceFiltersToSearchParams,
  todayIn,
  toRemittanceListParams,
  type InvalidOrder,
  type RemittanceFilters,
} from '@/features/cod-remittances/remittances'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { useCouriersQuery } from '@/features/shipping/api'
import { sortCouriers } from '@/features/shipping/shipping'
import { useWebOrdersQuery, type WebOrderRow } from '@/features/web-orders/api'
import { formatDateTime } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney } from '@/lib/money'

const ALL = 'all'
/** Server cap per remittance. */
const MAX_ORDERS = 500
const CANDIDATES_PER_PAGE = 100

// ── List ─────────────────────────────────────────────────────────────────────

/** /cod-remittances — money couriers paid over for cash-on-delivery orders. */
export function CodRemittancesPage() {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = remittanceFiltersFromSearchParams(searchParams)
  const { data, error, isPending, refetch } = useCodRemittancesQuery(toRemittanceListParams(filters))
  const couriers = useCouriersQuery()
  const update = (patch: Partial<RemittanceFilters>) => setSearchParams(remittanceFiltersToSearchParams({ ...filters, page: 1, ...patch }), { replace: true })
  const filtered = !!(filters.courierId || filters.from || filters.to)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="COD remittances"
        description="Cash couriers collected on delivery and paid over to you. Recording a remittance marks its orders paid and books the courier's fee as an expense."
        actions={<Button asChild><Link to="/cod-remittances/new"><PlusIcon data-icon="inline-start" /> New remittance</Link></Button>}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Select value={filters.courierId ?? ALL} onValueChange={(v) => update({ courierId: v === ALL ? null : v })}>
          <SelectTrigger className="w-44" aria-label="Filter by courier"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All couriers</SelectItem>
            {sortCouriers(couriers.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rem-from">Received from</Label>
          <Input id="rem-from" type="date" className="w-40" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rem-to">To</Label>
          <Input id="rem-to" type="date" className="w-40" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
        </div>
        {filtered && (
          <Button variant="ghost" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
            <XIcon data-icon="inline-start" /> Clear filters
          </Button>
        )}
      </div>

      {isPending ? (
        <LoadingState rows={5} label="Loading remittances" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'No remittances match these filters' : 'No remittances yet'}
          description={filtered ? undefined : 'When a courier pays over the cash it collected, record it here against the delivered orders.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="COD remittances">
              <TableHeader>
                <TableRow>
                  <TableHead>Remittance</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead className="hidden md:table-cell">Reference</TableHead>
                  <TableHead className="hidden sm:table-cell">Received</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Gross</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Fee</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/cod-remittances/${r.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.number}</Link>
                      <div className="text-xs text-muted-foreground">
                        {r.method_label ?? methodLabel(r.method)}
                        {r.order_count !== undefined && ` · ${r.order_count} ${r.order_count === 1 ? 'order' : 'orders'}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{courierName(r)}</TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{r.reference ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{formatDay(r.received_at, timeZone)}</TableCell>
                    <TableCell className="hidden text-right font-mono whitespace-nowrap lg:table-cell">{formatMoney(r.gross_amount)}</TableCell>
                    <TableCell className="hidden text-right font-mono whitespace-nowrap lg:table-cell">{formatMoney(r.fee_amount)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(r.net_amount, r.currency ?? currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={(page) => update({ page })} />
        </>
      )}
    </div>
  )
}

// ── New ──────────────────────────────────────────────────────────────────────

type Draft = { fee: string; method: RemittanceMethod; reference: string; receivedAt: string; note: string }

/** /cod-remittances/new — courier → its delivered unpaid COD orders → amounts → record. */
export function NewCodRemittancePage() {
  const me = useAuth()
  const navigate = useNavigate()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const today = todayIn(timeZone)
  const couriers = useCouriersQuery()
  const create = useCreateCodRemittanceMutation()
  const idempotency = useIdempotencyKey()

  const [courierId, setCourierId] = useState('')
  const [page, setPage] = useState(1)
  // Selected orders keep their totals so the running total spans pages.
  const [selected, setSelected] = useState<Map<string, WebOrderRow>>(new Map())
  const [draft, setDraft] = useState<Draft>({ fee: '0.00', method: 'bank_transfer', reference: '', receivedAt: today, note: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState<InvalidOrder[]>([])
  const [tried, setTried] = useState(false)

  const candidates = useWebOrdersQuery({ page, per_page: CANDIDATES_PER_PAGE, courier_id: courierId || undefined, cod_unremitted: 1 }, { enabled: !!courierId })
  const showCandidates = !!courierId
  const rows = showCandidates ? (candidates.data?.items ?? []) : []
  const gross = grossOf([...selected.values()].map((o) => o.total))
  const fee = feeError(draft.fee, gross)
  const net = netOf(gross, draft.fee)
  const invalidById = new Map(invalid.map((o) => [o.id, o]))
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const chooseCourier = (id: string) => {
    setCourierId(id)
    setPage(1)
    setSelected(new Map())
    setInvalid([])
  }

  const toggle = (row: WebOrderRow, on: boolean) =>
    setSelected((current) => {
      const next = new Map(current)
      if (on) next.set(row.id, row)
      else next.delete(row.id)
      return next
    })

  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const pageSomeSelected = rows.some((r) => selected.has(r.id)) && !pageAllSelected
  const togglePage = (on: boolean) =>
    setSelected((current) => {
      const next = new Map(current)
      for (const r of rows) {
        if (on) next.set(r.id, r)
        else next.delete(r.id)
      }
      return next
    })

  const dropInvalid = () => {
    setSelected((current) => {
      const next = new Map(current)
      for (const o of invalid) next.delete(o.id)
      return next
    })
    setInvalid([])
  }

  const tooMany = selected.size > MAX_ORDERS
  const dateError = !draft.receivedAt ? 'Required.' : draft.receivedAt > today ? 'Cannot be in the future.' : null
  const canSubmit = !!courierId && selected.size > 0 && !tooMany && !fee && !dateError && !create.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!canSubmit) return
    const input: CodRemittanceInput = {
      courier_id: courierId,
      reference: draft.reference.trim() || null,
      received_at: draft.receivedAt,
      method: draft.method,
      fee_amount: draft.fee.trim(),
      order_ids: [...selected.keys()].sort(),
      note: draft.note.trim() || null,
    }
    setErrors({})
    setInvalid([])
    create.mutate(
      { input, idempotencyKey: idempotency.keyFor(input) },
      {
        onSuccess: (remittance) => {
          idempotency.settle()
          toast.success(`${remittance.number} recorded: ${selected.size} ${selected.size === 1 ? 'order' : 'orders'} marked paid.`)
          navigate(`/cod-remittances/${remittance.id}`)
        },
        onError: (error) => {
          idempotency.settle(error)
          const refused = invalidOrders(error)
          if (refused.length > 0) {
            setInvalid(refused)
            return
          }
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            setErrors(fieldErrorMap(error))
            return
          }
          toast.error(error.message)
          if (isRetryable(error)) toast.message('You can press the button again to retry safely.')
        },
      },
    )
  }

  const courierList = sortCouriers(couriers.data ?? [])
  const offPage = invalid.filter((o) => !rows.some((r) => r.id === o.id))

  return (
    <form noValidate onSubmit={submit} className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to COD remittances"><Link to="/cod-remittances"><ArrowLeftIcon /></Link></Button>
        <h1 className="text-2xl font-semibold tracking-tight">New COD remittance</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>1. Courier</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="rem-courier">Courier that paid</Label>
          {couriers.isPending ? (
            <LoadingState rows={1} label="Loading couriers" />
          ) : couriers.error ? (
            <ErrorState error={couriers.error} onRetry={() => couriers.refetch()} />
          ) : courierList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No couriers yet. Orders shipped with a courier appear here once delivered.</p>
          ) : (
            <Select value={courierId} onValueChange={chooseCourier}>
              <SelectTrigger id="rem-courier" className="w-full sm:w-72"><SelectValue placeholder="Choose a courier" /></SelectTrigger>
              <SelectContent>
                {courierList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{!c.is_active && ' (inactive)'}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {showCandidates && (
        <Card>
          <CardHeader><CardTitle>2. Orders paid over</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Delivered cash-on-delivery orders of this courier that are not paid yet. Tick the ones on the courier's statement.</p>
            {invalid.length > 0 && (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">Nothing was recorded: {invalid.length === 1 ? 'one order' : `${invalid.length} orders`} can no longer be remitted. The list was refreshed.</p>
                {offPage.length > 0 && (
                  <ul className="list-inside list-disc">
                    {offPage.map((o) => <li key={o.id}>{o.number ?? o.id}: {reasonLabel(o.reason)}</li>)}
                  </ul>
                )}
                <Button type="button" size="sm" variant="outline" className="self-start" onClick={dropInvalid}>Remove them from the selection</Button>
              </div>
            )}
            {candidates.isPending ? (
              <LoadingState rows={4} label="Loading orders" />
            ) : candidates.error ? (
              <ErrorState error={candidates.error} onRetry={() => candidates.refetch()} />
            ) : rows.length === 0 && candidates.data.pagination.total === 0 ? (
              <EmptyState title="Nothing to collect" description="This courier has no delivered cash-on-delivery orders waiting for payment." />
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <Table aria-label="Orders to remit">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox aria-label="Select all orders on this page" checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false} onCheckedChange={(v) => togglePage(v === true)} />
                        </TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead className="hidden sm:table-cell">Placed</TableHead>
                        <TableHead className="hidden md:table-cell">Customer</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((o) => {
                        const refused = invalidById.get(o.id)
                        return (
                          <TableRow key={o.id} data-state={selected.has(o.id) ? 'selected' : undefined}>
                            <TableCell>
                              <Checkbox aria-label={`Select ${o.number}`} checked={selected.has(o.id)} onCheckedChange={(v) => toggle(o, v === true)} aria-describedby={refused ? `refused-${o.id}` : undefined} />
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-sm">{o.number}</span>
                              {o.tracking_number && <div className="font-mono text-xs text-muted-foreground">{o.tracking_number}</div>}
                              {refused && <div id={`refused-${o.id}`} className="text-xs font-medium text-destructive" data-testid="invalid-reason">{reasonLabel(refused.reason)}</div>}
                            </TableCell>
                            <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{formatDateTime(o.placed_at, timeZone)}</TableCell>
                            <TableCell className="hidden text-sm md:table-cell">{o.contact_name}</TableCell>
                            <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(o.total, o.currency)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar pagination={candidates.data.pagination} onPageChange={setPage} />
              </>
            )}
            <p className="text-sm" aria-live="polite" data-testid="running-total">
              <span className="font-medium">{selected.size} {selected.size === 1 ? 'order' : 'orders'} selected</span> · collected{' '}
              <span className="font-mono font-semibold">{formatMoney(gross, currency)}</span>
            </p>
            {tooMany && <p role="alert" className="text-sm text-destructive">At most {MAX_ORDERS} orders per remittance — record the rest in another one.</p>}
            {tried && selected.size === 0 && <p role="alert" className="text-sm text-destructive">Select at least one order.</p>}
          </CardContent>
        </Card>
      )}

      {showCandidates && (
        <Card>
          <CardHeader><CardTitle>3. Payment received</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label={`Courier fee${currency ? ` (${currency})` : ''}`} error={(tried || draft.fee !== '0.00' ? fee : null) ?? errors.fee_amount} hint="Deducted by the courier; recorded as a “Courier fees” expense.">
              <Input inputMode="decimal" className="font-mono" value={draft.fee} onChange={(e) => set({ fee: e.target.value })} />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rem-method">Received by</Label>
              <Select value={draft.method} onValueChange={(v) => set({ method: v as RemittanceMethod })}>
                <SelectTrigger id="rem-method" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_LABELS) as RemittanceMethod[]).map((m) => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <FormField label="Courier's statement no. (optional)" error={errors.reference}>
              <Input maxLength={60} value={draft.reference} onChange={(e) => set({ reference: e.target.value })} />
            </FormField>
            <FormField label="Received on" error={(tried ? dateError : null) ?? errors.received_at}>
              <Input type="date" max={today} value={draft.receivedAt} onChange={(e) => set({ receivedAt: e.target.value })} />
            </FormField>
            <FormField label="Note (optional)" error={errors.note} className="sm:col-span-2">
              <Textarea rows={2} maxLength={500} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
            </FormField>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm sm:col-span-2 sm:max-w-sm" aria-label="Remittance amounts">
              <dt className="text-muted-foreground">Collected (gross)</dt><dd className="text-right font-mono">{formatMoney(gross)}</dd>
              <dt className="text-muted-foreground">Courier fee</dt><dd className="text-right font-mono">−{formatMoney(fee ? '0' : draft.fee.trim())}</dd>
              <dt className="font-semibold">Received (net)</dt><dd className="text-right font-mono font-semibold" data-testid="net-amount">{formatMoney(fee ? gross : net, currency)}</dd>
            </dl>
            {errors.form && <p role="alert" className="text-sm text-destructive sm:col-span-2">{errors.form}</p>}
            {Object.entries(errors).filter(([k]) => k.startsWith('order_ids')).slice(0, 1).map(([k, m]) => <p key={k} role="alert" className="text-sm text-destructive sm:col-span-2">{m}</p>)}
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
              <Button asChild variant="outline"><Link to="/cod-remittances">Cancel</Link></Button>
              <Button type="submit" disabled={create.isPending || selected.size === 0}>
                {create.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Record remittance
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </form>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  )
}

/** /cod-remittances/:remittanceId — a recorded remittance and the orders it paid. */
export function CodRemittancePage() {
  const { remittanceId } = useParams()
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const { data: r, error, isPending, refetch } = useCodRemittanceQuery(remittanceId)

  if (isPending) return <LoadingState rows={6} label="Loading remittance" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const c = r.currency ?? currency
  const by = r.created_by ? (typeof r.created_by === 'string' ? r.created_by : r.created_by.name) : null

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to COD remittances"><Link to="/cod-remittances"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{r.number}</h1>
        <Badge variant="success">Recorded</Badge>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Remittance</CardTitle></CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Field label="Courier">{courierName(r)}</Field>
              <Field label="Statement no.">{r.reference ?? '—'}</Field>
              <Field label="Received">{formatDay(r.received_at, timeZone)} · {r.method_label ?? methodLabel(r.method)}</Field>
              {(by || r.created_at) && <Field label="Recorded">{[r.created_at ? formatDateTime(r.created_at, timeZone) : null, by].filter(Boolean).join(' · ')}</Field>}
              {r.note && <Field label="Note">{r.note}</Field>}
              {r.expense && <Field label="Fee expense"><span className="font-mono">{r.expense.number ?? '—'}</span></Field>}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Amounts</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm" aria-label="Remittance amounts">
              <dt className="text-muted-foreground">Collected (gross)</dt><dd className="text-right font-mono">{formatMoney(r.gross_amount)}</dd>
              <dt className="text-muted-foreground">Courier fee</dt><dd className="text-right font-mono">−{formatMoney(r.fee_amount)}</dd>
              <dt className="font-semibold">Received (net)</dt><dd className="text-right font-mono font-semibold" data-testid="net-amount">{formatMoney(r.net_amount, c)}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">The orders were marked paid and the fee booked as a “Courier fees” expense. A remittance cannot be edited or deleted.</p>
          </CardContent>
        </Card>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Orders in this remittance">
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead className="hidden sm:table-cell">Customer</TableHead>
              <TableHead className="hidden md:table-cell">Delivered</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l) => (
              <TableRow key={l.order_id}>
                <TableCell><Link to={`/web-orders/${l.order_id}`} className="font-mono text-sm underline-offset-4 hover:underline">{lineNumber(l)}</Link></TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{l.contact_name ?? '—'}</TableCell>
                <TableCell className="hidden text-sm whitespace-nowrap md:table-cell">{formatDateTime(l.delivered_at, timeZone)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(l.amount, c)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
