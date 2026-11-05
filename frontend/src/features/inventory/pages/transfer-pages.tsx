import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, ArrowRightIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
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
import { useCompleteTransferMutation, useDispatchTransferMutation, useTransfersQuery, type Transfer, type TransferStatus } from '@/features/inventory/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { linesSchema, toApiLine } from '@/features/inventory/lines'
import { handleFormError } from '@/lib/forms'

const STATUS: Record<TransferStatus, { label: string; variant: 'info' | 'success' | 'destructive' }> = {
  in_transit: { label: 'In transit', variant: 'info' },
  received: { label: 'Received', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

export function TransfersPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<TransferStatus | 'all'>('all')
  const [confirm, setConfirm] = useState<{ transfer: Transfer; action: 'receive' | 'cancel' } | null>(null)
  const complete = useCompleteTransferMutation()
  const filters = { status: status === 'all' ? undefined : status }
  const { data, error, isPending, refetch } = useTransfersQuery({ page, ...filters })
  const canTransfer = can('inventory.transfer')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Stock moving between stores and branches."
        actions={
          <>
            <ExportMenu list="transfers" query={filters} disabled={!data?.items.length} />
            {canTransfer && <Button asChild><Link to="/inventory/transfers/new"><PlusIcon data-icon="inline-start" /> New transfer</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
      <Select value={status} onValueChange={(v) => { setStatus(v as TransferStatus | 'all'); setPage(1) }}>
        <SelectTrigger className="w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All transfers</SelectItem>
          <SelectItem value="in_transit">In transit</SelectItem>
          <SelectItem value="received">Received</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      {isPending ? (
        <LoadingState rows={5} label="Loading transfers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No transfers" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Dispatched</TableHead>
                  <TableHead className="w-48"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-sm">{t.number}<div className="text-xs text-muted-foreground">{t.lines_count} lines</div></TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1">{t.from_store?.name} <ArrowRightIcon className="size-3" aria-label="to" /> {t.to_store?.name}</span>
                      <div className="text-xs text-muted-foreground">{t.from_store?.branch_name} → {t.to_store?.branch_name}</div>
                    </TableCell>
                    <TableCell><Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{new Date(t.dispatched_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {canTransfer && t.can_receive && <Button size="sm" onClick={() => setConfirm({ transfer: t, action: 'receive' })}>Receive</Button>}
                      {canTransfer && t.can_cancel && <Button size="sm" variant="ghost" onClick={() => setConfirm({ transfer: t, action: 'cancel' })}>Cancel</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.action === 'receive' ? `Receive ${confirm.transfer.number}?` : `Cancel ${confirm?.transfer.number}?`}
        description={confirm?.action === 'receive' ? `The goods are added to ${confirm.transfer.to_store?.name}.` : `The goods go back into ${confirm?.transfer.from_store?.name}.`}
        confirmLabel={confirm?.action === 'receive' ? 'Receive goods' : 'Cancel transfer'}
        destructive={confirm?.action === 'cancel'}
        pending={complete.isPending}
        onConfirm={() =>
          confirm &&
          complete.mutate({ id: confirm.transfer.id, action: confirm.action }, {
            onSuccess: (t) => toast.success(`${t.number} ${t.status === 'received' ? 'received' : 'cancelled'}.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setConfirm(null),
          })
        }
      />
    </div>
  )
}

const LINE_OPTIONS = { batch: 'out' } as const
const schema = z
  .object({
    from_store_id: z.string().min(1, 'Choose the source store.'),
    to_store_id: z.string().min(1, 'Choose the destination store.'),
    note: z.string().max(1000),
    lines: linesSchema(LINE_OPTIONS),
  })
  .refine((v) => v.from_store_id !== v.to_store_id, { path: ['to_store_id'], message: 'Choose a different store.' })
type Values = z.infer<typeof schema>

export function NewTransferPage() {
  const navigate = useNavigate()
  const dispatch = useDispatchTransferMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { from_store_id: '', to_store_id: '', note: '', lines: [emptyLine()] } })
  const { errors } = form.formState
  const fromStore = useWatch({ control: form.control, name: 'from_store_id' })

  const onSubmit = form.handleSubmit((values) =>
    dispatch.mutate(
      { from_store_id: values.from_store_id, to_store_id: values.to_store_id, note: values.note.trim() || null, lines: values.lines.map((l) => toApiLine(l, LINE_OPTIONS)) },
      {
        onSuccess: (t) => {
          toast.success(`Transfer ${t.number} dispatched.`)
          navigate('/inventory/transfers')
        },
        onError: (error) => handleFormError(error, form.setError, ['from_store_id', 'to_store_id', 'note', 'lines'], { nested: true }),
      },
    ),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to transfers"><Link to="/inventory/transfers"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">New stock transfer</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Route</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="From store" error={errors.from_store_id?.message}>
            <Controller control={form.control} name="from_store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} aria-label="From store" invalid={!!errors.from_store_id} />} />
          </FormField>
          <FormField label="To store" error={errors.to_store_id?.message} hint="Any active store, including other branches.">
            <Controller control={form.control} name="to_store_id" render={({ field }) => <StoreSelect value={field.value || null} onChange={field.onChange} exclude={fromStore || null} aria-label="To store" invalid={!!errors.to_store_id} />} />
          </FormField>
          <FormField label="Note" error={errors.note?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('note')} /></FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Goods</CardTitle></CardHeader>
        <CardContent>
          <LinesEditor control={form.control} register={form.register} setValue={form.setValue} errors={errors} config={{ ...LINE_OPTIONS, storeId: fromStore || null, stockedOnly: true }} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => navigate('/inventory/transfers')}>Cancel</Button>
        <Button type="submit" disabled={dispatch.isPending}>
          {dispatch.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Dispatch
        </Button>
      </div>
    </form>
  )
}
