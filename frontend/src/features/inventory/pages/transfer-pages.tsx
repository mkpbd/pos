import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, ArrowRightIcon, BanIcon, InboxIcon, Loader2Icon, PackageCheckIcon, PlusIcon, TruckIcon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { emptyLine } from '@/components/common/line-values'
import { LinesEditor } from '@/components/common/lines-editor'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PdfButton } from '@/components/common/pdf-button'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import {
  transferChallanPath,
  useCompleteTransferMutation,
  useDispatchTransferMutation,
  useRequestTransferMutation,
  useTransferQuery,
  useTransferSourceStoresQuery,
  useTransfersQuery,
  variantLabel,
  type Transfer,
  type TransferStatus,
  type UserRef,
} from '@/features/inventory/api'
import { DispatchRequestDialog, ReceiveTransferDialog } from '@/features/inventory/components/transfer-dialogs'
import { ReasonDialog } from '@/features/procurement/components/shared'
import { formatDateTime } from '@/features/web-orders/orders'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { handleLinesError, linesSchema, toApiLine } from '@/features/inventory/lines'

const STATUS: Record<TransferStatus, { label: string; variant: 'info' | 'success' | 'destructive' | 'warning' | 'secondary' }> = {
  requested: { label: 'Requested', variant: 'warning' },
  in_transit: { label: 'In transit', variant: 'info' },
  received: { label: 'Received', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
  rejected: { label: 'Rejected', variant: 'secondary' },
}

/** Cancelling a request moves nothing; cancelling a dispatched transfer puts the goods back. */
const cancelDescription = (t: Transfer | undefined) =>
  t?.status === 'requested' ? 'The request is withdrawn. No stock has moved.' : `The goods go back into ${t?.from_store?.name}.`

export function TransfersPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<TransferStatus | 'all'>('all')
  const [confirm, setConfirm] = useState<{ transfer: Transfer; action: 'receive' | 'cancel' } | null>(null)
  const complete = useCompleteTransferMutation()
  const filters = { status: status === 'all' ? undefined : status }
  const { data, error, isPending, refetch } = useTransfersQuery({ page, ...filters })
  const canTransfer = can('inventory.transfer')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Stock moving between stores and branches."
        actions={
          <>
            <ExportMenu list="transfers" query={filters} disabled={!data?.items.length} />
            {canTransfer && <Button asChild variant="outline"><Link to="/inventory/transfers/request"><InboxIcon data-icon="inline-start" /> Request stock</Link></Button>}
            {canTransfer && <Button asChild><Link to="/inventory/transfers/new"><PlusIcon data-icon="inline-start" /> New transfer</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
      <Select value={status} onValueChange={(v) => { setStatus(v as TransferStatus | 'all'); setPage(1) }}>
        <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All transfers</SelectItem>
          {(Object.keys(STATUS) as TransferStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}
        </SelectContent>
      </Select>

      {isPending ? (
        <LoadingState rows={5} label="Loading transfers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No transfers" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Dispatched</TableHead>
                  <TableHead className="w-48"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-sm"><Link to={`/inventory/transfers/${t.id}`} className="underline-offset-4 hover:underline">{t.number}</Link><div className="text-xs text-muted-foreground">{t.lines_count} lines</div></TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1">{t.from_store?.name} <ArrowRightIcon className="size-3" aria-label="to" /> {t.to_store?.name}</span>
                      <div className="text-xs text-muted-foreground">{t.from_store?.branch_name} → {t.to_store?.branch_name}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge>
                        {t.has_discrepancy && <Badge variant="warning">Discrepancy</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{t.dispatched_at ? new Date(t.dispatched_at).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-right">
                      {canTransfer && t.can_receive && <Button size="sm" onClick={() => setConfirm({ transfer: t, action: 'receive' })}>Receive</Button>}
                      {canTransfer && t.can_cancel && <Button size="sm" variant="ghost" onClick={() => setConfirm({ transfer: t, action: 'cancel' })}>Cancel</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.action === 'receive' ? `Receive ${confirm.transfer.number}?` : `Cancel ${confirm?.transfer.number}?`}
        description={confirm?.action === 'receive' ? `Everything sent is added to ${confirm.transfer.to_store?.name}. Open the transfer to record short or damaged goods.` : cancelDescription(confirm?.transfer)}
        confirmLabel={confirm?.action === 'receive' ? 'Receive goods' : 'Cancel transfer'}
        destructive={confirm?.action === 'cancel'}
        pending={complete.isPending}
        onConfirm={() =>
          confirm &&
          complete.mutate({ id: confirm.transfer.id, action: confirm.action }, {
            onSuccess: (t) => toast.success(`${t.number} ${t.status === 'received' ? 'received' : 'cancelled'}.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setConfirm(null),
          })
        }
      />
    </div>
  )
}

const DISPATCH_LINES = { batch: 'out', serials: 'out' } as const
const REQUEST_LINES = {} as const
const schemaFor = (options: typeof DISPATCH_LINES | typeof REQUEST_LINES) =>
  z
    .object({
      from_store_id: z.string().min(1, 'Choose the source store.'),
      to_store_id: z.string().min(1, 'Choose the destination store.'),
      note: z.string().max(1000),
      lines: linesSchema(options),
    })
    .refine((v) => v.from_store_id !== v.to_store_id, { path: ['to_store_id'], message: 'Choose a different store.' })
type Values = z.infer<ReturnType<typeof schemaFor>>

/** Dispatch now (`/new`) or, with `request`, ask another store for stock (ST2b): no batches, nothing moves yet. */
function TransferForm({ request = false }: { request?: boolean }) {
  const navigate = useNavigate()
  const dispatch = useDispatchTransferMutation()
  const ask = useRequestTransferMutation()
  const form = useForm<Values>({ resolver: zodResolver(schemaFor(request ? REQUEST_LINES : DISPATCH_LINES)), defaultValues: { from_store_id: '', to_store_id: '', note: '', lines: [emptyLine()] } })
  const { errors } = form.formState
  const fromStore = useWatch({ control: form.control, name: 'from_store_id' })
  const pending = dispatch.isPending || ask.isPending
  const sources = useTransferSourceStoresQuery(request)

  const onSubmit = form.handleSubmit((values) => {
    const input = { from_store_id: values.from_store_id, to_store_id: values.to_store_id, note: values.note.trim() || null }
    const onError = (error: Error) => handleLinesError(error, form.setError, ['from_store_id', 'to_store_id', 'note', 'lines'], values.lines)
    if (request) {
      ask.mutate({ ...input, lines: values.lines.map((l) => ({ variant_id: l.variant?.id ?? '', quantity: l.quantity.trim() })) }, {
        onSuccess: (t) => {
          toast.success(`Request ${t.number} sent.`)
          navigate(`/inventory/transfers/${t.id}`)
        },
        onError,
      })
      return
    }
    dispatch.mutate({ ...input, lines: values.lines.map((l) => toApiLine(l, DISPATCH_LINES)) }, {
      onSuccess: (t) => {
        toast.success(`Transfer ${t.number} dispatched.`)
        navigate('/inventory/transfers')
      },
      onError,
    })
  })

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to transfers"><Link to="/inventory/transfers"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{request ? 'Request stock' : 'New stock transfer'}</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Route</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="From store" error={errors.from_store_id?.message} hint={request ? 'The store that sends the goods.' : undefined}>
            <Controller
              control={form.control}
              name="from_store_id"
              render={({ field }) =>
                request ? (
                  // Any active store of the organization, e.g. a central warehouse of a branch the user cannot access.
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full" aria-label="From store" aria-invalid={!!errors.from_store_id || undefined}>
                      <SelectValue placeholder={sources.isPending ? 'Loading stores…' : 'Choose a store'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(sources.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {s.branch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <StoreSelect value={field.value || null} onChange={field.onChange} aria-label="From store" invalid={!!errors.from_store_id} />
                )
              }
            />
          </FormField>
          <FormField label="To store" error={errors.to_store_id?.message} hint={request ? 'The store that needs the goods.' : 'Any active store, including other branches.'}>
            <Controller control={form.control} name="to_store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} exclude={fromStore || null} aria-label="To store" invalid={!!errors.to_store_id} />} />
          </FormField>
          <FormField label="Note" error={errors.note?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('note')} /></FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Goods</CardTitle></CardHeader>
        <CardContent>
          <LinesEditor control={form.control} register={form.register} setValue={form.setValue} errors={errors} config={request ? {} : { ...DISPATCH_LINES, storeId: fromStore || null, stockedOnly: true }} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => navigate('/inventory/transfers')}>Cancel</Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {request ? 'Send request' : 'Dispatch'}
        </Button>
      </div>
    </form>
  )
}

export const NewTransferPage = () => <TransferForm />
export const RequestTransferPage = () => <TransferForm request />

/** Name of a user reference; older servers send only an id. */
const personName = (ref: UserRef | undefined): string | null => (ref && typeof ref === 'object' ? ref.name : null)
const byWhom = (at: string | null | undefined, ref: UserRef | undefined, timeZone: string | undefined) =>
  `${formatDateTime(at, timeZone)}${personName(ref) ? ` · ${personName(ref)}` : ''}`

/** ST2b: one transfer — request, dispatch, receipt with discrepancies, challan. */
export function TransferPage() {
  const { transferId } = useParams()
  const me = useAuth()
  const can = useCan()
  const { data: t, error, isPending, refetch } = useTransferQuery(transferId)
  const complete = useCompleteTransferMutation()
  const [open, setOpen] = useState<'receive' | 'dispatch' | 'reject' | 'cancel' | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)

  if (isPending) return <LoadingState rows={6} label="Loading transfer" />
  if (!t) return <ErrorState error={error} onRetry={() => refetch()} />

  const tz = me.organization?.timezone
  const canTransfer = can('inventory.transfer')
  const atSource = me.user.is_platform_admin || me.branches.some((b) => b.id === t.from_store?.branch_id)
  const canDispatch = canTransfer && (t.can_dispatch ?? (t.status === 'requested' && atSource))
  const canReject = canTransfer && (t.can_reject ?? (t.status === 'requested' && atSource))
  const lines = t.lines ?? []
  const received = t.status === 'received'
  const requested = lines.some((l) => l.requested_quantity != null)
  const notes = lines.some((l) => l.receive_note)

  const reject = (reason: string) => {
    setRejectError(null)
    complete.mutate({ id: t.id, action: 'reject', body: { reason } }, {
      onSuccess: (r) => {
        setOpen(null)
        toast.success(`${r.number} rejected.`)
      },
      onError: (e) => setRejectError(e.message),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to transfers"><Link to="/inventory/transfers"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{t.number}</h1>
          <Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge>
          {t.has_discrepancy && <Badge variant="warning">Discrepancy</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {t.dispatched_at && <PdfButton path={transferChallanPath(t.id)} filename={`${t.number}-challan.pdf`} label="Print challan" />}
          {canTransfer && t.can_cancel && <Button variant="outline" onClick={() => setOpen('cancel')}><XCircleIcon data-icon="inline-start" /> Cancel</Button>}
          {canReject && <Button variant="outline" onClick={() => { setRejectError(null); setOpen('reject') }}><BanIcon data-icon="inline-start" /> Reject</Button>}
          {canDispatch && <Button onClick={() => setOpen('dispatch')}><TruckIcon data-icon="inline-start" /> Dispatch</Button>}
          {canTransfer && t.can_receive && <Button onClick={() => setOpen('receive')}><PackageCheckIcon data-icon="inline-start" /> Receive</Button>}
        </div>
      </div>

      {t.status === 'rejected' && (
        <div role="note" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Request rejected{personName(t.rejected_by) && ` by ${personName(t.rejected_by)}`}{t.rejected_at && ` on ${formatDateTime(t.rejected_at, tz)}`}:</span> {t.rejection_reason ?? '—'}
        </div>
      )}
      {t.status === 'requested' && (
        <div role="note" className="rounded-md border p-3 text-sm">
          Requested for {t.to_store?.name ?? 'the destination'}. Nothing has moved yet; {t.from_store?.name ?? 'the source store'} dispatches or rejects it.
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-3">
          <div><span className="text-muted-foreground">From</span><div className="font-medium">{t.from_store?.name} · {t.from_store?.branch_name}</div></div>
          <div><span className="text-muted-foreground">To</span><div className="font-medium">{t.to_store?.name} · {t.to_store?.branch_name}</div></div>
          {t.requested_at && <div><span className="text-muted-foreground">Requested</span><div className="font-medium">{byWhom(t.requested_at, t.requested_by, tz)}</div></div>}
          <div><span className="text-muted-foreground">Dispatched</span><div className="font-medium">{t.dispatched_at ? byWhom(t.dispatched_at, t.dispatched_by, tz) : '—'}</div></div>
          {t.completed_at && <div><span className="text-muted-foreground">{received ? 'Received' : 'Closed'}</span><div className="font-medium">{byWhom(t.completed_at, t.completed_by, tz)}</div></div>}
          {received && t.loss_total != null && (
            <div>
              <span className="text-muted-foreground">Loss (short and damaged)</span>
              <div className={`font-medium ${isZeroDecimal(t.loss_total) ? '' : 'text-destructive'}`} data-testid="loss-total">{formatMoney(t.loss_total, me.organization?.base_currency)}</div>
            </div>
          )}
          {t.note && <div className="sm:col-span-3"><span className="text-muted-foreground">Note</span><div className="break-words">{t.note}</div></div>}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Batch</TableHead>
              {requested && <TableHead className="text-right">Requested</TableHead>}
              <TableHead className="text-right">{t.dispatched_at ? 'Sent' : 'To send'}</TableHead>
              {received && <TableHead className="text-right">Received</TableHead>}
              {received && <TableHead className="text-right">Damaged</TableHead>}
              {received && <TableHead className="text-right">Short</TableHead>}
              {notes && <TableHead>Receiving note</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-sm">{variantLabel(l.variant)}<div className="text-xs text-muted-foreground">{l.variant?.sku}</div></TableCell>
                <TableCell className="text-sm">{l.batch ? `${l.batch.batch_number}${l.batch.expires_on ? ` · exp. ${l.batch.expires_on}` : ''}` : '—'}</TableCell>
                {requested && <TableCell className="text-right">{trimDecimal(l.requested_quantity ?? '0')}</TableCell>}
                <TableCell className="text-right">{trimDecimal(l.quantity)}</TableCell>
                {received && <TableCell className="text-right">{trimDecimal(l.received_quantity ?? l.quantity)}</TableCell>}
                {received && <TableCell className="text-right">{trimDecimal(l.damaged_quantity ?? '0')}</TableCell>}
                {received && <TableCell className={`text-right ${isZeroDecimal(l.short_quantity) ? '' : 'font-medium text-destructive'}`}>{trimDecimal(l.short_quantity ?? '0')}</TableCell>}
                {notes && <TableCell className="text-sm break-words">{l.receive_note ?? ''}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {open === 'receive' && <ReceiveTransferDialog transfer={t} onClose={() => setOpen(null)} />}
      {open === 'dispatch' && <DispatchRequestDialog transfer={t} onClose={() => setOpen(null)} />}
      <ReasonDialog
        key={open === 'reject' ? 'reject-open' : 'reject-closed'}
        open={open === 'reject'}
        onOpenChange={(o) => setOpen(o ? 'reject' : null)}
        title={`Reject ${t.number}`}
        description={`${t.to_store?.name ?? 'The requesting store'} sees your reason. Nothing moves.`}
        confirmLabel="Reject request"
        max={200}
        hint="Shown to the requesting branch."
        pending={complete.isPending}
        error={rejectError}
        onConfirm={reject}
      />
      <ConfirmDialog
        open={open === 'cancel'}
        onOpenChange={(o) => !o && setOpen(null)}
        title={`Cancel ${t.number}?`}
        description={cancelDescription(t)}
        confirmLabel={t.status === 'requested' ? 'Cancel request' : 'Cancel transfer'}
        pending={complete.isPending}
        onConfirm={() =>
          complete.mutate({ id: t.id, action: 'cancel' }, {
            onSuccess: (r) => toast.success(`${r.number} cancelled.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setOpen(null),
          })
        }
      />
    </div>
  )
}
