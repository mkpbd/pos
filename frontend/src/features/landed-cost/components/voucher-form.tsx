import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { ErrorState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/use-auth'
import { SupplierSelect } from '@/features/purchasing/components/supplier-select'
import { todayIn } from '@/features/promotions/report'
import { useIdempotencyKey } from '@/features/returns/api'
import {
  useDeleteVoucherMutation,
  usePostVoucherMutation,
  useSaveVoucherMutation,
  useVoucherPreviewQuery,
  type LandedCostVoucher,
  type VoucherInput,
} from '@/features/landed-cost/api'
import { sumMoney } from '@/features/landed-cost/allocation'
import { chargesSchema, emptyCharge, toChargeInput, type ChargeValue } from '@/features/landed-cost/charges'
import { ChargesEditor } from '@/features/landed-cost/components/charges-editor'
import { ReceiptPicker, type PickedReceipt } from '@/features/landed-cost/components/receipt-picker'
import { VoucherAllocationTable } from '@/features/landed-cost/components/voucher-allocation-table'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'
import { useSessionStore } from '@/stores/session-store'
import { formatMoney, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const receiptShape = z.object({
  id: z.string(),
  number: z.string(),
  supplier_name: z.string().nullable(),
  store_name: z.string().nullable(),
  branch_id: z.string().nullable(),
  branch_name: z.string().nullable(),
  invoice_date: z.string().nullable(),
  total: z.string().nullable(),
  currency: z.string().nullable(),
})

const schema = z
  .object({
    voucher_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required.'),
    charge_supplier_id: z.string().min(1, 'Choose the supplier who bills these charges.'),
    reference: z.string().max(64, 'At most 64 characters.'),
    notes: z.string().max(1000, 'At most 1000 characters.'),
    charges: chargesSchema,
    receipts: z.array(receiptShape),
  })
  .superRefine((v, ctx) => {
    if (v.charges.length === 0) ctx.addIssue({ code: 'custom', path: ['charges'], message: 'Add at least one charge.' })
    if (v.receipts.length === 0) ctx.addIssue({ code: 'custom', path: ['receipts'], message: 'Choose at least one posted receipt.' })
  })

type Values = z.infer<typeof schema>

function defaults(voucher: LandedCostVoucher | undefined, timeZone: string | undefined): Values {
  if (!voucher) return { voucher_date: todayIn(timeZone), charge_supplier_id: '', reference: '', notes: '', charges: [emptyCharge()], receipts: [] }
  return {
    voucher_date: voucher.voucher_date,
    charge_supplier_id: voucher.charge_supplier?.id ?? '',
    reference: voucher.reference ?? '',
    notes: voucher.notes ?? '',
    charges: (voucher.charges ?? []).map((c): ChargeValue => ({
      type: c.type,
      description: c.description ?? '',
      amount: trimDecimal(c.amount),
      tax_amount: c.tax_amount && !/^0*(\.0*)?$/.test(c.tax_amount) ? trimDecimal(c.tax_amount) : '',
      allocation: c.allocation,
      charge_supplier_id: null,
    })),
    receipts: (voucher.receipts ?? []).map((r) => ({
      id: r.id,
      number: r.number,
      supplier_name: r.supplier?.name ?? null,
      store_name: r.store?.name ?? null,
      branch_id: r.store?.branch_id ?? null,
      branch_name: voucher.branch?.name ?? null,
      invoice_date: r.invoice_date ?? null,
      total: r.landed_total ?? r.subtotal ?? null,
      currency: voucher.currency,
    })),
  }
}

/** The voucher's branch is its receipts' branch (they must share one); else the current one. */
function toInput(values: Values, fallbackBranch: string | null): VoucherInput {
  return {
    branch_id: values.receipts.find((r) => r.branch_id)?.branch_id ?? fallbackBranch ?? '',
    voucher_date: values.voucher_date,
    charge_supplier_id: values.charge_supplier_id,
    reference: values.reference.trim() || null,
    notes: values.notes.trim() || null,
    charges: values.charges.map((c) => {
      const { charge_supplier_id: _ignored, ...rest } = toChargeInput(c)
      return rest
    }),
    receipt_ids: values.receipts.map((r) => r.id),
  }
}

/** Create or edit a draft landed cost voucher; "Save & post" posts it after a confirmation. */
export function VoucherForm({ voucher }: { voucher?: LandedCostVoucher }) {
  const navigate = useNavigate()
  const me = useAuth()
  const currency = voucher?.currency ?? me.organization?.base_currency
  const save = useSaveVoucherMutation()
  const post = usePostVoucherMutation()
  const remove = useDeleteVoucherMutation()
  const postKey = useIdempotencyKey()
  const [confirm, setConfirm] = useState<'post' | 'delete' | null>(null)
  const [pendingValues, setPendingValues] = useState<Values | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(voucher, me.organization?.timezone) })
  const { errors } = form.formState
  const activeBranchId = useSessionStore((s) => s.activeBranchId)
  const fallbackBranch = voucher?.branch?.id ?? activeBranchId

  // Server preview of the allocation, refreshed (debounced) while the draft is valid.
  const watched = useWatch({ control: form.control }) as Values
  const candidate = useMemo(() => {
    const parsed = schema.safeParse(watched)
    return parsed.success ? JSON.stringify(toInput(parsed.data, fallbackBranch)) : null
  }, [watched, fallbackBranch])
  const debounced = useDebouncedValue(candidate, 400)
  const previewInput = useMemo(() => (debounced ? (JSON.parse(debounced) as VoucherInput) : null), [debounced])
  const preview = useVoucherPreviewQuery(previewInput)

  const chargesTotal = sumMoney((watched.charges ?? []).map((c) => (/^\d+(\.\d{1,2})?$/.test(c?.amount?.trim() ?? '') ? c.amount.trim() : '0')))
  const taxTotal = sumMoney((watched.charges ?? []).map((c) => (/^\d+(\.\d{1,2})?$/.test(c?.tax_amount?.trim() ?? '') ? c.tax_amount.trim() : '0')))

  const fields = ['voucher_date', 'charge_supplier_id', 'reference', 'notes', 'charges', 'receipts'] as const

  const persist = (values: Values, andPost: boolean) => {
    const input = toInput(values, fallbackBranch)
    save.mutate({ id: voucher?.id, input }, {
      onSuccess: (saved) => {
        const done = () => navigate(`/purchasing/landed-costs/${saved.id}`, { replace: true })
        if (!andPost) {
          toast.success(`${saved.number} saved as draft.`)
          return done()
        }
        const payload = { id: saved.id }
        post.mutate({ ...payload, idempotencyKey: postKey.keyFor(payload) }, {
          onSuccess: (posted) => {
            postKey.settle()
            toast.success(`${posted.number} posted — stock costs updated.`)
            done()
          },
          onError: (e) => {
            postKey.settle(e)
            toast.error(e.message)
            done()
          },
          onSettled: () => setConfirm(null),
        })
      },
      onError: (error) => {
        setConfirm(null)
        // receipt_ids.* and branch_id errors belong to the receipts picker; the rest to their fields.
        const onReceipts = (key: string) => key.startsWith('receipt_ids') || key === 'branch_id'
        const receiptError = error instanceof ApiError ? Object.entries(error.fieldErrors).find(([key]) => onReceipts(key)) : undefined
        if (receiptError) form.setError('receipts', { type: 'server', message: receiptError[1][0] })
        const others = error instanceof ApiError && Object.keys(error.fieldErrors).some((key) => !onReceipts(key))
        if (!receiptError || others) handleFormError(error, form.setError, fields, { nested: true })
      },
    })
  }

  const askPost = form.handleSubmit((values) => {
    setPendingValues(values)
    setConfirm('post')
  })

  const busy = save.isPending || post.isPending
  const supplierError = errors.charge_supplier_id?.message
  const previewTotals = preview.data ? { onHand: preview.data.on_hand_total, sold: preview.data.consumed_total } : null

  return (
    <form onSubmit={form.handleSubmit((v) => persist(v, false))} noValidate className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to landed costs"><Link to="/purchasing/landed-costs"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{voucher ? `Edit ${voucher.number}` : 'New landed cost voucher'}</h1>
        {voucher && <Badge variant="outline">Draft</Badge>}
        {voucher && (
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirm('delete')}>
            <Trash2Icon data-icon="inline-start" /> Delete draft
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">For freight, duty or other bills that arrive after the goods were received. The charges are spread over the chosen receipts&apos; lines: the share for stock still on hand raises its cost, the share for stock already sold is expensed.</p>
      <Card>
        <CardHeader><CardTitle>Bill</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Billed by" error={supplierError} hint="The charges become payable to this supplier.">
            <Controller control={form.control} name="charge_supplier_id" render={({ field }) => <SupplierSelect value={field.value || null} onChange={field.onChange} invalid={!!supplierError} />} />
          </FormField>
          <FormField label="Voucher date" error={errors.voucher_date?.message}><Input type="date" {...form.register('voucher_date')} /></FormField>
          <FormField label="Supplier bill no." error={errors.reference?.message}><Input maxLength={64} {...form.register('reference')} /></FormField>
          <FormField label="Notes" error={errors.notes?.message}><Textarea rows={1} {...form.register('notes')} /></FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
          <CardDescription>Tax on a charge is recoverable and not added to stock cost.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChargesEditor control={form.control} register={form.register} errors={errors} />
          <p className="text-sm">
            Charges <span className="font-mono">{formatMoney(chargesTotal, currency)}</span> + tax <span className="font-mono">{formatMoney(taxTotal)}</span> = payable{' '}
            <span className="font-mono font-semibold" data-testid="voucher-payable">{formatMoney(sumMoney([chargesTotal, taxTotal]), currency)}</span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
          <CardDescription>Posted goods receipts of one branch that the charges belong to.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Controller control={form.control} name="receipts" render={({ field }) => <ReceiptPicker selected={field.value as PickedReceipt[]} onChange={(v) => { field.onChange(v); form.clearErrors('receipts') }} invalid={!!errors.receipts} />} />
          {errors.receipts?.message && <p role="alert" className="text-sm text-destructive">{errors.receipts.message}</p>}
        </CardContent>
      </Card>
      <section aria-labelledby="voucher-preview-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="voucher-preview-heading" className="text-lg font-semibold">Allocation preview</h2>
          {preview.isFetching && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Updating preview" />}
        </div>
        {!candidate ? (
          <p className="text-sm text-muted-foreground">Complete the supplier, charges and receipts to see how the charges are allocated.</p>
        ) : preview.error ? (
          <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
        ) : preview.data ? (
          <VoucherAllocationTable lines={preview.data.allocations} currency={currency} label="Allocation preview" />
        ) : (
          <p className="text-sm text-muted-foreground">Calculating…</p>
        )}
      </section>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="outline" disabled={busy}>
          {save.isPending && !post.isPending && confirm === null && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save draft
        </Button>
        <Button type="button" disabled={busy} onClick={askPost}><SendIcon data-icon="inline-start" /> Save & post</Button>
      </div>
      <ConfirmDialog
        open={confirm === 'post'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Post the landed cost voucher?"
        description={
          <>
            {previewTotals ? (
              <>
                <span className="font-mono">{formatMoney(previewTotals.onHand, currency)}</span> is added to the value of stock on hand and{' '}
                <span className="font-mono">{formatMoney(previewTotals.sold, currency)}</span> is expensed as landed cost on stock already sold or used.{' '}
              </>
            ) : (
              'The charges are added to the stock still on hand and the rest is expensed. '
            )}
            The supplier is owed <span className="font-mono">{formatMoney(sumMoney([chargesTotal, taxTotal]), currency)}</span>. A posted voucher cannot be changed.
          </>
        }
        confirmLabel="Post voucher"
        destructive={false}
        pending={busy}
        onConfirm={() => pendingValues && persist(pendingValues, true)}
      />
      {voucher && (
        <ConfirmDialog
          open={confirm === 'delete'}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`Delete ${voucher.number}?`}
          description="The draft is removed. Nothing was posted from it."
          confirmLabel="Delete draft"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(voucher.id, {
              onSuccess: () => { toast.success(`${voucher.number} deleted.`); navigate('/purchasing/landed-costs', { replace: true }) },
              onError: (e) => toast.error(e.message),
              onSettled: () => setConfirm(null),
            })
          }
        />
      )}
    </form>
  )
}
