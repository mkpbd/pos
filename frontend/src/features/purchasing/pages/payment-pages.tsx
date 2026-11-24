import { useState } from 'react'
import { Link } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangleIcon, BanIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { SupplierSelect } from '@/features/purchasing/components/supplier-select'
import {
  PAYMENT_METHODS,
  today,
  usePaymentsQuery,
  useRecordPaymentMutation,
  useRecordRefundMutation,
  useSupplierStatementQuery,
  useVoidSupplierMoneyMutation,
  type PaymentMethod,
  type SupplierPayment,
  type SupplierRefund,
  type VoidKind,
} from '@/features/purchasing/api'
import { useIdempotencyKey } from '@/features/returns/api'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'
import { formatMoney, MONEY_PATTERN } from '@/lib/money'
import { useSessionStore } from '@/stores/session-store'

/** "Other" is kept only on older payments; new entries use the payments ledger's methods (ST1). */
const METHODS = (Object.keys(PAYMENT_METHODS) as PaymentMethod[]).filter((m) => m !== 'other')
const schema = z.object({
  supplier_id: z.string().min(1, 'Choose a supplier.'),
  amount: z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.').refine((v) => !/^0+(\.0+)?$/.test(v), 'Must be greater than zero.'),
  method: z.enum(METHODS as [PaymentMethod, ...PaymentMethod[]]),
  reference: z.string().max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required.'),
  notes: z.string().max(2000),
})
type Values = z.infer<typeof schema>
type MoneyKind = 'payment' | 'refund'

/** Errors about the cash drawer are shown in the dialog, next to what to do about them. */
const DRAWER_ERRORS = new Set(['CASH_SESSION_REQUIRED', 'INSUFFICIENT_CASH'])

const COPY: Record<MoneyKind, { title: string; description: string; date: string; dateField: 'paid_on' | 'received_on'; submit: string }> = {
  payment: {
    title: 'Record supplier payment',
    description: 'Cash comes out of your open cash drawer; other methods are recorded without it. A wrong entry can be voided.',
    date: 'Paid on',
    dateField: 'paid_on',
    submit: 'Record payment',
  },
  refund: {
    title: 'Record supplier refund',
    description: 'Money the supplier gave back (an overpayment, or credit for returned goods). It increases what you owe them again. Cash goes into your open cash drawer.',
    date: 'Received on',
    dateField: 'received_on',
    submit: 'Record refund',
  },
}

/** Mounted inside DialogContent, so each opening starts empty (and with a fresh idempotency key). */
function SupplierMoneyForm({ kind, supplierId, onDone }: { kind: MoneyKind; supplierId?: string; onDone: () => void }) {
  const payment = useRecordPaymentMutation()
  const refund = useRecordRefundMutation()
  const record = kind === 'payment' ? payment : refund
  const me = useAuth()
  const branchId = useSessionStore((s) => s.activeBranchId)
  const idempotency = useIdempotencyKey()
  const [drawerError, setDrawerError] = useState<ApiError | null>(null)
  const copy = COPY[kind]
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { supplier_id: supplierId ?? '', amount: '', method: 'bank_transfer', reference: '', date: today(), notes: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((v) => {
    const base = { supplier_id: v.supplier_id, branch_id: branchId ?? null, amount: v.amount, method: v.method, reference: v.reference.trim() || null, notes: v.notes.trim() || null }
    const onError = (e: Error) => {
      idempotency.settle(e)
      if (e instanceof ApiError && DRAWER_ERRORS.has(e.code)) return setDrawerError(e)
      setDrawerError(null)
      handleFormError(e, form.setError, ['supplier_id', 'amount', 'method', 'reference', 'date', 'notes'])
      // The date is named after the document on the server.
      if (e instanceof ApiError && e.fieldErrors[copy.dateField]) form.setError('date', { type: 'server', message: e.fieldErrors[copy.dateField]?.[0] })
    }
    const onSuccess = (doc: SupplierPayment | SupplierRefund) => {
      idempotency.settle()
      toast.success(kind === 'payment' ? `${doc.number}: ${formatMoney(doc.amount, doc.currency)} paid to ${doc.supplier?.name}.` : `${doc.number}: ${formatMoney(doc.amount, doc.currency)} received from ${doc.supplier?.name}.`)
      onDone()
    }
    if (kind === 'payment') {
      const input = { ...base, paid_on: v.date }
      payment.mutate({ input, idempotencyKey: idempotency.keyFor(input) }, { onSuccess, onError })
    } else {
      const input = { ...base, received_on: v.date }
      refund.mutate({ input, idempotencyKey: idempotency.keyFor(input) }, { onSuccess, onError })
    }
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <form id={`supplier-${kind}-form`} onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Supplier" error={errors.supplier_id?.message} className="sm:col-span-2">
          <Controller control={form.control} name="supplier_id" render={({ field }) => <SupplierSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.supplier_id} />} />
        </FormField>
        <FormField label={`Amount (${me.organization?.base_currency ?? ''})`} error={errors.amount?.message}><Input inputMode="decimal" {...form.register('amount')} /></FormField>
        <FormField label={copy.date} error={errors.date?.message}><Input type="date" max={today()} {...form.register('date')} /></FormField>
        <FormField label="Method" error={errors.method?.message}>
          <Controller control={form.control} name="method" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full" aria-label="Payment method"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHODS[m]}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </FormField>
        <FormField label="Reference" error={errors.reference?.message}><Input placeholder="Cheque / transaction no." {...form.register('reference')} /></FormField>
        <FormField label="Notes" error={errors.notes?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('notes')} /></FormField>
      </form>
      {drawerError && (
        <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            {drawerError.message}
            {drawerError.code === 'CASH_SESSION_REQUIRED' && <> Open a session on <Link to="/cash-registers" className="underline">Cash registers</Link>, or use another method.</>}
          </span>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={record.isPending}>Cancel</Button>
        <Button type="submit" form={`supplier-${kind}-form`} disabled={record.isPending}>
          {record.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {copy.submit}
        </Button>
      </DialogFooter>
    </>
  )
}

function SupplierMoneyDialog({ kind, open, onOpenChange, supplierId }: { kind: MoneyKind; open: boolean; onOpenChange: (open: boolean) => void; supplierId?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <SupplierMoneyForm kind={kind} supplierId={supplierId} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

export function RecordPaymentDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; supplierId?: string }) {
  return <SupplierMoneyDialog kind="payment" {...props} />
}

export function RecordRefundDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; supplierId?: string }) {
  return <SupplierMoneyDialog kind="refund" {...props} />
}

export type VoidTarget = { kind: VoidKind; doc: SupplierPayment | SupplierRefund }

/** Voids a supplier payment or refund: the entry stays (marked void) and the opposite money movement is booked. */
export function VoidSupplierMoneyDialog({ target, onOpenChange }: { target: VoidTarget | null; onOpenChange: (open: boolean) => void }) {
  const voidDoc = useVoidSupplierMoneyMutation()
  const [reason, setReason] = useState('')
  const doc = target?.doc
  const cash = doc?.method === 'cash'
  const drawer = target?.kind === 'payment' ? ' The cash goes back into your open cash drawer.' : ' The cash comes out of your open cash drawer.'

  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!voidDoc.isPending) { setReason(''); onOpenChange(o) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {doc?.number}?</DialogTitle>
          <DialogDescription>
            {doc && formatMoney(doc.amount, doc.currency)} is reversed on {doc?.supplier?.name ?? 'the supplier'}'s account.{cash && drawer} The entry stays listed as voided.
          </DialogDescription>
        </DialogHeader>
        <form
          id="void-supplier-money-form"
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (!target || !reason.trim()) return
            voidDoc.mutate({ kind: target.kind, id: target.doc.id, reason: reason.trim() }, {
              onSuccess: (d) => {
                toast.success(`${d.number} voided.`)
                setReason('')
                onOpenChange(false)
              },
              onError: (err) => toast.error(err.message),
            })
          }}
        >
          <Label htmlFor="void-supplier-money-reason">Reason</Label>
          <Input id="void-supplier-money-reason" autoFocus maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered twice" />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(''); onOpenChange(false) }} disabled={voidDoc.isPending}>Keep</Button>
          <Button type="submit" form="void-supplier-money-form" variant="destructive" disabled={!reason.trim() || voidDoc.isPending}>
            {voidDoc.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Void
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Voided by …: reason" under a voided row. */
export function VoidNote({ doc }: { doc: SupplierPayment | SupplierRefund }) {
  if (!doc.voided_at) return null
  return <div className="text-xs text-destructive">Voided{doc.voided_by?.name ? ` by ${doc.voided_by.name}` : ''}{doc.void_reason ? `: ${doc.void_reason}` : ''}</div>
}

export function PaymentsPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [recording, setRecording] = useState(false)
  const [voiding, setVoiding] = useState<VoidTarget | null>(null)
  const { data, error, isPending, refetch } = usePaymentsQuery({ page })
  const canPay = can('purchases.pay')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Money paid to suppliers."
        actions={
          <>
            <ExportMenu list="supplierPayments" disabled={!data?.items.length} />
            {canPay && <Button onClick={() => setRecording(true)}><PlusIcon data-icon="inline-start" /> Record payment</Button>}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      {isPending ? (
        <LoadingState rows={4} label="Loading payments" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No supplier payments yet" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Paid on</TableHead>
                  <TableHead className="hidden sm:table-cell">Method</TableHead>
                  <TableHead className="hidden md:table-cell">Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canPay && <TableHead><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id} className={p.voided_at ? 'text-muted-foreground' : undefined}>
                    <TableCell className="font-mono text-sm">
                      {p.number}
                      {p.voided_at && <Badge variant="destructive" className="ml-2">Voided</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{p.supplier?.name}<VoidNote doc={p} /></TableCell>
                    <TableCell className="text-sm">{p.paid_on}</TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="outline">{PAYMENT_METHODS[p.method]}</Badge></TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{p.reference ?? '—'}</TableCell>
                    <TableCell className={p.voided_at ? 'text-right font-mono line-through' : 'text-right font-mono'}>{formatMoney(p.amount, p.currency)}</TableCell>
                    {canPay && (
                      <TableCell className="text-right">
                        {!p.voided_at && <Button variant="ghost" size="icon-sm" aria-label={`Void ${p.number}`} onClick={() => setVoiding({ kind: 'payment', doc: p })}><BanIcon /></Button>}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
      {canPay && <RecordPaymentDialog open={recording} onOpenChange={setRecording} />}
      {canPay && <VoidSupplierMoneyDialog target={voiding} onOpenChange={(o) => { if (!o) setVoiding(null) }} />}
    </div>
  )
}

const ENTRY_LABELS: Record<string, string> = {
  goods_receipt: 'Purchase',
  receipt_charge: 'Charge',
  landed_cost_voucher: 'Landed cost',
  purchase_return: 'Return',
  payment: 'Payment',
  refund: 'Refund received',
  payment_void: 'Payment voided',
  refund_void: 'Refund voided',
}

/** Running account of one supplier, opened from the Suppliers page. */
export function SupplierStatementSheet({ supplierId, onOpenChange }: { supplierId: string | null; onOpenChange: (open: boolean) => void }) {
  const can = useCan()
  const me = useAuth()
  const [paying, setPaying] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const { data, error, isPending, refetch } = useSupplierStatementQuery(supplierId, {})
  const currency = me.organization?.base_currency

  return (
    <Sheet open={supplierId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Statement{data && ` — ${data.supplier.name}`}</SheetTitle>
          <SheetDescription>Purchases and refunds received increase what you owe; returns and payments reduce it.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {isPending ? (
            <LoadingState rows={4} label="Loading statement" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Balance owed</div>
                  <div className="font-mono text-xl font-semibold">{formatMoney(data.closing_balance, currency)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {supplierId && <ExportMenu list="supplierStatement" pathParams={{ id: supplierId }} size="sm" />}
                  {can('purchases.pay') && <Button size="sm" variant="outline" onClick={() => setRefunding(true)}>Record refund</Button>}
                  {can('purchases.pay') && <Button size="sm" onClick={() => setPaying(true)}>Record payment</Button>}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">Opening balance</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(data.opening_balance)}</TableCell>
                  </TableRow>
                  {data.entries.map((e, i) => (
                    <TableRow key={`${e.type}-${e.id}-${i}`}>
                      <TableCell className="text-sm whitespace-nowrap">{e.date}</TableCell>
                      <TableCell className="text-sm">{ENTRY_LABELS[e.type] ?? e.type.replaceAll('_', ' ')} <span className="font-mono text-xs text-muted-foreground">{e.number}{e.reference && ` · ${e.reference}`}</span></TableCell>
                      <TableCell className={`text-right font-mono ${e.amount.startsWith('-') ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{formatMoney(e.amount)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(e.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>
        {supplierId && <RecordPaymentDialog open={paying} onOpenChange={setPaying} supplierId={supplierId} />}
        {supplierId && <RecordRefundDialog open={refunding} onOpenChange={setRefunding} supplierId={supplierId} />}
      </SheetContent>
    </Sheet>
  )
}
