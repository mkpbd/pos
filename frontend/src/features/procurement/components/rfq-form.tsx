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
import { VariantPicker } from '@/components/common/variant-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useIdempotencyKey } from '@/features/returns/api'
import { useRfqActionMutation, useSaveRfqMutation, type Rfq } from '@/features/procurement/api'
import { SupplierChecklist } from '@/features/procurement/components/supplier-pickers'
import { handleFormError } from '@/lib/forms'
import { trimDecimal } from '@/lib/money'

const QUANTITY = /^\d{1,15}(\.\d{1,3})?$/

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

const schema = z.object({
  title: z.string().trim().min(1, 'Give the RFQ a title.').max(150, 'At most 150 characters.'),
  store_id: z.string().min(1, 'Choose the delivery store.'),
  needed_by: z.string(),
  reply_by: z.string(),
  notes: z.string().max(2000, 'At most 2000 characters.'),
  suppliers: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().optional(), email: z.string().nullable().optional() })),
  lines: z
    .array(z.object({ variant: variantShape.nullable(), quantity: z.string(), requisition_line_id: z.string().nullable() }))
    .min(1, 'Add at least one line.')
    .superRefine((lines, ctx) => {
      const seen = new Set<string>()
      lines.forEach((line, i) => {
        const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [i, path], message })
        const q = line.quantity.trim()
        if (!line.variant) issue('variant', 'Choose a product.')
        else if (seen.has(line.variant.id)) issue('variant', 'This product is already on the RFQ.')
        if (line.variant) seen.add(line.variant.id)
        if (!QUANTITY.test(q) || /^0+(\.0+)?$/.test(q)) issue('quantity', 'A positive quantity (up to 3 decimals).')
        else if (line.variant && !line.variant.allow_decimal && q.includes('.') && !/\.0+$/.test(q)) issue('quantity', `Whole ${line.variant.unit_code ?? 'units'} only.`)
      })
    }),
})

type Values = z.infer<typeof schema>

const emptyLine = (): Values['lines'][number] => ({ variant: null, quantity: '', requisition_line_id: null })

function defaults(rfq?: Rfq): Values {
  if (!rfq) return { title: '', store_id: '', needed_by: '', reply_by: '', notes: '', suppliers: [], lines: [emptyLine()] }
  return {
    title: rfq.title,
    store_id: rfq.store?.id ?? '',
    needed_by: rfq.needed_by ?? '',
    reply_by: rfq.reply_by ?? '',
    notes: rfq.notes ?? '',
    suppliers: (rfq.suppliers ?? []).map((s) => ({ id: s.supplier.id, name: s.supplier.name, code: s.supplier.code, email: s.supplier.email ?? null })),
    lines: (rfq.lines ?? []).map((l) => ({
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
      requisition_line_id: l.requisition_line_id,
    })),
  }
}

function lineError(errors: unknown, index: number, field: string): string | undefined {
  return (errors as Record<number, Record<string, { message?: string }>> | undefined)?.[index]?.[field]?.message
}

/** Create or edit a draft RFQ: lines, suppliers to invite; "Save & send" sends it. */
export function RfqForm({ rfq }: { rfq?: Rfq }) {
  const navigate = useNavigate()
  const save = useSaveRfqMutation()
  const action = useRfqActionMutation()
  const sendKey = useIdempotencyKey()
  const cancelKey = useIdempotencyKey()
  const [confirm, setConfirm] = useState<'send' | 'cancel' | null>(null)
  const [pendingValues, setPendingValues] = useState<Values | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(rfq) })
  const { errors } = form.formState
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' })
  const lines = useWatch({ control: form.control, name: 'lines' })
  const suppliers = useWatch({ control: form.control, name: 'suppliers' })
  const fromRequisition = !!rfq?.requisition

  const persist = (values: Values, andSend: boolean) => {
    const input = {
      title: values.title.trim(),
      store_id: values.store_id,
      needed_by: values.needed_by || null,
      reply_by: values.reply_by || null,
      notes: values.notes.trim() || null,
      supplier_ids: values.suppliers.map((s) => s.id),
      // Lines of an RFQ raised from a requisition are fixed (they hold its quantities).
      ...(fromRequisition ? {} : { lines: values.lines.map((l) => ({ variant_id: l.variant?.id ?? '', quantity: l.quantity.trim() })) }),
    }
    save.mutate({ id: rfq?.id, input }, {
      onSuccess: (saved) => {
        const done = () => navigate(`/purchasing/rfqs/${saved.id}`, { replace: true })
        if (!andSend) {
          toast.success(`${saved.number} saved as draft.`)
          return done()
        }
        const payload = { id: saved.id, action: 'send' as const }
        action.mutate({ ...payload, idempotencyKey: sendKey.keyFor(payload) }, {
          onSuccess: (sent) => {
            sendKey.settle()
            const emailed = (sent.suppliers ?? []).filter((s) => s.emailed_at).length
            toast.success(`${sent.number} sent${emailed ? ` — e-mailed to ${emailed} ${emailed === 1 ? 'supplier' : 'suppliers'}` : ''}.`)
            done()
          },
          onError: (e) => {
            sendKey.settle(e)
            toast.error(e.message)
            done()
          },
          onSettled: () => setConfirm(null),
        })
      },
      onError: (error) => {
        setConfirm(null)
        handleFormError(error, form.setError, ['title', 'store_id', 'needed_by', 'reply_by', 'notes', 'suppliers', 'lines'], { nested: true })
      },
    })
  }

  const askSend = form.handleSubmit((values) => {
    let blocked = false
    if (!values.reply_by) {
      form.setError('reply_by', { type: 'manual', message: 'Set a reply-by date before sending.' })
      blocked = true
    }
    if (values.suppliers.length < 2) {
      form.setError('suppliers', { type: 'manual', message: 'Invite at least 2 suppliers to compare quotes.' })
      blocked = true
    }
    if (blocked) return
    setPendingValues(values)
    setConfirm('send')
  })

  const busy = save.isPending || action.isPending

  return (
    <form onSubmit={form.handleSubmit((v) => persist(v, false))} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to RFQs"><Link to="/purchasing/rfqs"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{rfq ? `Edit ${rfq.number}` : 'New request for quotation'}</h1>
        {rfq && <Badge variant="outline">Draft</Badge>}
        {rfq && (
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirm('cancel')}>
            <XCircleIcon data-icon="inline-start" /> Cancel RFQ
          </Button>
        )}
      </div>
      {rfq?.requisition && (
        <p className="text-sm text-muted-foreground">
          From requisition <Link to={`/purchasing/requisitions/${rfq.requisition.id}`} className="font-mono text-foreground underline-offset-4 hover:underline">{rfq.requisition.number}</Link> — awarded orders are pre-approved within its approved amount.
        </p>
      )}
      <Card>
        <CardHeader><CardTitle>Request</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Title" error={errors.title?.message} className="sm:col-span-2"><Input maxLength={150} {...form.register('title')} /></FormField>
          <FormField label="Deliver to store" error={errors.store_id?.message}>
            <Controller control={form.control} name="store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.store_id} aria-label="Deliver to store" />} />
          </FormField>
          <FormField label="Needed by" error={errors.needed_by?.message}><Input type="date" {...form.register('needed_by')} /></FormField>
          <FormField label="Reply by" error={errors.reply_by?.message} hint="Suppliers are asked to quote by this date."><Input type="date" {...form.register('reply_by')} /></FormField>
          <FormField label="Notes for suppliers" error={errors.notes?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('notes')} /></FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items</CardTitle><CardDescription>No prices — suppliers quote them.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2" aria-label="RFQ lines">
            {fields.map((field, i) => {
              const line = lines?.[i]
              const err = (f: string) => lineError(errors.lines, i, f)
              const fixed = fromRequisition
              return (
                <li key={field.id} className="grid gap-2 sm:grid-cols-[1fr_8rem_2.5rem] sm:items-start">
                  <div>
                    {fixed ? (
                      <div className="py-1.5">
                        <div className="font-medium">{line?.variant?.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{line?.variant?.sku}</div>
                      </div>
                    ) : (
                      <Controller control={form.control} name={`lines.${i}.variant`} render={({ field: f }) => <VariantPicker value={f.value} onChange={f.onChange} invalid={!!err('variant')} aria-label={`Product of line ${i + 1}`} />} />
                    )}
                    {err('variant') && <p className="mt-1 text-xs text-destructive">{err('variant')}</p>}
                  </div>
                  <div>
                    <Input aria-label={`Quantity of line ${i + 1}`} inputMode="decimal" placeholder="Qty" readOnly={fixed} aria-invalid={!!err('quantity') || undefined} {...form.register(`lines.${i}.quantity`)} />
                    {err('quantity') && <p className="mt-1 text-xs text-destructive">{err('quantity')}</p>}
                  </div>
                  {!fixed && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2Icon /></Button>}
                </li>
              )
            })}
          </ul>
          {typeof (errors.lines as { message?: string } | undefined)?.message === 'string' && <p className="text-sm text-destructive">{(errors.lines as { message?: string }).message}</p>}
          {fromRequisition ? (
            <p className="text-xs text-muted-foreground">Lines come from the requisition and cannot be changed here.</p>
          ) : (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append(emptyLine())}><PlusIcon data-icon="inline-start" /> Add line</Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Suppliers</CardTitle>
          <CardDescription>Suppliers with an e-mail address get the RFQ PDF by e-mail when you send; send it to the others yourself.</CardDescription>
        </CardHeader>
        <CardContent>
          <Controller control={form.control} name="suppliers" render={({ field }) => <SupplierChecklist selected={field.value} onChange={(v) => { field.onChange(v); form.clearErrors('suppliers') }} />} />
          {errors.suppliers?.message && <p role="alert" className="mt-2 text-sm text-destructive">{errors.suppliers.message}</p>}
        </CardContent>
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="outline" disabled={busy}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save draft
        </Button>
        <Button type="button" disabled={busy} onClick={askSend}><SendIcon data-icon="inline-start" /> Save & send</Button>
      </div>
      <ConfirmDialog
        open={confirm === 'send'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Send the RFQ?"
        description={`${(suppliers ?? []).filter((s) => s.email).length} of ${(suppliers ?? []).length} invited suppliers are e-mailed the PDF; download it for the others. The RFQ can no longer be edited.`}
        confirmLabel="Send RFQ"
        destructive={false}
        pending={busy}
        onConfirm={() => pendingValues && persist(pendingValues, true)}
      />
      {rfq && (
        <ConfirmDialog
          open={confirm === 'cancel'}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`Cancel ${rfq.number}?`}
          description="The draft is closed and cannot be sent."
          confirmLabel="Cancel RFQ"
          pending={action.isPending}
          onConfirm={() => {
            const payload = { id: rfq.id, action: 'cancel' as const }
            action.mutate({ ...payload, idempotencyKey: cancelKey.keyFor(payload) }, {
              onSuccess: () => { cancelKey.settle(); toast.success(`${rfq.number} cancelled.`); navigate('/purchasing/rfqs') },
              onError: (e) => { cancelKey.settle(e); toast.error(e.message) },
              onSettled: () => setConfirm(null),
            })
          }}
        />
      )}
    </form>
  )
}
