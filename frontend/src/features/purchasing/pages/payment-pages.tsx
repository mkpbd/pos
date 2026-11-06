import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PlusIcon } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { SupplierSelect } from '@/features/purchasing/components/supplier-select'
import { PAYMENT_METHODS, today, usePaymentsQuery, useRecordPaymentMutation, useSupplierStatementQuery, type PaymentMethod } from '@/features/purchasing/api'
import { handleFormError } from '@/lib/forms'
import { formatMoney, MONEY_PATTERN } from '@/lib/money'

const METHODS = Object.keys(PAYMENT_METHODS) as PaymentMethod[]
const schema = z.object({
  supplier_id: z.string().min(1, 'Choose a supplier.'),
  amount: z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.').refine((v) => !/^0+(\.0+)?$/.test(v), 'Must be greater than zero.'),
  method: z.enum(METHODS as [PaymentMethod, ...PaymentMethod[]]),
  reference: z.string().max(100),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required.'),
  notes: z.string().max(2000),
})
type Values = z.infer<typeof schema>

export function RecordPaymentDialog({ open, onOpenChange, supplierId }: { open: boolean; onOpenChange: (open: boolean) => void; supplierId?: string }) {
  const record = useRecordPaymentMutation()
  const me = useAuth()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: { supplier_id: supplierId ?? '', amount: '', method: 'bank_transfer', reference: '', paid_on: today(), notes: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((v) =>
    record.mutate(
      { supplier_id: v.supplier_id, amount: v.amount, method: v.method, reference: v.reference.trim() || null, paid_on: v.paid_on, notes: v.notes.trim() || null },
      {
        onSuccess: (p) => {
          toast.success(`${p.number}: ${formatMoney(p.amount, p.currency)} paid to ${p.supplier?.name}.`)
          onOpenChange(false)
        },
        onError: (e) => handleFormError(e, form.setError, ['supplier_id', 'amount', 'method', 'reference', 'paid_on', 'notes']),
      },
    ),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record supplier payment</DialogTitle>
          <DialogDescription>Payments are permanent; correct mistakes with a new entry.</DialogDescription>
        </DialogHeader>
        <form id="payment-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Supplier" error={errors.supplier_id?.message} className="sm:col-span-2">
            <Controller control={form.control} name="supplier_id" render={({ field }) => <SupplierSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.supplier_id} />} />
          </FormField>
          <FormField label={`Amount (${me.organization?.base_currency ?? ''})`} error={errors.amount?.message}><Input inputMode="decimal" {...form.register('amount')} /></FormField>
          <FormField label="Paid on" error={errors.paid_on?.message}><Input type="date" {...form.register('paid_on')} /></FormField>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="payment-form" disabled={record.isPending}>
            {record.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PaymentsPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [recording, setRecording] = useState(false)
  const { data, error, isPending, refetch } = usePaymentsQuery({ page })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Money paid to suppliers."
        actions={
          <>
            <ExportMenu list="supplierPayments" disabled={!data?.items.length} />
            {can('purchases.pay') && <Button onClick={() => setRecording(true)}><PlusIcon data-icon="inline-start" /> Record payment</Button>}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.number}</TableCell>
                    <TableCell className="text-sm">{p.supplier?.name}</TableCell>
                    <TableCell className="text-sm">{p.paid_on}</TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="outline">{PAYMENT_METHODS[p.method]}</Badge></TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{p.reference ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(p.amount, p.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
      {can('purchases.pay') && <RecordPaymentDialog open={recording} onOpenChange={setRecording} />}
    </div>
  )
}

const ENTRY_LABELS: Record<string, string> = { goods_receipt: 'Purchase', receipt_charge: 'Charge', landed_cost_voucher: 'Landed cost', purchase_return: 'Return', payment: 'Payment' }

/** Running account of one supplier, opened from the Suppliers page. */
export function SupplierStatementSheet({ supplierId, onOpenChange }: { supplierId: string | null; onOpenChange: (open: boolean) => void }) {
  const can = useCan()
  const me = useAuth()
  const [paying, setPaying] = useState(false)
  const { data, error, isPending, refetch } = useSupplierStatementQuery(supplierId, {})
  const currency = me.organization?.base_currency

  return (
    <Sheet open={supplierId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Statement{data && ` — ${data.supplier.name}`}</SheetTitle>
          <SheetDescription>Purchases increase what you owe; returns and payments reduce it.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {isPending ? (
            <LoadingState rows={4} label="Loading statement" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Balance owed</div>
                  <div className="font-mono text-xl font-semibold">{formatMoney(data.closing_balance, currency)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {supplierId && <ExportMenu list="supplierStatement" pathParams={{ id: supplierId }} size="sm" />}
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
                      <TableCell className="text-sm">{ENTRY_LABELS[e.type] ?? e.type} <span className="font-mono text-xs text-muted-foreground">{e.number}{e.reference && ` · ${e.reference}`}</span></TableCell>
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
      </SheetContent>
    </Sheet>
  )
}
