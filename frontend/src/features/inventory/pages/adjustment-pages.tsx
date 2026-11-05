import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
import { REASON_LABELS, useAdjustmentsQuery, usePostAdjustmentMutation, type AdjustmentReason } from '@/features/inventory/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { linesSchema, toApiLine } from '@/features/inventory/lines'
import { handleFormError } from '@/lib/forms'

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
                    <TableCell className="font-mono text-sm">{a.number}</TableCell>
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
const LINE_OPTIONS = { signed: true, cost: 'optional', batch: 'signed' } as const

const schema = z.object({
  store_id: z.string({ error: 'Choose a store.' }).min(1, 'Choose a store.'),
  reason: z.enum(REASONS as [AdjustmentReason, ...AdjustmentReason[]]),
  note: z.string().max(1000),
  lines: linesSchema(LINE_OPTIONS),
})
type Values = z.infer<typeof schema>

export function NewAdjustmentPage() {
  const navigate = useNavigate()
  const post = usePostAdjustmentMutation()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { store_id: '', reason: 'opening', note: '', lines: [emptyLine()] },
  })
  const { errors } = form.formState
  const [storeId, reason] = useWatch({ control: form.control, name: ['store_id', 'reason'] })

  const onSubmit = form.handleSubmit((values) =>
    post.mutate(
      { store_id: values.store_id, reason: values.reason, note: values.note.trim() || null, lines: values.lines.map((l) => toApiLine(l, LINE_OPTIONS)) },
      {
        onSuccess: (adjustment) => {
          toast.success(`Adjustment ${adjustment.number} posted.`)
          navigate('/inventory/adjustments')
        },
        onError: (error) => handleFormError(error, form.setError, ['store_id', 'reason', 'note', 'lines'], { nested: true }),
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
          <FormField label="Reason" error={errors.reason?.message} hint={reason === 'opening' ? 'Opening stock lines must be positive.' : ['damage', 'expiry', 'theft'].includes(reason) ? 'This reason only removes stock: use negative quantities.' : 'Positive adds stock, negative removes it.'}>
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
          <LinesEditor control={form.control} register={form.register} setValue={form.setValue} errors={errors} config={{ ...LINE_OPTIONS, storeId, stockedOnly: true }} />
          <p className="mt-2 text-xs text-muted-foreground">Leave unit cost empty to use the product's purchase price. Removals always leave at the current average cost.</p>
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
