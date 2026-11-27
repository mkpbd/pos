import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { emptyLine } from '@/components/common/line-values'
import { LinesEditor } from '@/components/common/lines-editor'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { REASON_LABELS, useAdjustmentQuery, useAdjustmentsQuery, usePostAdjustmentMutation, variantLabel, type Adjustment, type AdjustmentReason } from '@/features/inventory/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { handleLinesError, linesSchema, toApiLine, toCountApiLine } from '@/features/inventory/lines'
import { formatMoney, trimDecimal } from '@/lib/money'

export function AdjustmentsPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const { data, error, isPending, refetch } = useAdjustmentsQuery({ page })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Stock adjustments: opening stock, counts, damage and other corrections."
        actions={
          <>
            <ExportMenu list="adjustments" disabled={!data?.items.length} />
            {can('inventory.adjust') && <Button asChild><Link to="/inventory/adjustments/new"><PlusIcon data-icon="inline-start" /> New adjustment</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
      {isPending ? (
        <LoadingState rows={5} label="Loading adjustments" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No adjustments yet" description="Start by posting your opening stock." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="hidden md:table-cell">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">
                      <Link to={`/inventory/adjustments/${a.id}`} className="underline-offset-4 hover:underline">{a.number}</Link>
                    </TableCell>
                    <TableCell><Badge variant="outline">{REASON_LABELS[a.reason]}</Badge></TableCell>
                    <TableCell className="text-sm">{a.store?.name}</TableCell>
                    <TableCell className="text-right">{a.lines_count}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{new Date(a.created_at).toLocaleString()}</TableCell>
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

const REASONS = Object.keys(REASON_LABELS) as AdjustmentReason[]
const LINE_OPTIONS = { signed: true, cost: 'optional', batch: 'signed', serials: 'signed' } as const
/** Reason "Stock count" (Q1 §1): lines carry the counted quantity; the server posts the difference. */
const COUNT_OPTIONS = { count: true, cost: 'optional', batch: 'out' } as const

const header = {
  store_id: z.string({ error: 'Choose a store.' }).min(1, 'Choose a store.'),
  reason: z.enum(REASONS as [AdjustmentReason, ...AdjustmentReason[]]),
  note: z.string().max(1000),
}
const schema = z.object({ ...header, lines: linesSchema(LINE_OPTIONS) })
const countSchema = z.object({ ...header, lines: linesSchema(COUNT_OPTIONS) })
type Values = z.infer<typeof schema>

const signedResolver = zodResolver(schema)
const countResolver = zodResolver(countSchema)

function reasonHint(reason: AdjustmentReason): string {
  if (reason === 'count') return 'Enter what you counted on the shelf. The system works out the difference and checks the stock again when you post.'
  if (reason === 'opening') return 'Opening stock lines must be positive.'
  if (['damage', 'expiry', 'theft'].includes(reason)) return 'This reason only removes stock: use negative quantities.'
  return 'Positive adds stock, negative removes it.'
}

export function NewAdjustmentPage() {
  const navigate = useNavigate()
  const post = usePostAdjustmentMutation()
  const form = useForm<Values>({
    resolver: (values, context, options) => (values.reason === 'count' ? countResolver : signedResolver)(values, context, options),
    defaultValues: { store_id: '', reason: 'opening', note: '', lines: [emptyLine()] },
  })
  const { errors } = form.formState
  const [storeId, reason] = useWatch({ control: form.control, name: ['store_id', 'reason'] })
  const counting = reason === 'count'

  const onSubmit = form.handleSubmit((values) =>
    post.mutate(
      { store_id: values.store_id, reason: values.reason, note: values.note.trim() || null, lines: values.lines.map((l) => (values.reason === 'count' ? toCountApiLine(l, COUNT_OPTIONS) : toApiLine(l, LINE_OPTIONS))) },
      {
        onSuccess: (adjustment) => {
          toast.success(`Adjustment ${adjustment.number} posted.`)
          navigate(values.reason === 'count' ? `/inventory/adjustments/${adjustment.id}` : '/inventory/adjustments')
        },
        onError: (error) => handleLinesError(error, form.setError, ['store_id', 'reason', 'note', 'lines'], values.lines),
      },
    ),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to adjustments"><Link to="/inventory/adjustments"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">New stock adjustment</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="Store" error={errors.store_id?.message}>
            <Controller control={form.control} name="store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.store_id} />} />
          </FormField>
          <FormField label="Reason" error={errors.reason?.message} hint={reasonHint(reason)}>
            <Controller control={form.control} name="reason" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full" aria-label="Reason"><SelectValue /></SelectTrigger>
                <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Note" error={errors.note?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('note')} /></FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent>
          <LinesEditor control={form.control} register={form.register} setValue={form.setValue} errors={errors} config={{ ...(counting ? COUNT_OPTIONS : LINE_OPTIONS), storeId, stockedOnly: true }} />
          <p className="mt-2 text-xs text-muted-foreground">
            {counting
              ? 'Lines that match the stock are skipped. The unit cost is used only when the count is higher than the stock; leave it empty to use the purchase price.'
              : "Leave unit cost empty to use the product's purchase price. Removals always leave at the current average cost."}
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => navigate('/inventory/adjustments')}>Cancel</Button>
        <Button type="submit" disabled={post.isPending}>
          {post.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Post adjustment
        </Button>
      </div>
    </form>
  )
}

/** /inventory/adjustments/:adjustmentId — the posted lines; stock counts show counted vs system. */
export function AdjustmentPage() {
  const { adjustmentId } = useParams()
  const { data, error, isPending, refetch } = useAdjustmentQuery(adjustmentId)

  if (isPending) return <LoadingState rows={5} label="Loading adjustment" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return <AdjustmentView adjustment={data} />
}

function AdjustmentView({ adjustment }: { adjustment: Adjustment }) {
  const lines = adjustment.lines ?? []
  const counted = lines.some((l) => l.counted_quantity != null)
  const withCost = lines.some((l) => l.unit_cost !== null)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to adjustments"><Link to="/inventory/adjustments"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Adjustment {adjustment.number}</h1>
        <Badge variant="outline">{REASON_LABELS[adjustment.reason]}</Badge>
      </div>
      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Store</dt><dd>{adjustment.store?.name ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Posted</dt><dd>{new Date(adjustment.created_at).toLocaleString()}</dd></div>
            {adjustment.note && <div className="sm:col-span-3"><dt className="text-muted-foreground">Note</dt><dd className="whitespace-pre-line">{adjustment.note}</dd></div>}
          </dl>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Adjustment lines">
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="hidden sm:table-cell">Batch</TableHead>
              {counted && <TableHead className="text-right">Counted</TableHead>}
              {counted && <TableHead className="text-right">System</TableHead>}
              <TableHead className="text-right">{counted ? 'Difference' : 'Change'}</TableHead>
              {withCost && <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const negative = l.quantity.trim().startsWith('-')
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{variantLabel(l.variant)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{l.variant?.sku}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{l.batch ? `${l.batch.batch_number}${l.batch.expires_on ? ` · exp ${l.batch.expires_on}` : ''}` : '—'}</TableCell>
                  {counted && <TableCell className="text-right font-mono">{l.counted_quantity != null ? trimDecimal(l.counted_quantity) : '—'}</TableCell>}
                  {counted && <TableCell className="text-right font-mono">{l.system_quantity != null ? trimDecimal(l.system_quantity) : '—'}</TableCell>}
                  <TableCell className={negative ? 'text-right font-mono text-destructive-soft-foreground' : 'text-right font-mono text-success-soft-foreground'}>
                    {negative ? '−' : '+'}{trimDecimal(l.quantity.replace('-', ''))} {l.variant?.unit_code}
                  </TableCell>
                  {withCost && <TableCell className="hidden text-right font-mono md:table-cell">{l.unit_cost !== null ? formatMoney(l.unit_cost, undefined, 4) : '—'}</TableCell>}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {counted && <p className="text-xs text-muted-foreground">System = the stock the count was compared with when it was posted. Lines that matched the stock were skipped.</p>}
    </div>
  )
}
