import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon, PackageCheckIcon, PlusIcon, SendIcon, XCircleIcon } from 'lucide-react'
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

function OrderView({ order }: { order: PurchaseOrder }) {
  const can = useCan()
  const navigate = useNavigate()
  const status = usePurchaseOrderStatusMutation()
  const [confirm, setConfirm] = useState<'place' | 'cancel' | null>(null)
  const receivable = order.status === 'ordered' || order.status === 'partially_received'

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to orders"><Link to="/purchasing/orders"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{order.number}</h1>
          <Badge variant={PO_STATUS[order.status].variant}>{PO_STATUS[order.status].label}</Badge>
        </div>
        <div className="flex gap-2">
          {can('purchases.manage') && (order.status === 'draft' || order.status === 'ordered') && (
            <Button variant="outline" onClick={() => setConfirm('cancel')}><XCircleIcon data-icon="inline-start" /> Cancel order</Button>
          )}
          {can('purchases.receive') && receivable && (
            <Button onClick={() => navigate(`/purchasing/receipts/new?order=${order.id}`)}><PackageCheckIcon data-icon="inline-start" /> Receive goods</Button>
          )}
        </div>
      </div>
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
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'place' ? `Place ${order.number}?` : `Cancel ${order.number}?`}
        description={confirm === 'place' ? 'The order is sent and can no longer be edited.' : 'The order is closed without receiving goods.'}
        confirmLabel={confirm === 'place' ? 'Place order' : 'Cancel order'}
        destructive={confirm === 'cancel'}
        pending={status.isPending}
        onConfirm={() =>
          confirm && status.mutate({ id: order.id, action: confirm }, {
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
            status.mutate({ id: saved.id, action: 'place' }, { onSuccess: () => { toast.success(`${saved.number} placed.`); done() }, onError: (e) => toast.error(e.message) })
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
        {order && (
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirmCancel(true)}>
            <XCircleIcon data-icon="inline-start" /> Cancel draft
          </Button>
        )}
      </div>
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
      <div className="flex justify-end gap-2">
        <Button type="submit" variant="outline" disabled={save.isPending}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save draft
        </Button>
        <Button type="button" disabled={save.isPending || status.isPending} onClick={submit(true)}>
          <SendIcon data-icon="inline-start" /> Save & place order
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
