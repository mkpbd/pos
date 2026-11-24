import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { formatDateTime } from '@/features/web-orders/orders'
import { normalizedMobile, useBlockedPhonesQuery, useBlockPhoneMutation, useUnblockPhoneMutation, type BlockedPhone } from '@/features/web-orders/risk'
import { fieldErrorMap } from '@/lib/forms'
import { useDebouncedValue } from '@/lib/use-debounced-value'

function AddBlockedNumberDialog({ onClose }: { onClose: () => void }) {
  const block = useBlockPhoneMutation()
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (block.isPending) return
    const normalized = normalizedMobile(phone)
    if (!normalized) {
      setErrors({ phone: 'Enter a Bangladeshi mobile number, e.g. 01712345678.' })
      return
    }
    setErrors({})
    block.mutate(
      { phone: normalized, reason: reason.trim() || null },
      {
        onSuccess: (row) => {
          toast.success(`${row?.phone ?? normalized} is blocked from cash on delivery.`)
          onClose()
        },
        onError: (err) => setErrors(fieldErrorMap(err)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !block.isPending) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block a number</DialogTitle>
          <DialogDescription>Online orders with this mobile number can no longer be paid by cash on delivery.</DialogDescription>
        </DialogHeader>
        <form id="add-blocked-number" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <FormField label="Mobile number" error={errors.phone}>
            <Input autoFocus inputMode="tel" autoComplete="off" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712345678" />
          </FormField>
          <FormField label="Reason (optional)" error={errors.reason} hint="Only staff see it.">
            <Textarea rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Refused 3 parcels" />
          </FormField>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={block.isPending}>Back</Button>
          <Button type="submit" form="add-blocked-number" disabled={block.isPending}>
            {block.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Block number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** /web-orders/blocked-numbers (BD1b) — mobile numbers that may not order with cash on delivery. */
export function BlockedNumbersPage() {
  const me = useAuth()
  const can = useCan()
  const canManage = can('web_orders.manage')
  const timeZone = me.organization?.timezone
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebouncedValue(search.trim())
  const list = useBlockedPhonesQuery({ page, ...(term ? { search: term } : {}) })
  const unblock = useUnblockPhoneMutation()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<BlockedPhone | null>(null)

  const remove = () => {
    if (!removing) return
    const row = removing
    unblock.mutate(row.id, {
      onSuccess: () => {
        toast.success(`${row.phone} can use cash on delivery again.`)
        setRemoving(null)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const rows = list.data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blocked numbers"
        description="Mobile numbers that may not order with cash on delivery on your online store and campaign pages. They can still pay in advance; orders your staff enter are not refused."
        actions={canManage ? <Button onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" /> Block a number</Button> : undefined}
      />

      <Input
        aria-label="Search blocked numbers"
        placeholder="Number or reason"
        className="w-full sm:max-w-xs"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(1)
        }}
      />

      {list.isPending ? (
        <LoadingState rows={4} label="Loading blocked numbers" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={term ? 'No blocked numbers match' : 'No blocked numbers'}
          description={term ? undefined : 'Block a number here or from an order’s delivery history when a customer keeps refusing parcels.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Blocked numbers">
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden md:table-cell">Blocked by</TableHead>
                  <TableHead className="hidden sm:table-cell">Blocked on</TableHead>
                  {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link to={`/web-orders?search=${encodeURIComponent(b.phone)}`} className="font-mono underline-offset-4 hover:underline" title="Orders with this number">{b.phone}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{b.reason || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{b.created_by?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{formatDateTime(b.created_at, timeZone)}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(b)} aria-label={`Unblock ${b.phone}`}>
                          <Trash2Icon data-icon="inline-start" /> Unblock
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={list.data.pagination} onPageChange={setPage} />
        </>
      )}

      {adding && <AddBlockedNumberDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title={removing ? `Unblock ${removing.phone}?` : 'Unblock number?'}
        description="Online orders with this number can be paid by cash on delivery again."
        confirmLabel="Unblock"
        pending={unblock.isPending}
        onConfirm={remove}
      />
    </div>
  )
}
