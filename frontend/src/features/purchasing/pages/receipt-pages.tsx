import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon, PlusIcon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { emptyLine, type LineValue } from '@/components/common/line-values'
import { LinesEditor } from '@/components/common/lines-editor'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { variantLabel } from '@/features/inventory/api'
import { linesSchema, toApiLine } from '@/features/inventory/lines'
import { DocumentLinesTable } from '@/features/purchasing/components/document-totals'
import { SupplierSelect } from '@/features/purchasing/components/supplier-select'
import {
  today,
  usePostReceiptMutation,
  usePostReturnMutation,
  usePurchaseOrderQuery,
  useReceiptQuery,
  useReceiptsQuery,
  useReturnsQuery,
  type GoodsReceipt,
  type PurchaseLine,
  type PurchaseOrder,
} from '@/features/purchasing/api'
import { ChargesEditor } from '@/features/landed-cost/components/charges-editor'
import { ReceiptLandedPreview } from '@/features/landed-cost/components/receipt-landed-preview'
import { ReceiptCharges } from '@/features/landed-cost/components/receipt-charges'
import { chargesSchema, hasLandedCosts, toChargeInput } from '@/features/landed-cost/charges'
import { handleFormError } from '@/lib/forms'
import { compareDecimal, formatMoney, subtractDecimal, trimDecimal } from '@/lib/money'

export function ReceiptsPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const { data, error, isPending, refetch } = useReceiptsQuery({ page, search: search || undefined })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Goods received from suppliers (their invoices)."
        actions={
          <>
            <ExportMenu list="goodsReceipts" query={{ search: search || undefined }} disabled={!data?.items.length} />
            {can('purchases.receive') && <Button asChild><Link to="/purchasing/receipts/new"><PlusIcon data-icon="inline-start" /> Receive goods</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <Input aria-label="Search receipts" placeholder="Receipt or supplier invoice number" className="max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      {isPending ? (
        <LoadingState rows={5} label="Loading receipts" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No goods received yet" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden md:table-cell">Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="hidden sm:table-cell">Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link to={`/purchasing/receipts/${r.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{r.number}</Link></TableCell>
                    <TableCell className="text-sm">{r.supplier?.name}</TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{r.supplier_invoice_number ?? '—'}</TableCell>
                    <TableCell className="text-sm">{r.invoice_date}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{r.due_date ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.total, r.currency)}</TableCell>
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

const LINE_OPTIONS = { cost: 'required', tax: true, batch: 'in' } as const
const schema = z.object({
  supplier_id: z.string().min(1, 'Choose a supplier.'),
  store_id: z.string().min(1, 'Choose the receiving store.'),
  supplier_invoice_number: z.string().max(64),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required.'),
  due_date: z.string(),
  notes: z.string().max(2000),
  lines: linesSchema(LINE_OPTIONS),
  charges: chargesSchema,
})
type Values = z.infer<typeof schema>

function linesFromOrder(order: PurchaseOrder): LineValue[] {
  return (order.lines ?? [])
    .map((l) => ({ line: l, open: subtractDecimal(l.quantity, l.received_quantity ?? '0') }))
    .filter(({ open }) => compareDecimal(open, '0') > 0)
    .map(({ line, open }) => ({
      ...emptyLine(),
      variant: line.variant && {
        id: line.variant.id,
        label: variantLabel(line.variant),
        sku: line.variant.sku,
        unit_code: line.variant.unit_code,
        allow_decimal: line.variant.allow_decimal,
        track_stock: true,
        track_batches: line.variant.track_batches,
        tax_rate: line.tax_rate,
      },
      quantity: trimDecimal(open),
      max_quantity: trimDecimal(open),
      unit_cost: trimDecimal(line.unit_cost),
      tax_rate: trimDecimal(line.tax_rate),
      source_line_id: line.id,
    }))
}

export function NewReceiptPage() {
  const navigate = useNavigate()
  const me = useAuth()
  const [params] = useSearchParams()
  const orderId = params.get('order') ?? undefined
  const order = usePurchaseOrderQuery(orderId)
  const post = usePostReceiptMutation()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { supplier_id: '', store_id: '', supplier_invoice_number: '', invoice_date: today(), due_date: '', notes: '', lines: [emptyLine()], charges: [] },
  })
  const { errors } = form.formState

  // Receiving against an order: supplier, store and open lines come from the order.
  useEffect(() => {
    if (order.data) {
      form.reset({ ...form.getValues(), supplier_id: order.data.supplier?.id ?? '', store_id: order.data.store?.id ?? '', lines: linesFromOrder(order.data) })
    }
  }, [order.data, form])

  if (orderId && order.isPending) return <LoadingState rows={6} label="Loading order" />
  if (orderId && order.error) return <ErrorState error={order.error} onRetry={() => order.refetch()} />

  const onSubmit = form.handleSubmit((values) =>
    post.mutate(
      {
        supplier_id: values.supplier_id,
        store_id: values.store_id,
        purchase_order_id: orderId ?? null,
        supplier_invoice_number: values.supplier_invoice_number.trim() || null,
        invoice_date: values.invoice_date,
        due_date: values.due_date || null,
        notes: values.notes.trim() || null,
        lines: values.lines.map((l) => toApiLine(l, { ...LINE_OPTIONS, sourceField: 'purchase_order_line_id' })),
        ...(values.charges.length > 0 ? { charges: values.charges.map(toChargeInput) } : {}),
      },
      {
        onSuccess: (r) => {
          toast.success(`${r.number} posted — stock updated.`)
          navigate(`/purchasing/receipts/${r.id}`, { replace: true })
        },
        onError: (error) => handleFormError(error, form.setError, ['supplier_id', 'store_id', 'supplier_invoice_number', 'invoice_date', 'due_date', 'notes', 'lines', 'charges'], { nested: true }),
      },
    ),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to receipts"><Link to="/purchasing/receipts"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{order.data ? `Receive ${order.data.number}` : 'Receive goods'}</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Supplier invoice</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Supplier" error={errors.supplier_id?.message}>
            <Controller control={form.control} name="supplier_id" render={({ field }) => <SupplierSelect value={field.value || null} onChange={field.onChange} disabled={!!orderId} invalid={!!errors.supplier_id} />} />
          </FormField>
          <FormField label="Receiving store" error={errors.store_id?.message}>
            <Controller control={form.control} name="store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.store_id} />} />
          </FormField>
          <FormField label="Supplier invoice no." error={errors.supplier_invoice_number?.message}><Input {...form.register('supplier_invoice_number')} /></FormField>
          <FormField label="Invoice date" error={errors.invoice_date?.message}><Input type="date" {...form.register('invoice_date')} /></FormField>
          <FormField label="Due date" error={errors.due_date?.message} hint="Empty = invoice date + the supplier's payment terms."><Input type="date" {...form.register('due_date')} /></FormField>
          <FormField label="Notes" error={errors.notes?.message}><Textarea rows={1} {...form.register('notes')} /></FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Goods received</CardTitle></CardHeader>
        {/* relative: keeps the lines table's absolutely positioned sr-only text inside the card, so phones don't widen the page. */}
        <CardContent className="relative">
          <LinesEditor control={form.control} register={form.register} setValue={form.setValue} errors={errors} config={{ ...LINE_OPTIONS, fixedProducts: !!orderId, currency: me.organization?.base_currency }} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
          <CardDescription>Freight, duty, insurance or handling on this delivery. They are spread over the lines and added to the stock cost.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChargesEditor control={form.control} register={form.register} errors={errors} billedBy optional />
          <ReceiptLandedPreview control={form.control} currency={me.organization?.base_currency} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button type="submit" disabled={post.isPending}>
          {post.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Post receipt
        </Button>
      </div>
    </form>
  )
}

const returnSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason.').max(255),
  quantities: z.record(z.string(), z.string().regex(/^(\d{1,15}(\.\d{1,3})?)?$/, 'A quantity with up to 3 decimals.')),
})

function ReturnDialog({ receipt, open, onOpenChange }: { receipt: GoodsReceipt; open: boolean; onOpenChange: (open: boolean) => void }) {
  const post = usePostReturnMutation(receipt.id)
  const form = useForm<z.infer<typeof returnSchema>>({ resolver: zodResolver(returnSchema), defaultValues: { reason: '', quantities: {} } })
  const { errors } = form.formState
  const returnable = (receipt.lines ?? []).map((l) => ({ line: l, max: subtractDecimal(l.quantity, l.returned_quantity ?? '0') })).filter((r) => compareDecimal(r.max, '0') > 0)

  const onSubmit = form.handleSubmit((values) => {
    const lines = Object.entries(values.quantities)
      .filter(([, q]) => q.trim() !== '' && compareDecimal(q.trim(), '0') > 0)
      .map(([goods_receipt_line_id, quantity]) => ({ goods_receipt_line_id, quantity: quantity.trim() }))
    const tooMuch = lines.find((l) => compareDecimal(l.quantity, returnable.find((r) => r.line.id === l.goods_receipt_line_id)?.max ?? '0') > 0)
    if (lines.length === 0 || tooMuch) {
      form.setError('root', { message: lines.length === 0 ? 'Enter at least one quantity to return.' : 'A quantity exceeds what can still be returned.' })
      return
    }
    post.mutate({ reason: values.reason, notes: null, lines }, {
      onSuccess: (r) => {
        toast.success(`${r.number} posted — stock reduced.`)
        form.reset()
        onOpenChange(false)
      },
      onError: (error) => handleFormError(error, form.setError, ['reason']),
    })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Return goods from {receipt.number}</DialogTitle>
          <DialogDescription>Stock leaves {receipt.store?.name} at the original cost; the amount owed to {receipt.supplier?.name} is reduced.</DialogDescription>
        </DialogHeader>
        <form id="return-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          {errors.root?.message && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
          {returnable.map(({ line, max }) => (
            <div key={line.id} className="grid grid-cols-[1fr_8rem] items-center gap-3">
              <div className="text-sm">
                <div className="font-medium">{variantLabel(line.variant)}</div>
                <div className="text-xs text-muted-foreground">Returnable: {trimDecimal(max)} {line.variant?.unit_code}</div>
              </div>
              <Input aria-label={`Return quantity of ${variantLabel(line.variant)}`} inputMode="decimal" placeholder="0" {...form.register(`quantities.${line.id}`)} />
            </div>
          ))}
          <FormField label="Reason" error={errors.reason?.message}><Input placeholder="e.g. damaged, wrong item" {...form.register('reason')} /></FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="return-form" disabled={post.isPending || returnable.length === 0}>
            {post.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Post return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReceiptPage() {
  const { receiptId } = useParams()
  const can = useCan()
  const [returning, setReturning] = useState(false)
  const { data, error, isPending, refetch } = useReceiptQuery(receiptId)

  if (isPending) return <LoadingState rows={6} label="Loading receipt" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  const landed = hasLandedCosts(data)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to receipts"><Link to="/purchasing/receipts"><ArrowLeftIcon /></Link></Button>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.number}</h1>
        </div>
        {can('purchases.return') && <Button variant="outline" onClick={() => setReturning(true)}><Undo2Icon data-icon="inline-start" /> Return goods</Button>}
      </div>
      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm sm:grid-cols-4">
          <div><span className="text-muted-foreground">Supplier</span><div className="font-medium">{data.supplier?.name}</div></div>
          <div><span className="text-muted-foreground">Invoice</span><div className="font-medium">{data.supplier_invoice_number ?? '—'} · {data.invoice_date}</div></div>
          <div><span className="text-muted-foreground">Due</span><div className="font-medium">{data.due_date ?? '—'}</div></div>
          <div><span className="text-muted-foreground">Store</span><div className="font-medium">{data.store?.name}</div></div>
        </CardContent>
      </Card>
      <DocumentLinesTable
        lines={data.lines ?? []}
        currency={data.currency}
        subtotal={data.subtotal}
        taxTotal={data.tax_total}
        total={data.total}
        extra={[
          { header: 'Returned', cell: (l) => trimDecimal(l.returned_quantity ?? '0') },
          ...(landed
            ? [
                { header: 'Charges', cell: (l: PurchaseLine) => formatMoney(l.landed_cost ?? '0') },
                { header: 'Landed unit cost', cell: (l: PurchaseLine) => (l.landed_unit_cost ? formatMoney(l.landed_unit_cost, undefined, 4) : '—') },
              ]
            : []),
          ...((data.landed_cost_vouchers ?? []).length > 0 ? [{ header: 'Later vouchers', cell: (l: PurchaseLine) => formatMoney(l.voucher_landed_cost ?? '0') }] : []),
        ]}
      />
      <ReceiptCharges receipt={data} />
      <ReturnDialog receipt={data} open={returning} onOpenChange={setReturning} />
    </div>
  )
}

export function ReturnsPage() {
  const [page, setPage] = useState(1)
  const { data, error, isPending, refetch } = useReturnsQuery({ page })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Goods returned to suppliers. Start a return from the receipt."
        actions={<ExportMenu list="purchaseReturns" disabled={!data?.items.length} />}
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      {isPending ? (
        <LoadingState rows={4} label="Loading returns" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No purchase returns" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden md:table-cell">Receipt</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.number}</TableCell>
                    <TableCell className="text-sm">{r.supplier?.name}</TableCell>
                    <TableCell className="text-sm">{r.reason}</TableCell>
                    <TableCell className="hidden md:table-cell"><Link to={`/purchasing/receipts/${r.goods_receipt_id}`} className="text-sm underline-offset-4 hover:underline">View receipt</Link></TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.total, r.currency)}</TableCell>
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
