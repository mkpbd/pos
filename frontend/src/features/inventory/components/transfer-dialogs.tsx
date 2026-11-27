import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { SerialsDialog } from '@/components/common/serials-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBatchesQuery, useCompleteTransferMutation, variantLabel, type Transfer, type TransferLine } from '@/features/inventory/api'
import { serialErrors } from '@/features/inventory/lines'
import { fieldErrorMap } from '@/lib/forms'
import { compareDecimal, isZeroDecimal, subtractDecimal, trimDecimal } from '@/lib/money'

const QUANTITY = /^\d{1,15}(\.\d{1,3})?$/

/** Client check of one entered quantity (0 or more, whole units unless the product allows decimals). */
function quantityError(value: string, line: TransferLine): string | null {
  const v = value.trim()
  if (!QUANTITY.test(v)) return 'A quantity, 0 or more.'
  if (line.variant && !line.variant.allow_decimal && v.includes('.') && !/\.0+$/.test(v)) return `Whole ${line.variant.unit_code ?? 'units'} only.`
  return null
}

function LineHeading({ line, extra }: { line: TransferLine; extra: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span className="font-medium">
        {variantLabel(line.variant)}
        {line.batch && <span className="text-muted-foreground"> · {line.batch.batch_number}{line.batch.expires_on && ` (exp. ${line.batch.expires_on})`}</span>}
      </span>
      <span className="text-muted-foreground">{extra}</span>
    </div>
  )
}

type ReceiveRow = { received: string; damaged: string; note: string }

/**
 * ST2b: receive a transfer, recording per line what arrived in good condition and what was
 * damaged; the rest is short. Only the received quantity enters the destination store.
 * Serial-tracked lines are received in full.
 */
export function ReceiveTransferDialog({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const lines = transfer.lines ?? []
  const complete = useCompleteTransferMutation()
  const [rows, setRows] = useState<ReceiveRow[]>(() => lines.map((l) => ({ received: trimDecimal(l.quantity), damaged: '0', note: '' })))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (i: number, patch: Partial<ReceiveRow>) => setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const shortOf = (i: number): string | null => {
    const row = rows[i]
    const line = lines[i]
    if (!row || !line || !QUANTITY.test(row.received.trim()) || !QUANTITY.test(row.damaged.trim())) return null
    return subtractDecimal(subtractDecimal(line.quantity, row.received.trim()), row.damaged.trim())
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found: Record<string, string> = {}
    lines.forEach((line, i) => {
      const row = rows[i] as ReceiveRow
      const received = quantityError(row.received, line)
      const damaged = quantityError(row.damaged, line)
      if (received) found[`lines.${i}.received_quantity`] = received
      if (damaged) found[`lines.${i}.damaged_quantity`] = damaged
      const short = shortOf(i)
      if (!received && !damaged && short !== null && short.startsWith('-')) found[`lines.${i}.received_quantity`] = `Received and damaged add up to more than the ${trimDecimal(line.quantity)} sent.`
      if (row.note.trim().length > 200) found[`lines.${i}.note`] = 'At most 200 characters.'
    })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const body = {
      lines: lines.map((line, i) => {
        const row = rows[i] as ReceiveRow
        return { line_id: line.id, received_quantity: row.received.trim(), damaged_quantity: row.damaged.trim(), note: row.note.trim() || null }
      }),
    }
    complete.mutate({ id: transfer.id, action: 'receive', body }, {
      onSuccess: (t) => {
        toast.success(t.has_discrepancy ? `${t.number} received with a discrepancy.` : `${t.number} received.`)
        onClose()
      },
      onError: (error) => setErrors(fieldErrorMap(error)),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Receive {transfer.number}</DialogTitle>
            <DialogDescription>
              Count what arrived at {transfer.to_store?.name ?? 'the store'}. Only the received quantity goes into stock; damaged and missing units are recorded as a loss.
            </DialogDescription>
          </DialogHeader>
          <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {lines.map((line, i) => {
              const row = rows[i] as ReceiveRow
              const serial = !!line.variant?.track_serials
              const short = shortOf(i)
              const err = (field: string) => errors[`lines.${i}.${field}`]
              return (
                <li key={line.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <LineHeading line={line} extra={`Sent ${trimDecimal(line.quantity)}`} />
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Received
                      <Input aria-label={`Received of line ${i + 1}`} inputMode="decimal" value={row.received} disabled={serial} onChange={(e) => set(i, { received: e.target.value })} aria-invalid={!!err('received_quantity') || undefined} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Damaged
                      <Input aria-label={`Damaged of line ${i + 1}`} inputMode="decimal" value={row.damaged} disabled={serial} onChange={(e) => set(i, { damaged: e.target.value })} aria-invalid={!!err('damaged_quantity') || undefined} />
                    </label>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Short
                      <output aria-label={`Short of line ${i + 1}`} aria-live="polite" className={`flex h-9 items-center text-sm font-medium ${short && !isZeroDecimal(short) ? 'text-destructive' : 'text-foreground'}`}>
                        {short === null ? '—' : trimDecimal(short)}
                      </output>
                    </div>
                  </div>
                  <Input aria-label={`Note of line ${i + 1}`} placeholder="Note (optional)" value={row.note} onChange={(e) => set(i, { note: e.target.value })} aria-invalid={!!err('note') || undefined} />
                  {serial && <p className="text-xs text-muted-foreground">Serial-tracked: received in full.</p>}
                  {['received_quantity', 'damaged_quantity', 'note'].map((f) => err(f) && <p key={f} className="text-sm text-destructive">{err(f)}</p>)}
                </li>
              )
            })}
          </ol>
          {(errors.form || errors.lines) && <p role="alert" className="text-sm text-destructive">{errors.form ?? errors.lines}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={complete.isPending}>
              {complete.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Receive goods
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const AUTO = 'auto'

function BatchChoice({ line, index, storeId, value, onChange }: { line: TransferLine; index: number; storeId: string | undefined; value: string; onChange: (v: string) => void }) {
  const batches = useBatchesQuery({ variant_id: line.variant?.id, store_id: storeId }, !!line.variant && !!storeId)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={`Batch of line ${index + 1}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>Earliest expiry first</SelectItem>
        {(batches.data ?? []).filter((b) => !b.is_expired).map((b) => (
          <SelectItem key={b.batch.id} value={b.batch.id}>
            {b.batch.batch_number} · {trimDecimal(b.quantity)}{b.batch.expires_on && ` · exp. ${b.batch.expires_on}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type DispatchRow = { quantity: string; batch: string; serials: string[] }

/**
 * ST2b: dispatch a requested transfer from the source store — up to the requested quantity per
 * line (0 drops the line); batch-tracked lines take the earliest-expiring batch unless one is chosen.
 */
export function DispatchRequestDialog({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const lines = transfer.lines ?? []
  const complete = useCompleteTransferMutation()
  const requested = (l: TransferLine) => l.requested_quantity ?? l.quantity
  const [rows, setRows] = useState<DispatchRow[]>(() => lines.map((l) => ({ quantity: trimDecimal(requested(l)), batch: AUTO, serials: [] })))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (i: number, patch: Partial<DispatchRow>) => setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found: Record<string, string> = {}
    lines.forEach((line, i) => {
      const q = (rows[i] as DispatchRow).quantity.trim()
      const error = quantityError(q, line) ?? (compareDecimal(q, requested(line)) > 0 ? `At most the ${trimDecimal(requested(line))} requested.` : null)
      if (error) found[`lines.${i}.quantity`] = error
      // ST2d: one in-stock serial per unit sent.
      else if (line.variant?.track_serials && String((rows[i] as DispatchRow).serials.length) !== trimDecimal(q)) found[`lines.${i}.serials`] = `Enter ${trimDecimal(q)} serial numbers.`
    })
    if (Object.keys(found).length === 0 && rows.every((r) => isZeroDecimal(r.quantity.trim()))) found.form = 'Send at least one line, or reject the request.'
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const body = {
      lines: lines.map((line, i) => {
        const row = rows[i] as DispatchRow
        return { line_id: line.id, quantity: row.quantity.trim(), ...(row.batch !== AUTO ? { batch_id: row.batch } : {}), ...(line.variant?.track_serials ? { serials: row.serials } : {}) }
      }),
    }
    complete.mutate({ id: transfer.id, action: 'dispatch', body }, {
      onSuccess: (t) => {
        toast.success(`${t.number} dispatched.`)
        onClose()
      },
      onError: (error) => {
        const refused = serialErrors(error, body.lines)
        setErrors(refused.length > 0 ? Object.fromEntries(refused.map((r) => [r.path, r.message])) : fieldErrorMap(error))
      },
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Dispatch {transfer.number}</DialogTitle>
            <DialogDescription>
              The goods leave {transfer.from_store?.name ?? 'the source store'} for {transfer.to_store?.name ?? 'the requesting store'}. Send less than requested, or 0 to leave a line out.
            </DialogDescription>
          </DialogHeader>
          <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {lines.map((line, i) => {
              const row = rows[i] as DispatchRow
              const err = errors[`lines.${i}.quantity`] ?? errors[`lines.${i}.batch_id`] ?? errors[`lines.${i}.serials`]
              return (
                <li key={line.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <LineHeading line={line} extra={`Requested ${trimDecimal(requested(line))}`} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Send
                      <Input aria-label={`Send of line ${i + 1}`} inputMode="decimal" value={row.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-invalid={!!errors[`lines.${i}.quantity`] || undefined} />
                    </label>
                    {line.variant?.track_batches && (
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Batch
                        <BatchChoice line={line} index={i} storeId={transfer.from_store?.id} value={row.batch} onChange={(batch) => set(i, { batch })} />
                      </div>
                    )}
                    {line.variant?.track_serials && (
                      <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
                        Serials
                        <SerialsDialog
                          label={variantLabel(line.variant)}
                          buttonLabel={`Serials of line ${i + 1}`}
                          quantity={trimDecimal(row.quantity.trim() || '0')}
                          serials={row.serials}
                          onChange={(serials) => set(i, { serials })}
                          pickFrom={{ storeId: transfer.from_store?.id, variantId: line.variant.id }}
                        />
                      </div>
                    )}
                  </div>
                  {err && <p className="text-sm text-destructive">{err}</p>}
                </li>
              )
            })}
          </ol>
          {(errors.form || errors.lines) && <p role="alert" className="text-sm text-destructive">{errors.form ?? errors.lines}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={complete.isPending}>
              {complete.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Dispatch goods
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
