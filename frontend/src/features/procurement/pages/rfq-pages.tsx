import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, AwardIcon, BanIcon, FileDownIcon, Loader2Icon, LockIcon, NotebookPenIcon, PlusIcon, UserPlusIcon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { exportErrorMessage } from '@/features/exports/errors'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { PO_STATUS } from '@/features/purchasing/api'
import { useIdempotencyKey } from '@/features/returns/api'
import { variantDisplayName } from '@/features/supply-chain/api'
import {
  PROCUREMENT_PERMISSIONS,
  rfqListQuery,
  rfqPdfPath,
  useInviteSuppliersMutation,
  useRecordQuoteMutation,
  useRfqActionMutation,
  useRfqComparisonQuery,
  useRfqQuery,
  useRfqsQuery,
  type Rfq,
  type RfqStatus,
  type RfqSupplier,
  type SupplierSummary,
} from '@/features/procurement/api'
import { historyTimeline, RFQ_STATUS, RFQ_TABS, rfqTabLabel, statusBadge } from '@/features/procurement/procurement'
import { AwardDialog, ComparisonMatrix } from '@/features/procurement/components/comparison'
import { QuoteDialog } from '@/features/procurement/components/quote-dialog'
import { RfqForm } from '@/features/procurement/components/rfq-form'
import { Field, Timeline } from '@/features/procurement/components/shared'
import { EmailBadge, SupplierChecklist } from '@/features/procurement/components/supplier-pickers'
import { formatDateTime } from '@/features/web-orders/orders'
import { downloadFile } from '@/lib/api/download'
import { formatMoney, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Tab = RfqStatus | 'all'

/** /purchasing/rfqs — requests for quotation to several suppliers. */
export function RfqsPage() {
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const tab = (RFQ_TABS as string[]).includes(params.get('status') ?? '') ? (params.get('status') as Tab) : 'all'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const query = rfqListQuery({ status: tab, search: term })
  const { data, error, isPending, refetch } = useRfqsQuery({ ...query, page })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Requests for quotation: ask several suppliers, compare their quotes and award orders."
        actions={
          <>
            <ExportMenu list="rfqs" query={query} disabled={!data?.items.length} />
            {can(PROCUREMENT_PERMISSIONS.manage) && <Button asChild><Link to="/purchasing/rfqs/new"><PlusIcon data-icon="inline-start" /> New RFQ</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="overflow-x-auto">
          <Tabs value={tab} onValueChange={(v) => { setParams(v === 'all' ? {} : { status: v }, { replace: true }); setPage(1) }}>
            <TabsList aria-label="RFQ status">
              {RFQ_TABS.map((t) => <TabsTrigger key={t} value={t}>{rfqTabLabel(t)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <Input aria-label="Search RFQs" placeholder="Number or title" className="w-full sm:max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      {isPending ? (
        <LoadingState rows={5} label="Loading RFQs" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={tab !== 'all' || term ? 'No RFQs match' : 'No RFQs yet'} description={tab === 'all' && !term ? 'Create one here, or convert an approved requisition to an RFQ.' : undefined} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="RFQs">
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Reply by</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Quotes</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => {
                  const status = statusBadge(RFQ_STATUS, r.status)
                  return (
                    <TableRow key={r.id}>
                      <TableCell><Link to={`/purchasing/rfqs/${r.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.number}</Link></TableCell>
                      <TableCell className="text-sm">
                        {r.title}
                        {r.requisition && <div className="font-mono text-xs text-muted-foreground">{r.requisition.number}</div>}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{r.reply_by ?? '—'}</TableCell>
                      <TableCell className="hidden text-right text-sm sm:table-cell">{r.quote_count ?? '—'} / {r.supplier_count ?? '—'}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

function PdfButton({ rfq, invite }: { rfq: Rfq; invite: RfqSupplier }) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    try {
      const file = await downloadFile(rfqPdfPath(rfq.id, invite.supplier.id), { fallbackFilename: `${rfq.number}-${invite.supplier.code ?? invite.supplier.name}.pdf` })
      toast.success(`Downloaded ${file.filename}`)
    } catch (error) {
      toast.error(exportErrorMessage(error, 'pdf'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" size="sm" disabled={busy} aria-label={`Download RFQ PDF for ${invite.supplier.name}`} onClick={() => void download()}>
      {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <FileDownIcon data-icon="inline-start" />} PDF
    </Button>
  )
}

/** More suppliers for an RFQ; on a sent RFQ they get the request at once. */
function InviteDialog({ rfq, onClose }: { rfq: Rfq; onClose: () => void }) {
  const [chosen, setChosen] = useState<SupplierSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const invite = useInviteSuppliersMutation()
  const idempotency = useIdempotencyKey()
  const submit = () => {
    const payload = { id: rfq.id, supplierIds: chosen.map((s) => s.id) }
    setError(null)
    invite.mutate({ ...payload, idempotencyKey: idempotency.keyFor(payload) }, {
      onSuccess: () => {
        idempotency.settle()
        toast.success(`${chosen.length} ${chosen.length === 1 ? 'supplier' : 'suppliers'} invited to ${rfq.number}.`)
        onClose()
      },
      onError: (e) => {
        idempotency.settle(e)
        setError(e.message)
      },
    })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite more suppliers</DialogTitle>
          <DialogDescription>They get the request at once: by e-mail when they have an address; download the PDF for the others.</DialogDescription>
        </DialogHeader>
        <SupplierChecklist selected={chosen} onChange={setChosen} exclude={(rfq.suppliers ?? []).map((s) => s.supplier.id)} hint="selected" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={invite.isPending || chosen.length === 0}>
            {invite.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function quoteBadge(invite: RfqSupplier): { label: string; variant: 'success' | 'destructive' | 'outline' } {
  if (invite.quote?.status === 'received') return { label: 'Quoted', variant: 'success' }
  if (invite.quote?.status === 'declined') return { label: 'Declined', variant: 'destructive' }
  return { label: 'Awaiting quote', variant: 'outline' }
}

function SuppliersCard({ rfq, manage, onRecord, onDecline, onInvite }: { rfq: Rfq; manage: boolean; onRecord: (invite: RfqSupplier) => void; onDecline: (invite: RfqSupplier) => void; onInvite?: () => void }) {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const sent = rfq.status !== 'draft' && rfq.status !== 'cancelled'
  const open = rfq.status === 'sent'
  const invites = rfq.suppliers ?? []
  const manual = invites.filter((s) => s.send_manually ?? !s.emailed_at)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Suppliers</CardTitle>
          {onInvite && <Button variant="outline" size="sm" onClick={onInvite}><UserPlusIcon data-icon="inline-start" /> Invite</Button>}
        </div>
        {sent && (
          <CardDescription>
            {manual.length === 0 ? 'Every invited supplier was e-mailed the RFQ.' : `${invites.length - manual.length} e-mailed · ${manual.length} to send manually (download the PDF).`}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y" aria-label="Invited suppliers">
          {invites.map((invite) => {
            const badge = quoteBadge(invite)
            return (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-2" aria-label={invite.supplier.name}>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{invite.supplier.name}</span>
                    <EmailBadge email={invite.supplier.email} />
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {sent && (invite.emailed_at ? `E-mailed ${formatDateTime(invite.emailed_at, timeZone)}` : 'Not e-mailed — send manually')}
                    {invite.quote?.status === 'received' && ` · received ${formatDateTime(invite.quote.received_at, timeZone)}${invite.quote.valid_until ? ` · valid until ${invite.quote.valid_until}` : ''}`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {sent && <PdfButton rfq={rfq} invite={invite} />}
                  {manage && open && (
                    <>
                      <Button variant="outline" size="sm" aria-label={`Record quote from ${invite.supplier.name}`} onClick={() => onRecord(invite)}>
                        <NotebookPenIcon data-icon="inline-start" /> {invite.quote?.status === 'received' ? 'Edit quote' : 'Record quote'}
                      </Button>
                      {invite.quote?.status !== 'declined' && (
                        <Button variant="ghost" size="sm" aria-label={`Mark ${invite.supplier.name} as declined`} onClick={() => onDecline(invite)}>
                          <BanIcon data-icon="inline-start" /> Declined
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function RfqView({ rfq }: { rfq: Rfq }) {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const manage = can(PROCUREMENT_PERMISSIONS.manage)
  const status = statusBadge(RFQ_STATUS, rfq.status)
  const received = (rfq.suppliers ?? []).filter((s) => s.quote?.status === 'received').length
  const showComparison = rfq.status !== 'draft' && rfq.status !== 'cancelled' && received > 0
  const comparison = useRfqComparisonQuery(rfq, showComparison)
  const action = useRfqActionMutation()
  const record = useRecordQuoteMutation()
  const keys = { close: useIdempotencyKey(), cancel: useIdempotencyKey(), decline: useIdempotencyKey() }
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const [quoting, setQuoting] = useState<RfqSupplier | null>(null)
  const [declining, setDeclining] = useState<RfqSupplier | null>(null)
  const [awarding, setAwarding] = useState(false)
  const [inviting, setInviting] = useState(false)
  const canAward = (rfq.can_award ?? (manage && rfq.status === 'sent')) && received > 0
  const canClose = rfq.can_close ?? (manage && rfq.status === 'sent')
  const canCancel = rfq.can_cancel ?? (manage && (rfq.status === 'draft' || rfq.status === 'sent'))

  const run = (kind: 'close' | 'cancel') => {
    const payload = { id: rfq.id, action: kind }
    action.mutate({ ...payload, idempotencyKey: keys[kind].keyFor(payload) }, {
      onSuccess: (r) => { keys[kind].settle(); toast.success(`${r.number} ${kind === 'close' ? 'closed' : 'cancelled'}.`) },
      onError: (e) => { keys[kind].settle(e); toast.error(e.message) },
      onSettled: () => setConfirm(null),
    })
  }

  const decline = (invite: RfqSupplier) => {
    const payload = { rfqId: rfq.id, input: { supplier_id: invite.supplier.id, status: 'declined' as const, valid_until: null, notes: null, lines: [] } }
    record.mutate({ ...payload, idempotencyKey: keys.decline.keyFor(payload) }, {
      onSuccess: () => { keys.decline.settle(); toast.success(`${invite.supplier.name} marked as declined.`) },
      onError: (e) => { keys.decline.settle(e); toast.error(e.message) },
      onSettled: () => setDeclining(null),
    })
  }

  const history = rfq.history?.length
    ? historyTimeline(rfq.history)
    : [
        { label: 'Created', at: rfq.created_at, who: rfq.created_by?.name ?? null, note: null },
        rfq.sent_at ? { label: 'Sent to suppliers', at: rfq.sent_at, who: null, note: null } : null,
        rfq.closed_at ? { label: 'Closed', at: rfq.closed_at, who: null, note: null } : null,
        rfq.awarded_at ? { label: 'Awarded', at: rfq.awarded_at, who: null, note: null } : null,
        rfq.cancelled_at ? { label: 'Cancelled', at: rfq.cancelled_at, who: null, note: null } : null,
      ].filter((e) => e !== null)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to RFQs"><Link to="/purchasing/rfqs"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{rfq.number}</h1>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        {(canCancel || canClose || canAward) && (
          <div className="flex flex-wrap gap-2">
            {canCancel && <Button variant="outline" onClick={() => setConfirm('cancel')}><XCircleIcon data-icon="inline-start" /> Cancel RFQ</Button>}
            {canClose && <Button variant="outline" onClick={() => setConfirm('close')}><LockIcon data-icon="inline-start" /> Close without award</Button>}
            {canAward && <Button disabled={!comparison.data} onClick={() => setAwarding(true)}><AwardIcon data-icon="inline-start" /> Award</Button>}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <Field label="Title" className="sm:col-span-2">{rfq.title}</Field>
            <Field label="Deliver to">{rfq.store?.name ?? '—'}</Field>
            <Field label="Reply by / needed by">{rfq.reply_by ?? '—'} / {rfq.needed_by ?? '—'}</Field>
            {rfq.requisition && (
              <Field label="Requisition">
                <Link to={`/purchasing/requisitions/${rfq.requisition.id}`} className="font-mono underline-offset-4 hover:underline">{rfq.requisition.number}</Link>
              </Field>
            )}
            {rfq.notes && <Field label="Notes" className="sm:col-span-3">{rfq.notes}</Field>}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Requested items">
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rfq.lines ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{variantDisplayName(l.variant)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{l.variant?.sku}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{trimDecimal(l.quantity)} {l.variant?.unit_code ?? l.variant?.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {(rfq.purchase_orders ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Purchase orders</CardTitle></CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm" aria-label="Awarded purchase orders">
                  {(rfq.purchase_orders ?? []).map((po) => (
                    <li key={po.id} className="flex flex-wrap items-center gap-2">
                      <Link to={`/purchasing/orders/${po.id}`} className="font-mono underline-offset-4 hover:underline">{po.number}</Link>
                      {po.supplier && <span className="text-muted-foreground">{po.supplier.name}</span>}
                      {po.status && <Badge variant={statusBadge(PO_STATUS, po.status).variant}>{statusBadge(PO_STATUS, po.status).label}</Badge>}
                      {po.total && <span className="ml-auto font-mono">{formatMoney(po.total, po.currency ?? rfq.currency)}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <SuppliersCard
            rfq={rfq}
            manage={rfq.can_record_quotes ?? manage}
            onRecord={setQuoting}
            onDecline={setDeclining}
            onInvite={rfq.status === 'sent' && (rfq.can_invite ?? manage) ? () => setInviting(true) : undefined}
          />
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent><Timeline entries={history} timeZone={timeZone} label="RFQ history" /></CardContent>
          </Card>
        </div>
      </div>

      {showComparison && (
        <section aria-labelledby="comparison-heading" className="flex flex-col gap-3">
          <h2 id="comparison-heading" className="text-lg font-semibold">Comparison</h2>
          {comparison.isPending ? (
            <LoadingState rows={3} label="Loading comparison" />
          ) : comparison.error ? (
            <ErrorState error={comparison.error} onRetry={() => comparison.refetch()} />
          ) : (
            <ComparisonMatrix comparison={comparison.data} currency={rfq.currency ?? me.organization?.base_currency} />
          )}
        </section>
      )}

      {inviting && <InviteDialog rfq={rfq} onClose={() => setInviting(false)} />}
      {quoting && <QuoteDialog key={quoting.id} rfq={rfq} invite={quoting} onClose={() => setQuoting(null)} />}
      {awarding && comparison.data && <AwardDialog rfq={rfq} comparison={comparison.data} onClose={() => setAwarding(false)} />}
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => !open && setDeclining(null)}
        title={`Mark ${declining?.supplier.name ?? 'supplier'} as declined?`}
        description="Records that the supplier will not quote. Any prices recorded for it are dropped from the comparison."
        confirmLabel="Mark declined"
        pending={record.isPending}
        onConfirm={() => declining && decline(declining)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'close' ? `Close ${rfq.number} without award?` : `Cancel ${rfq.number}?`}
        description={confirm === 'close' ? 'No quotes are recorded or awarded any more; nothing is ordered.' : 'The RFQ is closed and nothing is ordered.'}
        confirmLabel={confirm === 'close' ? 'Close RFQ' : 'Cancel RFQ'}
        destructive={confirm === 'cancel'}
        pending={action.isPending}
        onConfirm={() => confirm && run(confirm)}
      />
    </div>
  )
}

/** /purchasing/rfqs/new and /purchasing/rfqs/:rfqId */
export function RfqPage() {
  const { rfqId } = useParams()
  const can = useCan()
  const { data, error, isPending, refetch } = useRfqQuery(rfqId)

  if (!rfqId) return <RfqForm key="new" />
  if (isPending) return <LoadingState rows={6} label="Loading RFQ" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return data.status === 'draft' && can(PROCUREMENT_PERMISSIONS.manage) ? <RfqForm key={data.id} rfq={data} /> : <RfqView rfq={data} />
}
