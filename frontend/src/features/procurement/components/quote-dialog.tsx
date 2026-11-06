import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { variantDisplayName } from '@/features/supply-chain/api'
import { isPositiveQuantity, lineEstimate, sumAmounts } from '@/features/supply-chain/quantities'
import { useRecordQuoteMutation, type QuoteInput, type Rfq, type RfqSupplier } from '@/features/procurement/api'
import { fieldErrorMap } from '@/lib/forms'
import { decimalPattern, formatMoney, trimDecimal } from '@/lib/money'

const PRICE = decimalPattern(4)

type LineDraft = { unit_price: string; quantity_offered: string; lead_time_days: string; notes: string }

/** Record (or correct) one supplier's quote: a price per line, lead times, validity. Blank price = not quoted. */
export function QuoteDialog({ rfq, invite, onClose }: { rfq: Rfq; invite: RfqSupplier; onClose: () => void }) {
  const lines = rfq.lines ?? []
  const existing = invite.quote?.status === 'received' ? invite.quote : null
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      lines.map((l) => {
        const q = existing?.lines?.find((x) => x.rfq_line_id === l.id)
        return [l.id, {
          unit_price: q?.unit_price ? trimDecimal(q.unit_price) : '',
          quantity_offered: q?.quantity_offered ? trimDecimal(q.quantity_offered) : trimDecimal(l.quantity),
          lead_time_days: q?.lead_time_days != null ? String(q.lead_time_days) : '',
          notes: q?.notes ?? '',
        } satisfies LineDraft]
      }),
    ),
  )
  const [validUntil, setValidUntil] = useState(existing?.valid_until ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const record = useRecordQuoteMutation()
  const idempotency = useIdempotencyKey()
  const name = invite.supplier.name

  const patch = (id: string, p: Partial<LineDraft>) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] as LineDraft), ...p } }))

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    let priced = 0
    lines.forEach((l, i) => {
      const d = drafts[l.id] as LineDraft
      if (d.unit_price.trim() === '') return
      priced++
      if (!PRICE.test(d.unit_price.trim())) e[`lines.${i}.unit_price`] = 'A price with up to 4 decimals.'
      if (d.quantity_offered.trim() !== '' && !isPositiveQuantity(d.quantity_offered)) e[`lines.${i}.quantity_offered`] = 'A positive quantity.'
      if (d.lead_time_days.trim() !== '' && (!/^\d{1,3}$/.test(d.lead_time_days.trim()) || Number(d.lead_time_days.trim()) > 365)) e[`lines.${i}.lead_time_days`] = 'Whole days (0–365).'
    })
    if (priced === 0) e.form = 'Enter a price for at least one line, or record the supplier as declined.'
    return e
  }

  const quoted = lines.filter((l) => (drafts[l.id]?.unit_price.trim() ?? '') !== '')
  const total = sumAmounts(quoted.map((l) => {
    const d = drafts[l.id] as LineDraft
    return PRICE.test(d.unit_price.trim()) ? lineEstimate(d.quantity_offered.trim() || l.quantity, d.unit_price.trim()) : '0.00'
  }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const input: QuoteInput = {
      supplier_id: invite.supplier.id,
      status: 'received',
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      lines: quoted.map((l) => {
        const d = drafts[l.id] as LineDraft
        return {
          rfq_line_id: l.id,
          unit_price: d.unit_price.trim(),
          quantity_offered: d.quantity_offered.trim() || null,
          lead_time_days: d.lead_time_days.trim() === '' ? null : Number(d.lead_time_days.trim()),
          notes: d.notes.trim() || null,
        }
      }),
    }
    const payload = { rfqId: rfq.id, input }
    record.mutate({ ...payload, idempotencyKey: idempotency.keyFor(payload) }, {
      onSuccess: () => {
        idempotency.settle()
        toast.success(`Quote from ${name} recorded.`)
        onClose()
      },
      onError: (err) => {
        idempotency.settle(err)
        const mapped = fieldErrorMap(err)
        setErrors(isRetryable(err) ? { form: `${err.message} You can retry safely.` } : mapped)
      },
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Quote from {name}</DialogTitle>
            <DialogDescription>Prices per unit as quoted for {rfq.number}. Leave a price blank when the supplier did not quote that line.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Quoted lines">
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-32">Unit price</TableHead>
                  <TableHead className="w-28">Qty offered</TableHead>
                  <TableHead className="w-24">Lead (days)</TableHead>
                  <TableHead className="hidden w-48 md:table-cell">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const d = drafts[l.id] as LineDraft
                  const product = variantDisplayName(l.variant)
                  const err = (f: string) => errors[`lines.${i}.${f}`]
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{product}</div>
                        <div className="text-xs text-muted-foreground">Requested {trimDecimal(l.quantity)} {l.variant?.unit_code ?? l.variant?.unit}</div>
                      </TableCell>
                      <TableCell>
                        <Input aria-label={`Unit price of ${product}`} inputMode="decimal" className="h-8 text-right font-mono" value={d.unit_price} aria-invalid={!!err('unit_price') || undefined} onChange={(e) => patch(l.id, { unit_price: e.target.value })} />
                        {err('unit_price') && <p className="mt-1 text-xs text-destructive">{err('unit_price')}</p>}
                      </TableCell>
                      <TableCell>
                        <Input aria-label={`Quantity offered of ${product}`} inputMode="decimal" className="h-8 text-right font-mono" value={d.quantity_offered} aria-invalid={!!err('quantity_offered') || undefined} onChange={(e) => patch(l.id, { quantity_offered: e.target.value })} />
                        {err('quantity_offered') && <p className="mt-1 text-xs text-destructive">{err('quantity_offered')}</p>}
                      </TableCell>
                      <TableCell>
                        <Input aria-label={`Lead time of ${product}`} inputMode="numeric" className="h-8 text-right font-mono" value={d.lead_time_days} aria-invalid={!!err('lead_time_days') || undefined} onChange={(e) => patch(l.id, { lead_time_days: e.target.value })} />
                        {err('lead_time_days') && <p className="mt-1 text-xs text-destructive">{err('lead_time_days')}</p>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Input aria-label={`Notes of ${product}`} className="h-8" value={d.notes} onChange={(e) => patch(l.id, { notes: e.target.value })} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-valid-until">Valid until</Label>
              <Input id="quote-valid-until" type="date" value={validUntil} aria-invalid={!!errors.valid_until || undefined} onChange={(e) => setValidUntil(e.target.value)} />
              {errors.valid_until && <p className="text-xs text-destructive">{errors.valid_until}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-notes">Notes</Label>
              <Textarea id="quote-notes" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <p className="text-sm">
            {quoted.length} of {lines.length} lines quoted · estimate <span className="font-mono font-semibold">{formatMoney(total, rfq.currency)}</span>
          </p>
          {(errors.form || errors.lines) && <p role="alert" className="text-sm text-destructive">{errors.form ?? errors.lines}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save quote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
