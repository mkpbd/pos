import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, BanIcon, CheckIcon, Loader2Icon, PackageCheckIcon, PlusIcon, SendIcon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { emptyLine, type LineValue } from '@/components/common/line-values'
import { LinesEditor } from '@/components/common/lines-editor'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { linesSchema, toApiLine } from '@/features/inventory/lines'
import { DocumentLinesTable } from '@/features/purchasing/components/document-totals'
import { SupplierSelect } from '@/features/purchasing/components/supplier-select'
import { PurchaseOrderCatalogHints } from '@/features/supply-chain/components/po-catalog-hints'
import { PROCUREMENT_PERMISSIONS, usePurchaseOrderApprovalMutation } from '@/features/procurement/api'
import { mayApprove } from '@/features/procurement/procurement'
import { ApprovalLevelBadge, ReasonDialog, Timeline } from '@/features/procurement/components/shared'
import { historyTimeline, APPROVAL_LEVEL } from '@/features/procurement/procurement'
import { useIdempotencyKey } from '@/features/returns/api'
import {
  PO_STATUS,
  today,
  usePurchaseOrderQuery,
  usePurchaseOrdersQuery,
  usePurchaseOrderStatusMutation,
  useSavePurchaseOrderMutation,
  type PurchaseOrder,
} from '@/features/purchasing/api'
import { handleFormError } from '@/lib/forms'
import { formatMoney, trimDecimal } from '@/lib/money'

export function PurchaseOrdersPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const { data, error, isPending, refetch } = usePurchaseOrdersQuery({ page })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Orders to suppliers, goods received, returns and payments."
        actions={
          <>
            <ExportMenu list="purchaseOrders" disabled={!data?.items.length} />
            {can('purchases.manage') && <Button asChild><Link to="/purchasing/orders/new"><PlusIcon data-icon="inline-start" /> New order</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      {isPending ? (
        <LoadingState rows={5} label="Loading purchase orders" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No purchase orders" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden md:table-cell">Store</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Ordered</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><Link to={`/purchasing/orders/${o.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{o.number}</Link></TableCell>
                    <TableCell className="text-sm">{o.supplier?.name}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{o.store?.name}</TableCell>
                    <TableCell><Badge variant={PO_STATUS[o.status].variant}>{PO_STATUS[o.status].label}</Badge></TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{o.order_date}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(o.total, o.currency)}</TableCell>
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

const LINE_OPTIONS = { cost: 'required', tax: true } as const
const schema = z.object({
  supplier_id: z.string().min(1, 'Choose a supplier.'),
  store_id: z.string().min(1, 'Choose the receiving store.'),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required.'),
  expected_date: z.string(),
  notes: z.string().max(2000),
  lines: linesSchema(LINE_OPTIONS),
})
type Values = z.infer<typeof schema>

function toFormLines(order: PurchaseOrder): LineValue[] {
  return (order.lines ?? []).map((l) => ({
    ...emptyLine(),
    variant: l.variant && {
      id: l.variant.id,
      label: l.variant.variant_name ? `${l.variant.product_name} — ${l.variant.variant_name}` : l.variant.product_name,
      sku: l.variant.sku,
      unit_code: l.variant.unit_code,
      allow_decimal: l.variant.allow_decimal,
      track_stock: true,
      track_batches: l.variant.track_batches,
      tax_rate: l.tax_rate,
    },
    quantity: trimDecimal(l.quantity),
    unit_cost: trimDecimal(l.unit_cost),
    tax_rate: trimDecimal(l.tax_rate),
  }))
}

const isPreApproved = (order: PurchaseOrder): boolean => order.pre_approved ?? (order.pre_approved_amount != null)
const preApprovalTitle = (order: PurchaseOrder): string =>
  order.pre_approval_limit ? `Ordered without further approval up to ${formatMoney(order.pre_approval_limit, order.currency)} (approved amount + 5 %)` : 'Within the approved requisition amount'

/** Where the order came from (requisition / RFQ) and why an approval was rejected. */
function OrderOrigin({ order }: { order: PurchaseOrder }) {
  const links = [
    order.requisition && { label: 'requisition', to: `/purchasing/requisitions/${order.requisition.id}`, number: order.requisition.number },
    order.rfq && { label: 'RFQ', to: `/purchasing/rfqs/${order.rfq.id}`, number: order.rfq.number },
  ].filter((l) => !!l)
  return (
    <>
      {order.rejection_reason && order.status === 'draft' && (
        <div role="note" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Approval rejected{order.rejected_by && ` by ${order.rejected_by.name}`}:</span> {order.rejection_reason}
        </div>
      )}
      {links.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {links.map((l) => (
            <span key={l.to}>
              From {l.label} <Link to={l.to} className="font-mono text-foreground underline-offset-4 hover:underline">{l.number}</Link>
            </span>
          ))}
        </p>
      )}
    </>
  )
}

function OrderView({ order }: { order: PurchaseOrder }) {
  const me = useAuth()
  const can = useCan()
  const navigate = useNavigate()
  const status = usePurchaseOrderStatusMutation()
  const approval = usePurchaseOrderApprovalMutation()
  const approveKey = useIdempotencyKey()
  const rejectKey = useIdempotencyKey()
  const [confirm, setConfirm] = useState<'place' | 'cancel' | 'approve' | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const receivable = order.status === 'ordered' || order.status === 'partially_received'
  const pending = order.status === 'pending_approval'
  const approver = pending && mayApprove({ approval_level: order.approval_level, owner: order.submitted_by ?? order.created_by, can_approve: order.can_approve }, me, can)

  const decide = (decision: 'approve' | 'reject', reason?: string) => {
    const key = decision === 'approve' ? approveKey : rejectKey
    const payload = { id: order.id, action: decision, reason }
    setRejectError(null)
    approval.mutate({ ...payload, idempotencyKey: key.keyFor(payload) }, {
      onSuccess: (o) => {
        key.settle()
        setRejecting(false)
        setConfirm(null)
        toast.success(decision === 'approve' ? `${o.number} approved and ordered.` : `${o.number} sent back to draft.`)
      },
      onError: (e) => {
        key.settle(e)
        if (decision === 'reject') setRejectError(e.message)
        else {
          setConfirm(null)
          toast.error(e.message)
        }
      },
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to orders"><Link to="/purchasing/orders"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{order.number}</h1>
          <Badge variant={PO_STATUS[order.status].variant}>{PO_STATUS[order.status].label}</Badge>
          {pending && <ApprovalLevelBadge level={order.approval_level} />}
          {isPreApproved(order) && <Badge variant="success" title={preApprovalTitle(order)}>Pre-approved</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {approver && (
            <>
              <Button variant="outline" onClick={() => { setRejectError(null); setRejecting(true) }}><BanIcon data-icon="inline-start" /> Reject</Button>
              <Button onClick={() => setConfirm('approve')}><CheckIcon data-icon="inline-start" /> Approve</Button>
            </>
          )}
          {can('purchases.manage') && (order.status === 'draft' || order.status === 'ordered') && (
            <Button variant="outline" onClick={() => setConfirm('cancel')}><XCircleIcon data-icon="inline-start" /> Cancel order</Button>
          )}
          {can('purchases.receive') && receivable && (
            <Button onClick={() => navigate(`/purchasing/receipts/new?order=${order.id}`)}><PackageCheckIcon data-icon="inline-start" /> Receive goods</Button>
          )}
        </div>
      </div>
      {pending && !approver && (
        <div role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Waiting for approval{order.submitted_by && ` (submitted by ${order.submitted_by.name})`}. It is placed with the supplier once approved.
          {can(PROCUREMENT_PERMISSIONS.approve) || can(PROCUREMENT_PERMISSIONS.approveHigh) ? ' You cannot approve an order you submitted, or one above your approval level.' : ''}
        </div>
      )}
      <OrderOrigin order={order} />
      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm sm:grid-cols-3">
          <div><span className="text-muted-foreground">Supplier</span><div className="font-medium">{order.supplier?.name}</div></div>
          <div><span className="text-muted-foreground">Deliver to</span><div className="font-medium">{order.store?.name} · {order.store?.branch_name}</div></div>
          <div><span className="text-muted-foreground">Ordered / expected</span><div className="font-medium">{order.order_date} / {order.expected_date ?? '—'}</div></div>
          {order.notes && <div className="sm:col-span-3"><span className="text-muted-foreground">Notes</span><div>{order.notes}</div></div>}
        </CardContent>
      </Card>
      <DocumentLinesTable
        lines={order.lines ?? []}
        currency={order.currency}
        subtotal={order.subtotal}
        taxTotal={order.tax_total}
        total={order.total}
        extra={{ header: 'Received', cell: (l) => trimDecimal(l.received_quantity ?? '0') }}
      />
      {(order.history ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent><Timeline entries={historyTimeline(order.history ?? [])} timeZone={me.organization?.timezone} label="Order history" /></CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={confirm === 'approve'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Approve ${order.number}?`}
        description={`Approves ${formatMoney(order.total, order.currency)}; the order is placed with ${order.supplier?.name ?? 'the supplier'}.`}
        confirmLabel="Approve"
        destructive={false}
        pending={approval.isPending}
        onConfirm={() => decide('approve')}
      />
      <ReasonDialog
        key={rejecting ? 'reject-open' : 'reject-closed'}
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${order.number}`}
        description="The order goes back to draft with your reason."
        confirmLabel="Reject order"
        pending={approval.isPending}
        error={rejectError}
        onConfirm={(reason) => decide('reject', reason)}
      />
      <ConfirmDialog
        open={confirm === 'place' || confirm === 'cancel'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'place' ? `Place ${order.number}?` : `Cancel ${order.number}?`}
        description={confirm === 'place' ? 'The order is sent and can no longer be edited.' : 'The order is closed without receiving goods.'}
        confirmLabel={confirm === 'place' ? 'Place order' : 'Cancel order'}
        destructive={confirm === 'cancel'}
        pending={status.isPending}
        onConfirm={() =>
          (confirm === 'place' || confirm === 'cancel') && status.mutate({ id: order.id, action: confirm }, {
            onSuccess: (o) => toast.success(`${o.number} is now ${PO_STATUS[o.status].label.toLowerCase()}.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setConfirm(null),
          })
        }
      />
    </div>
  )
}

function OrderForm({ order }: { order?: PurchaseOrder }) {
  const navigate = useNavigate()
  const me = useAuth()
  const save = useSavePurchaseOrderMutation()
  const status = usePurchaseOrderStatusMutation()
  const approval = usePurchaseOrderApprovalMutation()
  const submitKey = useIdempotencyKey()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: order
      ? { supplier_id: order.supplier?.id ?? '', store_id: order.store?.id ?? '', order_date: order.order_date, expected_date: order.expected_date ?? '', notes: order.notes ?? '', lines: toFormLines(order) }
      : { supplier_id: '', store_id: '', order_date: today(), expected_date: '', notes: '', lines: [emptyLine()] },
  })
  const { errors } = form.formState

  const submit = (place: boolean) =>
    form.handleSubmit((values) =>
      save.mutate(
        {
          id: order?.id,
          input: {
            supplier_id: values.supplier_id, store_id: values.store_id, order_date: values.order_date,
            expected_date: values.expected_date || null, notes: values.notes.trim() || null,
            lines: values.lines.map((l) => toApiLine(l, LINE_OPTIONS)),
          },
        },
        {
          onSuccess: (saved) => {
            const done = () => navigate(`/purchasing/orders/${saved.id}`, { replace: true })
            if (!place) {
              toast.success(`${saved.number} saved as draft.`)
              return done()
            }
            // Submit: placed at once when within the auto-approve limit or pre-approved, else it waits for approval.
            const payload = { id: saved.id, action: 'submit' as const }
            approval.mutate({ ...payload, idempotencyKey: submitKey.keyFor(payload) }, {
              onSuccess: (o) => {
                submitKey.settle()
                toast.success(o.status === 'pending_approval' ? `${o.number} submitted for approval.` : `${o.number} placed.`)
                done()
              },
              onError: (e) => {
                submitKey.settle(e)
                toast.error(e.message)
              },
            })
          },
          onError: (error) => handleFormError(error, form.setError, ['supplier_id', 'store_id', 'order_date', 'expected_date', 'notes', 'lines'], { nested: true }),
        },
      ),
    )

  return (
    <form onSubmit={submit(false)} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to orders"><Link to="/purchasing/orders"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{order ? `Edit ${order.number}` : 'New purchase order'}</h1>
        {order && <Badge variant="outline">Draft</Badge>}
        {order && isPreApproved(order) && <Badge variant="success" title={preApprovalTitle(order)}>Pre-approved</Badge>}
        {order && (
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirmCancel(true)}>
            <XCircleIcon data-icon="inline-start" /> Cancel draft
          </Button>
        )}
      </div>
      {order && <OrderOrigin order={order} />}
      <Card>
        <CardHeader><CardTitle>Order</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Supplier" error={errors.supplier_id?.message}>
            <Controller control={form.control} name="supplier_id" render={({ field }) => <SupplierSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.supplier_id} />} />
          </FormField>
          <FormField label="Deliver to store" error={errors.store_id?.message}>
            <Controller control={form.control} name="store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.store_id} />} />
          </FormField>
          <FormField label="Order date" error={errors.order_date?.message}><Input type="date" {...form.register('order_date')} /></FormField>
          <FormField label="Expected delivery" error={errors.expected_date?.message}><Input type="date" {...form.register('expected_date')} /></FormField>
          <FormField label="Notes" error={errors.notes?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('notes')} /></FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent>
          <LinesEditor control={form.control} register={form.register} setValue={form.setValue} errors={errors} config={{ ...LINE_OPTIONS, currency: me.organization?.base_currency }} />
          <div className="mt-3">
            <PurchaseOrderCatalogHints control={form.control} setValue={form.setValue} initialSupplierId={order?.supplier?.id} />
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {order?.submit_requires_approval && order.submit_approval_level && order.submit_approval_level !== 'none' && (
          <p className="mr-auto text-sm text-muted-foreground">Submitting sends it for {APPROVAL_LEVEL[order.submit_approval_level].label.toLowerCase()} before it is placed.</p>
        )}
        <Button type="submit" variant="outline" disabled={save.isPending}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save draft
        </Button>
        <Button type="button" disabled={save.isPending || approval.isPending} onClick={submit(true)}>
          <SendIcon data-icon="inline-start" /> Save & submit
        </Button>
      </div>
      {order && (
        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title={`Cancel ${order.number}?`}
          description="The draft is closed and can no longer be placed."
          confirmLabel="Cancel draft"
          pending={status.isPending}
          onConfirm={() => status.mutate({ id: order.id, action: 'cancel' }, {
            onSuccess: () => { toast.success(`${order.number} cancelled.`); navigate('/purchasing/orders') },
            onError: (e) => toast.error(e.message),
            onSettled: () => setConfirmCancel(false),
          })}
        />
      )}
    </form>
  )
}

export function PurchaseOrderPage() {
  const { orderId } = useParams()
  const can = useCan()
  const { data, error, isPending, refetch } = usePurchaseOrderQuery(orderId)

  if (!orderId) return <OrderForm key="new" />
  if (isPending) return <LoadingState rows={6} label="Loading order" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return data.status === 'draft' && can('purchases.manage') ? <OrderForm key={data.id} order={data} /> : <OrderView order={data} />
}
