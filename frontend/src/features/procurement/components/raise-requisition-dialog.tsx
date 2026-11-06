import { useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { variantDisplayName, variantUnit } from '@/features/supply-chain/api'
import { lineEstimate, normalizeQuantity, sumAmounts } from '@/features/supply-chain/quantities'
import { wants, type EffectiveRow } from '@/features/supply-chain/reorder-lines'
import { useRequisitionFromSuggestionsMutation, type Requisition, type RequisitionFromSuggestionsInput } from '@/features/procurement/api'
import { REQUISITION_STATUS, statusBadge } from '@/features/procurement/procurement'
import { formatMoney } from '@/lib/money'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
  storeName: string
  rows: EffectiveRow[]
  currency?: string
  /** Called with the variants that went onto the requisition. */
  onCreated: (variantIds: string[]) => void
}

/** Reorder suggestions → one purchase requisition for approval (for staff who cannot order directly). */
export function RaiseRequisitionDialog({ open, onOpenChange, storeId, storeName, rows, currency, onCreated }: Props) {
  const lines = rows.filter((r) => wants(r.purchase))
  const [neededBy, setNeededBy] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Requisition | null>(null)
  const raise = useRequisitionFromSuggestionsMutation()
  const idempotency = useIdempotencyKey()
  const estimates = lines.map((r) => lineEstimate(normalizeQuantity(r.purchase), r.unitCost))

  const submit = () => {
    const input: RequisitionFromSuggestionsInput = {
      store_id: storeId,
      needed_by: neededBy || null,
      notes: notes.trim() || null,
      // Straight to approval (or approved at once within the auto-approve limit).
      submit: true,
      lines: lines.map((r) => ({ variant_id: r.row.variant.id, quantity: normalizeQuantity(r.purchase), supplier_id: r.supplier?.id ?? null, unit_cost: r.unitCost ?? null })),
    }
    setError(null)
    raise.mutate({ input, idempotencyKey: idempotency.keyFor(input) }, {
      onSuccess: (req) => {
        idempotency.settle()
        setCreated(req)
        onCreated(input.lines.map((l) => l.variant_id))
      },
      onError: (e) => {
        idempotency.settle(e)
        setError(isRetryable(e) ? `${e.message} You can retry safely.` : e.message)
      },
    })
  }

  const status = created ? statusBadge(REQUISITION_STATUS, created.status) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Requisition raised' : 'Raise a purchase requisition'}</DialogTitle>
          <DialogDescription>
            {created ? 'Purchasing orders the goods once it is approved.' : `For ${storeName}. It is submitted for approval right away — an approver decides by the estimated amount; purchasing then orders from suppliers.`}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <CheckCircle2Icon className="size-4 text-success" aria-hidden />
            <Link to={`/purchasing/requisitions/${created.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{created.number}</Link>
            {status && <span className="text-muted-foreground">{status.label}</span>}
            <span className="ml-auto font-mono">{formatMoney(created.estimated_total, created.currency ?? currency)}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Requested items">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="hidden sm:table-cell">Supplier</TableHead>
                    <TableHead className="text-right">Estimate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((r, i) => (
                    <TableRow key={r.row.variant.id}>
                      <TableCell className="font-medium">{variantDisplayName(r.row.variant)}</TableCell>
                      <TableCell className="text-right font-mono">{normalizeQuantity(r.purchase)} {variantUnit(r.row.variant)}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{r.supplier?.name ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono">{r.unitCost ? formatMoney(estimates[i]) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right">Estimated total (excl. tax)</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatMoney(sumAmounts(estimates), currency)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="raise-needed-by">Needed by</Label>
                <Input id="raise-needed-by" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="raise-notes">Notes</Label>
                <Textarea id="raise-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={raise.isPending || lines.length === 0}>
                {raise.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Raise requisition
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
