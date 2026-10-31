import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeftIcon, CheckIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { RefundsEditor } from '@/features/returns/components/refunds-editor'
import { defaultRefunds, refundsProblem, toRefundInput, type RefundRow } from '@/features/returns/refunds'
import {
  isRetryable,
  useApproveReturnMutation,
  useCreateReturnMutation,
  useDeleteReturnReasonMutation,
  useIdempotencyKey,
  usePreviewReturnMutation,
  useRejectReturnMutation,
  useReturnQuery,
  useReturnReasonsQuery,
  useReturnsQuery,
  useSaveReturnReasonMutation,
  type ReturnLineInput,
  type ReturnPreview,
  type ReturnReason,
  type ReturnStatus,
  type Settlement,
} from '@/features/returns/api'
import { RETURN_STATUS, returnableQuantity } from '@/features/returns/status'
import { lineLabel, useSaleQuery, type SaleLine } from '@/features/sales/api'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { compareDecimal, decimalPattern, formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const QTY_PATTERN = decimalPattern(3)

function SettlementSummary({ settlement, currency }: { settlement: Settlement; currency: string }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm" aria-label="Settlement">
      {!isZeroDecimal(settlement.credit) && (
        <>
          <dt className="text-muted-foreground">Credited against what the customer owes</dt>
          <dd className="text-right font-mono">{formatMoney(settlement.credit, currency)}</dd>
        </>
      )}
      <dt className="font-medium">Refund due</dt>
      <dd className="text-right font-mono font-semibold" data-testid="refund-due">{formatMoney(settlement.refund_due, currency)}</dd>
    </dl>
  )
}

// ── Returns list + reasons ───────────────────────────────────────────────────

function ReasonsTab({ canManage }: { canManage: boolean }) {
  const reasons = useReturnReasonsQuery()
  const save = useSaveReturnReasonMutation()
  const remove = useDeleteReturnReasonMutation()
  const [editing, setEditing] = useState<ReturnReason | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<ReturnReason | null>(null)
  const [name, setName] = useState('')
  const [restock, setRestock] = useState(true)
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const open = (r: ReturnReason | null) => {
    setName(r?.name ?? '')
    setRestock(r?.restock_by_default ?? true)
    setActive(r?.is_active ?? true)
    setErrors({})
    setEditing(r)
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && <Button variant="outline" className="self-start" onClick={() => open(null)}><PlusIcon data-icon="inline-start" /> New reason</Button>}
      {reasons.isPending ? (
        <LoadingState rows={3} label="Loading reasons" />
      ) : reasons.error ? (
        <ErrorState error={reasons.error} onRetry={() => reasons.refetch()} />
      ) : reasons.data.length === 0 ? (
        <EmptyState title="No return reasons" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reason</TableHead>
                <TableHead>Goods go back to stock</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {reasons.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm">{r.restock_by_default ? 'Yes, by default' : 'No (written off)'}</TableCell>
                  <TableCell><Badge variant={r.is_active ? 'success' : 'outline'}>{r.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => open(r)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}><Trash2Icon /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(o) => { if (!o && !save.isPending) setEditing(undefined) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.name}` : 'New return reason'}</DialogTitle></DialogHeader>
          <form
            id="reason-form"
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate({ id: editing?.id, input: { name: name.trim(), restock_by_default: restock, is_active: active } }, {
                onSuccess: (r) => { toast.success(`${r.name} saved.`); setEditing(undefined) },
                onError: (err) => setErrors(fieldErrorMap(err)),
              })
            }}
          >
            <FormField label="Name" error={errors.name}>
              <Input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Damaged" />
            </FormField>
            <div className="flex items-center gap-2">
              <Switch id="reason-restock" checked={restock} onCheckedChange={setRestock} />
              <Label htmlFor="reason-restock" className="font-normal">Put returned goods back into stock by default</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="reason-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="reason-active" className="font-normal">Active</Label>
            </div>
            {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" form="reason-form" disabled={save.isPending || !name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Only reasons no return uses can be deleted; deactivate it otherwise."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toast.success(`${deleting.name} deleted.`), onError: (e) => toast.error(e.message), onSettled: () => setDeleting(null) })}
      />
    </div>
  )
}

export function ReturnsPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ReturnStatus | 'all'>('all')
  const term = useDebouncedValue(search.trim())
  const { data, error, isPending, refetch } = useReturnsQuery({ page, search: term || undefined, status: status === 'all' ? undefined : status })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sales returns" description="Goods brought back against an invoice. Start a return from the invoice on the Sales page." />
      <Tabs defaultValue="returns">
        <TabsList>
          <TabsTrigger value="returns">Returns</TabsTrigger>
          <TabsTrigger value="reasons">Reasons</TabsTrigger>
        </TabsList>
        <TabsContent value="returns" className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label="Search returns" placeholder="Return or invoice number" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            <Select value={status} onValueChange={(v) => { setStatus(v as ReturnStatus | 'all'); setPage(1) }}>
              <SelectTrigger className="w-48" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All returns</SelectItem>
                {(Object.keys(RETURN_STATUS) as ReturnStatus[]).map((s) => <SelectItem key={s} value={s}>{RETURN_STATUS[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isPending ? (
            <LoadingState rows={5} label="Loading returns" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState title="No returns" />
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="hidden md:table-cell">Customer</TableHead>
                      <TableHead className="hidden lg:table-cell">Requested</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell><Link to={`/returns/${r.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.number}</Link></TableCell>
                        <TableCell className="font-mono text-sm">{r.sale.number ?? '—'}</TableCell>
                        <TableCell className="hidden text-sm md:table-cell">{r.customer?.name ?? 'Walk-in'}</TableCell>
                        <TableCell className="hidden text-sm lg:table-cell">{new Date(r.requested_at).toLocaleString()}<div className="text-xs text-muted-foreground">{r.requested_by?.name}</div></TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(r.total, r.currency)}</TableCell>
                        <TableCell><Badge variant={RETURN_STATUS[r.status].variant}>{RETURN_STATUS[r.status].label}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PaginationBar pagination={data.pagination} onPageChange={setPage} />
            </>
          )}
        </TabsContent>
        <TabsContent value="reasons" className="pt-4">
          <ReasonsTab canManage={can('returns.manage')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Return document: approve / reject ────────────────────────────────────────

export function ReturnPage() {
  const { returnId } = useParams()
  const can = useCan()
  const { data: ret, error, isPending, refetch } = useReturnQuery(returnId)
  const approve = useApproveReturnMutation()
  const reject = useRejectReturnMutation()
  const idempotency = useIdempotencyKey()
  const [approving, setApproving] = useState(false)
  const [rows, setRows] = useState<RefundRow[]>([])
  const [refundErrors, setRefundErrors] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  if (isPending) return <LoadingState rows={6} label="Loading return" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const c = ret.currency
  const pending = ret.status === 'pending'
  const settlement = ret.settlement
  const problem = settlement ? refundsProblem(rows, settlement, c) : null

  const startApproval = () => {
    if (!settlement) return
    setRows(defaultRefunds(settlement))
    setRefundErrors({})
    setApproving(true)
  }

  const submitApproval = () => {
    if (!settlement || problem) return
    const refunds = toRefundInput(rows)
    approve.mutate({ id: ret.id, refunds, idempotencyKey: idempotency.keyFor({ id: ret.id, refunds }) }, {
      onSuccess: (r) => { idempotency.settle(); toast.success(`${r.number} approved.`); setApproving(false) },
      onError: (err) => {
        idempotency.settle(err)
        if (err instanceof ApiError && err.code === 'RETURN_ALREADY_DECIDED') setApproving(false)
        setRefundErrors(fieldErrorMap(err))
      },
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to returns"><Link to="/returns"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{ret.number}</h1>
          <Badge variant={RETURN_STATUS[ret.status].variant}>{RETURN_STATUS[ret.status].label}</Badge>
        </div>
        {pending && can('returns.approve') && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setRejectReason(''); setRejecting(true) }}><XIcon data-icon="inline-start" /> Reject</Button>
            <Button onClick={startApproval}><CheckIcon data-icon="inline-start" /> Approve</Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-4">
          <div><span className="text-muted-foreground">Invoice</span><div className="font-medium"><Link to={`/sales/${ret.sale.id}`} className="font-mono underline-offset-4 hover:underline">{ret.sale.number}</Link></div></div>
          <div><span className="text-muted-foreground">Customer</span><div className="font-medium">{ret.customer?.name ?? 'Walk-in'}</div></div>
          <div><span className="text-muted-foreground">Reason</span><div className="font-medium">{ret.reason?.name ?? '—'}</div></div>
          <div><span className="text-muted-foreground">Store</span><div className="font-medium">{ret.store?.name} · {ret.branch?.name}</div></div>
          <div><span className="text-muted-foreground">Requested</span><div className="font-medium">{new Date(ret.requested_at).toLocaleString()} by {ret.requested_by?.name ?? '—'}</div></div>
          {ret.decided_at && (
            <div className="sm:col-span-2"><span className="text-muted-foreground">{ret.status === 'rejected' ? 'Rejected' : 'Approved'}</span><div className="font-medium">{new Date(ret.decided_at).toLocaleString()} by {ret.decided_by?.name ?? '—'}{ret.rejection_reason && `: ${ret.rejection_reason}`}</div></div>
          )}
          {ret.notes && <div className="sm:col-span-4"><span className="text-muted-foreground">Notes</span><div>{ret.notes}</div></div>}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Tax</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ret.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {l.sku}
                    {l.batches.map((b) => ` · ${b.batch_number ?? 'no batch'} (${trimDecimal(b.quantity)})`).join('')}
                    {l.serials.length > 0 && ` · S/N ${l.serials.join(', ')}`}
                  </div>
                </TableCell>
                <TableCell className="text-right">{trimDecimal(l.quantity)} {l.unit_code}</TableCell>
                <TableCell className="text-sm">{l.restock ? 'Back to stock' : 'Written off'}</TableCell>
                <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(l.tax_amount)}</TableCell>
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
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right font-mono">{formatMoney(ret.subtotal)}</dd>
              <dt className="text-muted-foreground">Tax</dt><dd className="text-right font-mono">{formatMoney(ret.tax_total)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{formatMoney(ret.total, c)}</dd>
              {ret.status === 'completed' && (
                <>
                  <dt className="text-muted-foreground">Credited to the customer's balance</dt><dd className="text-right font-mono">{formatMoney(ret.credited_total)}</dd>
                  <dt className="text-muted-foreground">Refunded</dt><dd className="text-right font-mono">{formatMoney(ret.refunded_total)}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{pending ? 'Settlement if approved now' : 'Refunds'}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {pending && settlement && <SettlementSummary settlement={settlement} currency={c} />}
            {!pending && ret.refunds.length === 0 && <p className="text-muted-foreground">No money paid back.</p>}
            {ret.refunds.map((r, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span>{r.method_label}{r.reference && <span className="text-muted-foreground"> · {r.reference}</span>}</span>
                <span className="font-mono">{formatMoney(r.amount, c)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={approving} onOpenChange={(o) => { if (!approve.isPending) setApproving(o) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approve {ret.number}</DialogTitle>
            <DialogDescription>Restocked lines go back to the batches they were sold from. Cash refunds are paid out of your open register session.</DialogDescription>
          </DialogHeader>
          {settlement && (
            <div className="flex flex-col gap-4">
              <SettlementSummary settlement={settlement} currency={c} />
              {!isZeroDecimal(settlement.refund_due) && <RefundsEditor settlement={settlement} currency={c} rows={rows} onChange={setRows} errors={refundErrors} disabled={approve.isPending} />}
              {refundErrors.form && <p role="alert" className="text-sm text-destructive">{refundErrors.form}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(false)} disabled={approve.isPending}>Cancel</Button>
            <Button onClick={submitApproval} disabled={approve.isPending || !!problem}>
              {approve.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Approve return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting} onOpenChange={(o) => { if (!reject.isPending) setRejecting(o) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {ret.number}?</DialogTitle>
            <DialogDescription>The reserved quantities become returnable again. Nothing moves in stock or money.</DialogDescription>
          </DialogHeader>
          <form
            id="reject-return-form"
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!rejectReason.trim()) return
              reject.mutate({ id: ret.id, reason: rejectReason.trim() }, {
                onSuccess: (r) => { toast.success(`${r.number} rejected.`); setRejecting(false) },
                onError: (err) => toast.error(err.message),
              })
            }}
          >
            <Label htmlFor="reject-reason">Reason</Label>
            <Input id="reject-reason" autoFocus maxLength={255} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. item was used" />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>Keep pending</Button>
            <Button type="submit" form="reject-return-form" variant="destructive" disabled={!rejectReason.trim() || reject.isPending}>Reject return</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── New return against an invoice ────────────────────────────────────────────

/** `restock` undefined = follow the reason's default. */
type LineDraft = { quantity: string; restock?: boolean; serials: string[] }

export function NewReturnPage() {
  const { saleId } = useParams()
  const navigate = useNavigate()
  const { data: sale, error, isPending, refetch } = useSaleQuery(saleId)
  const reasons = useReturnReasonsQuery()
  const preview = usePreviewReturnMutation()
  const create = useCreateReturnMutation()
  const idempotency = useIdempotencyKey()
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [reasonId, setReasonId] = useState<string>('none')
  const [notes, setNotes] = useState('')
  const [previewed, setPreviewed] = useState<{ fingerprint: string; result: ReturnPreview } | null>(null)
  const [rows, setRows] = useState<RefundRow[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const activeReasons = (reasons.data ?? []).filter((r) => r.is_active)
  const reason = activeReasons.find((r) => r.id === reasonId)
  const restockDefault = reason?.restock_by_default ?? true

  const draftFor = (line: SaleLine): LineDraft => drafts[line.id] ?? { quantity: '', serials: [] }
  const restockOf = (d: LineDraft) => d.restock ?? restockDefault
  // A changed reason resets every line to its restock default.
  const chooseReason = (id: string) => {
    setReasonId(id)
    setDrafts((ds) => Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, { ...d, restock: undefined }])))
  }
  const update = (line: SaleLine, patch: Partial<LineDraft>) => setDrafts((ds) => ({ ...ds, [line.id]: { ...draftFor(line), ...patch } }))


  if (isPending) return <LoadingState rows={6} label="Loading invoice" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const lines: ReturnLineInput[] = sale.lines.flatMap((l) => {
    const d = drafts[l.id]
    if (!d) return []
    const restock = d.restock ?? restockDefault
    if (l.serials.length > 0) return d.serials.length > 0 ? [{ sale_line_id: l.id, quantity: String(d.serials.length), restock, serials: d.serials }] : []
    const qty = d.quantity.trim()
    return qty !== '' && QTY_PATTERN.test(qty) && !isZeroDecimal(qty) ? [{ sale_line_id: l.id, quantity: qty, restock }] : []
  })
  const c = sale.currency
  const lineProblem = sale.lines.find((l) => {
    const d = drafts[l.id]
    if (!d || l.serials.length > 0 || d.quantity.trim() === '') return false
    return !QTY_PATTERN.test(d.quantity.trim()) || compareDecimal(d.quantity.trim(), returnableQuantity(l)) > 0
  })
  const input = { sale_id: sale.id, return_reason_id: reason?.id ?? null, notes: notes.trim() || null, lines }
  const fingerprint = JSON.stringify(input)
  const current = previewed?.fingerprint === fingerprint ? previewed.result : null
  const refundProblem = current?.completes_immediately && !isZeroDecimal(current.settlement.refund_due) ? refundsProblem(rows, current.settlement, c) : null

  if (sale.status === 'cancelled') {
    return <ErrorState title="Cannot return items" error={new Error(`${sale.number} is cancelled; nothing can be returned.`)} />
  }

  const runPreview = () => {
    setErrors({})
    preview.mutate(input, {
      onSuccess: (result) => {
        setPreviewed({ fingerprint, result })
        setRows(result.completes_immediately ? defaultRefunds(result.settlement) : [])
      },
      onError: (err) => setErrors(fieldErrorMap(err)),
    })
  }

  const submit = () => {
    if (!current || refundProblem) return
    const body = { ...input, ...(current.completes_immediately ? { refunds: toRefundInput(rows) } : {}) }
    create.mutate({ input: body, idempotencyKey: idempotency.keyFor(body) }, {
      onSuccess: (r) => {
        idempotency.settle()
        toast.success(r.status === 'completed' ? `${r.number} completed.` : `${r.number} sent for approval.`)
        navigate(`/returns/${r.id}`)
      },
      onError: (err) => {
        idempotency.settle(err)
        setErrors(fieldErrorMap(err))
        if (isRetryable(err)) toast.message('You can press the button again to retry safely.')
      },
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to the invoice"><Link to={`/sales/${sale.id}`}><ArrowLeftIcon /></Link></Button>
        <PageHeader title={`Return items from ${sale.number}`} description={`${sale.customer?.name ?? 'Walk-in'} · sold ${new Date(sale.sold_at).toLocaleString()}`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Reason" error={errors.return_reason_id}>
          <Select value={reasonId} onValueChange={chooseReason}>
            <SelectTrigger className="w-full" aria-label="Return reason"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No reason given</SelectItem>
              {activeReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Notes" error={errors.notes}>
          <Textarea rows={1} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Returnable</TableHead>
              <TableHead className="w-48">Return</TableHead>
              <TableHead>Back to stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.lines.map((l, i) => {
              const returnable = returnableQuantity(l)
              const d = draftFor(l)
              const freeSerials = l.serials.filter((s) => !l.returned_serials.includes(s))
              const over = d.quantity.trim() !== '' && (!QTY_PATTERN.test(d.quantity.trim()) || compareDecimal(d.quantity.trim(), returnable) > 0)
              const lineIndex = lines.findIndex((x) => x.sale_line_id === l.id)
              const serverError = lineIndex >= 0 ? errors[`lines.${lineIndex}.quantity`] ?? errors[`lines.${lineIndex}.serials`] : undefined
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{lineLabel(l)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{l.sku} · {formatMoney(l.line_total)}</div>
                    {!isZeroDecimal(l.pending_return_quantity) && <div className="text-xs text-muted-foreground">{trimDecimal(l.pending_return_quantity)} awaiting approval on another return</div>}
                  </TableCell>
                  <TableCell className="text-right">{trimDecimal(l.quantity)} {l.unit_code}</TableCell>
                  <TableCell className="text-right">{trimDecimal(returnable)}</TableCell>
                  <TableCell>
                    {compareDecimal(returnable, '0') <= 0 || returnable.startsWith('-') ? (
                      <span className="text-sm text-muted-foreground">Nothing left</span>
                    ) : l.serials.length > 0 ? (
                      <div className="flex flex-col gap-1" role="group" aria-label={`Serials to return for ${lineLabel(l)}`}>
                        {freeSerials.map((s) => (
                          <label key={s} className="flex items-center gap-2 font-mono text-xs">
                            <Checkbox checked={d.serials.includes(s)} onCheckedChange={(v) => update(l, { serials: v ? [...d.serials, s] : d.serials.filter((x) => x !== s) })} />
                            {s}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Input
                        aria-label={`Quantity to return of line ${i + 1}`}
                        aria-invalid={over || serverError ? true : undefined}
                        inputMode="decimal"
                        className="text-right font-mono"
                        placeholder="0"
                        value={d.quantity}
                        onChange={(e) => update(l, { quantity: e.target.value })}
                      />
                    )}
                    {over && <p className="text-xs text-destructive">At most {trimDecimal(returnable)}.</p>}
                    {serverError && <p className="text-xs text-destructive">{serverError}</p>}
                  </TableCell>
                  <TableCell>
                    <Switch aria-label={`Back to stock: line ${i + 1}`} checked={restockOf(d)} onCheckedChange={(v) => update(l, { restock: v })} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
      {errors.lines && <p role="alert" className="text-sm text-destructive">{errors.lines}</p>}

      {current ? (
        <Card>
          <CardHeader><CardTitle>Return value</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              {current.lines.map((l) => (
                <div key={l.sale_line_id} className="contents">
                  <dt className="text-muted-foreground">{l.product_name} × {trimDecimal(l.quantity)}</dt>
                  <dd className="text-right font-mono">{formatMoney(l.line_total)}</dd>
                </div>
              ))}
              <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold" data-testid="return-total">{formatMoney(current.total, c)}</dd>
            </dl>
            <SettlementSummary settlement={current.settlement} currency={c} />
            {current.completes_immediately ? (
              !isZeroDecimal(current.settlement.refund_due) && <RefundsEditor settlement={current.settlement} currency={c} rows={rows} onChange={setRows} errors={errors} disabled={create.isPending} />
            ) : (
              <p className="text-sm text-muted-foreground">The return waits for a manager's approval; the refund is paid when it is approved.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={submit} disabled={create.isPending || !!refundProblem}>
                {create.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                {current.completes_immediately ? 'Complete return' : 'Send for approval'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button onClick={runPreview} disabled={lines.length === 0 || !!lineProblem || preview.isPending}>
            {preview.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Calculate refund
          </Button>
        </div>
      )}
    </div>
  )
}
