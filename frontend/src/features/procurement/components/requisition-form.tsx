import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon, PlusIcon, SendIcon, Trash2Icon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { StoreSelect } from '@/components/common/store-select'
import type { VariantOption } from '@/components/common/variant-options'
import { VariantPicker } from '@/components/common/variant-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useIdempotencyKey } from '@/features/returns/api'
import { lineEstimate, sumAmounts } from '@/features/supply-chain/quantities'
import {
  fetchCostEstimates,
  useRequisitionActionMutation,
  useSaveRequisitionMutation,
  type Requisition,
} from '@/features/procurement/api'
import { costSourceLabel, mayCancelRequisition } from '@/features/procurement/procurement'
import { OptionalSupplierSelect } from '@/features/procurement/components/supplier-pickers'
import { handleFormError } from '@/lib/forms'
import { decimalPattern, formatMoney, trimDecimal } from '@/lib/money'

const QUANTITY = /^\d{1,15}(\.\d{1,3})?$/
const COST = decimalPattern(4)

const variantShape = z.object({
  id: z.string(),
  label: z.string(),
  sku: z.string(),
  unit_code: z.string().nullable(),
  allow_decimal: z.boolean(),
  track_stock: z.boolean(),
  track_batches: z.boolean(),
  purchase_price: z.string().optional(),
  tax_rate: z.string().nullable(),
})

const lineShape = z.object({
  variant: variantShape.nullable(),
  quantity: z.string(),
  estimated_unit_cost: z.string(),
  supplier: z.object({ id: z.string(), name: z.string(), code: z.string().optional(), email: z.string().nullable().optional() }).nullable(),
  notes: z.string(),
  /** Where the cost came from (shown as a hint). */
  cost_source: z.string().optional(),
})

const schema = z.object({
  store_id: z.string().min(1, 'Choose the store that needs the goods.'),
  needed_by: z.string(),
  notes: z.string().max(1000, 'At most 1000 characters.'),
  lines: z
    .array(lineShape)
    .min(1, 'Add at least one line.')
    .superRefine((lines, ctx) => {
      const seen = new Set<string>()
      lines.forEach((line, i) => {
        const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [i, path], message })
        const q = line.quantity.trim()
        if (!line.variant) issue('variant', 'Choose a product.')
        else if (seen.has(line.variant.id)) issue('variant', 'This product is already on the requisition.')
        if (line.variant) seen.add(line.variant.id)
        if (!QUANTITY.test(q)) issue('quantity', 'A positive quantity (up to 3 decimals).')
        else if (/^0+(\.0+)?$/.test(q)) issue('quantity', 'Must not be zero.')
        else if (line.variant && !line.variant.allow_decimal && q.includes('.') && !/\.0+$/.test(q)) issue('quantity', `Whole ${line.variant.unit_code ?? 'units'} only.`)
        const cost = line.estimated_unit_cost.trim()
        if (cost !== '' && !COST.test(cost)) issue('estimated_unit_cost', 'Cost with up to 4 decimals.')
        if (line.notes.length > 255) issue('notes', 'At most 255 characters.')
      })
    }),
})

type Values = z.infer<typeof schema>
type LineValues = Values['lines'][number]

const emptyLine = (): LineValues => ({ variant: null, quantity: '', estimated_unit_cost: '', supplier: null, notes: '' })

function toFormLines(req: Requisition): LineValues[] {
  return (req.lines ?? []).map((l) => ({
    variant: l.variant && {
      id: l.variant.id,
      label: l.variant.variant_name ? `${l.variant.product_name} — ${l.variant.variant_name}` : l.variant.product_name,
      sku: l.variant.sku,
      unit_code: l.variant.unit_code ?? l.variant.unit ?? null,
      allow_decimal: l.variant.allow_decimal ?? false,
      track_stock: true,
      track_batches: false,
      tax_rate: null,
    },
    quantity: trimDecimal(l.quantity),
    estimated_unit_cost: l.estimated_unit_cost ? trimDecimal(l.estimated_unit_cost) : '',
    supplier: l.suggested_supplier ? { id: l.suggested_supplier.id, name: l.suggested_supplier.name } : null,
    notes: l.notes ?? '',
  }))
}

function lineError(errors: unknown, index: number, field: string): string | undefined {
  return (errors as Record<number, Record<string, { message?: string }>> | undefined)?.[index]?.[field]?.message
}

/** Create or edit a draft requisition; "Save & submit" sends it for approval. */
export function RequisitionForm({ requisition }: { requisition?: Requisition }) {
  const navigate = useNavigate()
  const me = useAuth()
  const can = useCan()
  const currency = requisition?.currency ?? me.organization?.base_currency
  const canPickSupplier = can('suppliers.view')
  const save = useSaveRequisitionMutation()
  const action = useRequisitionActionMutation()
  const submitKey = useIdempotencyKey()
  const cancelKey = useIdempotencyKey()
  const [confirmCancel, setConfirmCancel] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: requisition
      ? { store_id: requisition.store?.id ?? '', needed_by: requisition.needed_by ?? '', notes: requisition.notes ?? '', lines: toFormLines(requisition) }
      : { store_id: '', needed_by: '', notes: '', lines: [emptyLine()] },
  })
  const { errors } = form.formState
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' })
  const lines = useWatch({ control: form.control, name: 'lines' })
  const estimate = sumAmounts((lines ?? []).map((l) => lineEstimate(l.quantity, l.estimated_unit_cost)))

  /** Catalog cost (and the preferred supplier) of a newly picked product; the user can overwrite both. */
  const prefill = async (index: number, option: VariantOption) => {
    const supplier = form.getValues(`lines.${index}.supplier`)
    let estimate
    try {
      estimate = (await fetchCostEstimates([option.id], supplier?.id ?? null)).find((e) => e.variant_id === option.id)
    } catch {
      estimate = undefined
    }
    const current = form.getValues(`lines.${index}`)
    if (!estimate || current?.variant?.id !== option.id) return
    if (!current.estimated_unit_cost) form.setValue(`lines.${index}.estimated_unit_cost`, trimDecimal(estimate.estimated_unit_cost))
    if (!current.supplier && estimate.preferred_supplier) form.setValue(`lines.${index}.supplier`, { id: estimate.preferred_supplier.id, name: estimate.preferred_supplier.name })
    form.setValue(`lines.${index}.cost_source`, costSourceLabel(estimate, current.supplier?.name))
  }

  const submit = (andSubmit: boolean) =>
    form.handleSubmit((values) => {
      const input = {
        store_id: values.store_id,
        needed_by: values.needed_by || null,
        notes: values.notes.trim() || null,
        lines: values.lines.map((l) => ({
          variant_id: l.variant?.id ?? '',
          quantity: l.quantity.trim(),
          estimated_unit_cost: l.estimated_unit_cost.trim() || null,
          suggested_supplier_id: l.supplier?.id ?? null,
          notes: l.notes.trim() || null,
        })),
      }
      save.mutate({ id: requisition?.id, input }, {
        onSuccess: (saved) => {
          const done = () => navigate(`/purchasing/requisitions/${saved.id}`, { replace: true })
          if (!andSubmit) {
            toast.success(`${saved.number} saved as draft.`)
            return done()
          }
          const payload = { id: saved.id, action: 'submit' as const }
          action.mutate({ ...payload, idempotencyKey: submitKey.keyFor(payload) }, {
            onSuccess: (r) => {
              submitKey.settle()
              toast.success(r.status === 'approved' ? `${r.number} approved automatically (within the auto-approve limit).` : `${r.number} submitted for approval.`)
              done()
            },
            onError: (e) => {
              submitKey.settle(e)
              toast.error(e.message)
              done()
            },
          })
        },
        onError: (error) => handleFormError(error, form.setError, ['store_id', 'needed_by', 'notes', 'lines'], { nested: true }),
      })
    })

  const busy = save.isPending || action.isPending

  return (
    <form onSubmit={submit(false)} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to requisitions"><Link to="/purchasing/requisitions"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{requisition ? `Edit ${requisition.number}` : 'New purchase requisition'}</h1>
        {requisition && <Badge variant="outline">Draft</Badge>}
        {requisition && mayCancelRequisition(requisition, me, can) && (
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirmCancel(true)}>
            <XCircleIcon data-icon="inline-start" /> Cancel requisition
          </Button>
        )}
      </div>
      {requisition?.rejection_reason && (
        <div role="note" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Previously rejected:</span> {requisition.rejection_reason}
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>Request</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="For store" error={errors.store_id?.message}>
            <Controller control={form.control} name="store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.store_id} aria-label="For store" />} />
          </FormField>
          <FormField label="Needed by" error={errors.needed_by?.message}><Input type="date" {...form.register('needed_by')} /></FormField>
          <FormField label="Notes" error={errors.notes?.message} className="sm:col-span-2" hint="Why the goods are needed (at most 1000 characters).">
            <Textarea rows={2} {...form.register('notes')} />
          </FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3" aria-label="Requisition lines">
            {fields.map((field, i) => {
              const line = lines?.[i]
              const err = (f: string) => lineError(errors.lines, i, f)
              return (
                <li key={field.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-12" aria-label={`Line ${i + 1}`}>
                  <div className="sm:col-span-5">
                    <Controller
                      control={form.control}
                      name={`lines.${i}.variant`}
                      render={({ field: f }) => (
                        <VariantPicker
                          value={f.value}
                          invalid={!!err('variant')}
                          aria-label={`Product of line ${i + 1}`}
                          onChange={(option) => {
                            f.onChange(option)
                            void prefill(i, option)
                          }}
                        />
                      )}
                    />
                    {err('variant') && <p className="mt-1 text-xs text-destructive">{err('variant')}</p>}
                    {line?.variant && <p className="mt-1 font-mono text-xs text-muted-foreground">{line.variant.sku}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <Input aria-label={`Quantity of line ${i + 1}`} inputMode="decimal" placeholder="Qty" aria-invalid={!!err('quantity') || undefined} {...form.register(`lines.${i}.quantity`)} />
                    <p className="mt-1 text-xs text-muted-foreground">{line?.variant?.unit_code}</p>
                    {err('quantity') && <p className="text-xs text-destructive">{err('quantity')}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <Input aria-label={`Estimated unit cost of line ${i + 1}`} inputMode="decimal" placeholder="Est. cost" aria-invalid={!!err('estimated_unit_cost') || undefined} {...form.register(`lines.${i}.estimated_unit_cost`)} />
                    {err('estimated_unit_cost') ? (
                      <p className="mt-1 text-xs text-destructive">{err('estimated_unit_cost')}</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">{line?.cost_source ?? (line?.estimated_unit_cost ? '' : 'Blank: catalog cost')}</p>
                    )}
                  </div>
                  <div className="sm:col-span-3">
                    {canPickSupplier ? (
                      <Controller
                        control={form.control}
                        name={`lines.${i}.supplier`}
                        render={({ field: f }) => <OptionalSupplierSelect value={f.value?.id ?? null} current={f.value} onChange={(s) => f.onChange(s ? { id: s.id, name: s.name } : null)} label={`Suggested supplier of line ${i + 1}`} />}
                      />
                    ) : (
                      <p className="py-1.5 text-sm text-muted-foreground">{line?.supplier ? `Supplier: ${line.supplier.name}` : 'Supplier chosen by purchasing'}</p>
                    )}
                  </div>
                  <div className="sm:col-span-11">
                    <Input aria-label={`Notes of line ${i + 1}`} placeholder="Line notes (optional)" {...form.register(`lines.${i}.notes`)} />
                    {err('notes') && <p className="mt-1 text-xs text-destructive">{err('notes')}</p>}
                  </div>
                  <div className="flex justify-end sm:col-span-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}>
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          {typeof (errors.lines as { message?: string } | undefined)?.message === 'string' && <p className="text-sm text-destructive">{(errors.lines as { message?: string }).message}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => append(emptyLine())}>
              <PlusIcon data-icon="inline-start" /> Add line
            </Button>
            <p className="text-sm">
              Estimated total <span className="font-mono font-semibold" data-testid="requisition-estimate">{formatMoney(estimate, currency)}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">The server computes the binding estimate (incl. tax) when you save; it decides who has to approve.</p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="outline" disabled={busy}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save draft
        </Button>
        <Button type="button" disabled={busy} onClick={submit(true)}>
          <SendIcon data-icon="inline-start" /> Save & submit
        </Button>
      </div>
      {requisition && (
        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title={`Cancel ${requisition.number}?`}
          description="The requisition is closed and can no longer be submitted."
          confirmLabel="Cancel requisition"
          pending={action.isPending}
          onConfirm={() => {
            const payload = { id: requisition.id, action: 'cancel' as const }
            action.mutate({ ...payload, idempotencyKey: cancelKey.keyFor(payload) }, {
              onSuccess: () => { cancelKey.settle(); toast.success(`${requisition.number} cancelled.`); navigate('/purchasing/requisitions') },
              onError: (e) => { cancelKey.settle(e); toast.error(e.message) },
              onSettled: () => setConfirmCancel(false),
            })
          }}
        />
      )}
    </form>
  )
}
