import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, BanIcon, CheckIcon, GitBranchPlusIcon, PlusIcon, SendIcon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { PO_STATUS } from '@/features/purchasing/api'
import { useIdempotencyKey } from '@/features/returns/api'
import { variantDisplayName } from '@/features/supply-chain/api'
import {
  PROCUREMENT_PERMISSIONS,
  requisitionListQuery,
  useRequisitionActionMutation,
  useRequisitionQuery,
  useRequisitionsQuery,
  type Requisition,
  type RequisitionStatus,
} from '@/features/procurement/api'
import {
  APPROVAL_LEVEL,
  hasRemaining,
  mayApprove,
  mayCancelRequisition,
  mayEditRequisition,
  REQUISITION_STATUS,
  REQUISITION_TABS,
  requisitionTabLabel,
  RFQ_STATUS,
  requisitionTimeline,
  statusBadge,
} from '@/features/procurement/procurement'
import { ApprovalLevelBadge, Field, ReasonDialog, Timeline } from '@/features/procurement/components/shared'
import { ConvertDialog } from '@/features/procurement/components/convert-dialog'
import { RequisitionForm } from '@/features/procurement/components/requisition-form'
import { formatDateTime } from '@/features/web-orders/orders'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Tab = RequisitionStatus | 'all'

/** /purchasing/requisitions — requests to buy, by status (requesters see their own). */
export function RequisitionsPage() {
  const can = useCan()
  const me = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (REQUISITION_TABS as string[]).includes(params.get('status') ?? '') ? (params.get('status') as Tab) : 'all'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const query = requisitionListQuery({ status: tab, search: term })
  const { data, error, isPending, refetch } = useRequisitionsQuery({ ...query, page })
  const seesAll = can(PROCUREMENT_PERMISSIONS.view) || can(PROCUREMENT_PERMISSIONS.approve) || can(PROCUREMENT_PERMISSIONS.approveHigh)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description={seesAll ? 'Requests to buy from the branches, their approval and conversion to orders.' : 'Your requests to buy goods and their approval.'}
        actions={
          <>
            <ExportMenu list="purchaseRequisitions" query={query} disabled={!data?.items.length} />
            {can(PROCUREMENT_PERMISSIONS.request) && (
              <Button asChild><Link to="/purchasing/requisitions/new"><PlusIcon data-icon="inline-start" /> New requisition</Link></Button>
            )}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="overflow-x-auto">
          <Tabs value={tab} onValueChange={(v) => { setParams(v === 'all' ? {} : { status: v }, { replace: true }); setPage(1) }}>
            <TabsList aria-label="Requisition status">
              {REQUISITION_TABS.map((t) => <TabsTrigger key={t} value={t}>{requisitionTabLabel(t)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <Input aria-label="Search requisitions" placeholder="Number or requester" className="w-full sm:max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      {isPending ? (
        <LoadingState rows={5} label="Loading requisitions" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={tab !== 'all' || term ? 'No requisitions match' : 'No requisitions yet'} description={tab === 'all' && !term && can(PROCUREMENT_PERMISSIONS.request) ? 'Raise one when your store needs goods.' : undefined} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Requisitions">
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead className="hidden md:table-cell">Store</TableHead>
                  <TableHead className="hidden sm:table-cell">Requested by</TableHead>
                  <TableHead className="hidden lg:table-cell">Needed by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => {
                  const status = statusBadge(REQUISITION_STATUS, r.status)
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link to={`/purchasing/requisitions/${r.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.number}</Link>
                        <div className="text-xs text-muted-foreground sm:hidden">{r.requested_by?.name}</div>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{r.store?.name}{r.store?.branch_name && <span className="text-muted-foreground"> · {r.store.branch_name}</span>}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{r.requested_by?.name ?? '—'}{r.requested_by?.id === me.user.id && <span className="text-muted-foreground"> (you)</span>}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">{r.needed_by ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {r.status === 'submitted' && <ApprovalLevelBadge level={r.approval_level} />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.estimated_total, r.currency ?? me.organization?.base_currency)}</TableCell>
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

type Pending = 'submit' | 'approve' | 'reject' | 'cancel' | 'convert' | null

function RequisitionView({ requisition: req }: { requisition: Requisition }) {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const currency = req.currency ?? me.organization?.base_currency
  const action = useRequisitionActionMutation()
  const keys = { submit: useIdempotencyKey(), approve: useIdempotencyKey(), reject: useIdempotencyKey(), cancel: useIdempotencyKey() }
  const [dialog, setDialog] = useState<Pending>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const status = statusBadge(REQUISITION_STATUS, req.status)
  const own = req.requested_by?.id === me.user.id

  const approver = req.status === 'submitted' && mayApprove({ approval_level: req.approval_level, owner: req.requested_by, can_approve: req.can_approve }, me, can)
  const canSubmit = req.status === 'draft' && (req.can_submit ?? (own || can(PROCUREMENT_PERMISSIONS.manage)))
  const canCancel = mayCancelRequisition(req, me, can)
  const canConvert = req.status === 'approved' && (req.can_convert ?? can(PROCUREMENT_PERMISSIONS.manage)) && (req.lines ?? []).some(hasRemaining)

  const run = (kind: 'submit' | 'approve' | 'reject' | 'cancel', reason?: string) => {
    const payload = { id: req.id, action: kind, reason }
    const key = keys[kind]
    setRejectError(null)
    action.mutate({ ...payload, idempotencyKey: key.keyFor(payload) }, {
      onSuccess: (r) => {
        key.settle()
        setDialog(null)
        toast.success(
          kind === 'submit'
            ? r.status === 'approved' ? `${r.number} approved automatically.` : `${r.number} submitted for approval.`
            : `${r.number} ${kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'cancelled'}.`,
        )
      },
      onError: (e) => {
        key.settle(e)
        if (kind === 'reject') setRejectError(e.message)
        else {
          toast.error(e.message)
          setDialog(null)
        }
      },
    })
  }

  const lines = req.lines ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to requisitions"><Link to="/purchasing/requisitions"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{req.number}</h1>
          <Badge variant={status.variant}>{status.label}</Badge>
          <ApprovalLevelBadge level={req.approval_level} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canCancel && <Button variant="outline" onClick={() => setDialog('cancel')}><XCircleIcon data-icon="inline-start" /> Cancel requisition</Button>}
          {canSubmit && <Button onClick={() => setDialog('submit')}><SendIcon data-icon="inline-start" /> Submit for approval</Button>}
          {approver && (
            <>
              <Button variant="outline" onClick={() => { setRejectError(null); setDialog('reject') }}><BanIcon data-icon="inline-start" /> Reject</Button>
              <Button onClick={() => setDialog('approve')}><CheckIcon data-icon="inline-start" /> Approve</Button>
            </>
          )}
          {canConvert && <Button onClick={() => setDialog('convert')}><GitBranchPlusIcon data-icon="inline-start" /> Convert</Button>}
        </div>
      </div>

      {req.status === 'submitted' && req.approval_level && (
        <div role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <div className="font-medium">Waiting for {APPROVAL_LEVEL[req.approval_level].label.toLowerCase()}</div>
          <p className="text-muted-foreground">{APPROVAL_LEVEL[req.approval_level].who}</p>
          {own && !approver && <p className="text-muted-foreground">You raised this requisition, so someone else has to approve it.</p>}
        </div>
      )}
      {req.status === 'rejected' && req.rejection_reason && (
        <div role="note" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Rejected{req.rejected_by && ` by ${req.rejected_by.name}`}:</span> {req.rejection_reason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardContent className="pt-6">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <Field label="For store">{req.store?.name ?? '—'}{req.store?.branch_name && <span className="font-normal text-muted-foreground"> · {req.store.branch_name}</span>}</Field>
                <Field label="Requested by">{req.requested_by?.name ?? '—'}</Field>
                <Field label="Needed by">{req.needed_by ?? '—'}</Field>
                <Field label="Estimated total (incl. tax)">{formatMoney(req.estimated_total, currency)}</Field>
                {req.approved_by && <Field label="Approved by">{req.approved_by.name}</Field>}
                {req.notes && <Field label="Notes" className="sm:col-span-3">{req.notes}</Field>}
              </dl>
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Requested items">
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Est. cost</TableHead>
                  <TableHead className="hidden md:table-cell">Supplier</TableHead>
                  <TableHead className="text-right">Converted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{variantDisplayName(l.variant)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{l.variant?.sku}</div>
                      {l.notes && <div className="text-xs text-muted-foreground">{l.notes}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{trimDecimal(l.quantity)} {l.variant?.unit_code ?? l.variant?.unit}</TableCell>
                    <TableCell className="hidden text-right font-mono sm:table-cell">{l.estimated_unit_cost ? formatMoney(l.estimated_unit_cost, undefined, 2) : '—'}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{l.suggested_supplier?.name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{isZeroDecimal(l.converted_quantity) ? '—' : trimDecimal(l.converted_quantity)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-right font-semibold">Estimated total</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatMoney(req.estimated_total, currency)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          {((req.purchase_orders ?? []).length > 0 || (req.rfqs ?? []).length > 0) && (
            <Card>
              <CardHeader><CardTitle>Converted to</CardTitle></CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm" aria-label="Documents from this requisition">
                  {(req.purchase_orders ?? []).map((po) => (
                    <li key={po.id} className="flex flex-wrap items-center gap-2">
                      {can(PROCUREMENT_PERMISSIONS.view) ? <Link to={`/purchasing/orders/${po.id}`} className="font-mono underline-offset-4 hover:underline">{po.number}</Link> : <span className="font-mono">{po.number}</span>}
                      {po.supplier && <span className="text-muted-foreground">{po.supplier.name}</span>}
                      {po.status && <Badge variant={statusBadge(PO_STATUS, po.status).variant}>{statusBadge(PO_STATUS, po.status).label}</Badge>}
                    </li>
                  ))}
                  {(req.rfqs ?? []).map((rfq) => (
                    <li key={rfq.id} className="flex flex-wrap items-center gap-2">
                      {can(PROCUREMENT_PERMISSIONS.view) ? <Link to={`/purchasing/rfqs/${rfq.id}`} className="font-mono underline-offset-4 hover:underline">{rfq.number}</Link> : <span className="font-mono">{rfq.number}</span>}
                      {rfq.status && <Badge variant={statusBadge(RFQ_STATUS, rfq.status).variant}>{statusBadge(RFQ_STATUS, rfq.status).label}</Badge>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent><Timeline entries={requisitionTimeline(req)} timeZone={timeZone} label="Requisition history" /></CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'submit' || dialog === 'approve' || dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === 'approve' ? `Approve ${req.number}?` : dialog === 'cancel' ? `Cancel ${req.number}?` : `Submit ${req.number}?`}
        description={
          dialog === 'approve'
            ? `Approves ${formatMoney(req.estimated_total, currency)}. Purchasing can then convert it to orders.`
            : dialog === 'cancel'
              ? 'The requisition is closed and cannot be converted.'
              : 'It goes to an approver (or is approved at once when within the auto-approve limit) and can no longer be edited.'
        }
        confirmLabel={dialog === 'approve' ? 'Approve' : dialog === 'cancel' ? 'Cancel requisition' : 'Submit'}
        destructive={dialog === 'cancel'}
        pending={action.isPending}
        onConfirm={() => dialog && dialog !== 'reject' && dialog !== 'convert' && run(dialog)}
      />
      <ReasonDialog
        key={dialog === 'reject' ? 'reject-open' : 'reject-closed'}
        open={dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Reject ${req.number}`}
        description="The requester is notified with your reason."
        confirmLabel="Reject requisition"
        pending={action.isPending}
        error={rejectError}
        onConfirm={(reason) => run('reject', reason)}
      />
      {/* Not gated on canConvert: after a full conversion the refreshed requisition can no longer be
          converted, but the dialog must stay open to show the documents it created. */}
      {dialog === 'convert' && <ConvertDialog requisition={req} open onOpenChange={(open) => !open && setDialog(null)} />}
      <p className="text-xs text-muted-foreground">Created {formatDateTime(req.created_at, timeZone)}</p>
    </div>
  )
}

/** /purchasing/requisitions/new and /purchasing/requisitions/:requisitionId */
export function RequisitionPage() {
  const { requisitionId } = useParams()
  const me = useAuth()
  const can = useCan()
  const { data, error, isPending, refetch } = useRequisitionQuery(requisitionId)

  if (!requisitionId) return <RequisitionForm key="new" />
  if (isPending) return <LoadingState rows={6} label="Loading requisition" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return mayEditRequisition(data, me, can) ? <RequisitionForm key={data.id} requisition={data} /> : <RequisitionView requisition={data} />
}
