import { useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { variantDisplayName } from '@/features/supply-chain/api'
import { isPositiveQuantity } from '@/features/supply-chain/quantities'
import { useConvertRequisitionMutation, type ConvertInput, type ConvertResult, type Requisition, type SupplierSummary } from '@/features/procurement/api'
import { hasRemaining, remainingQuantity } from '@/features/procurement/procurement'
import { OptionalSupplierSelect } from '@/features/procurement/components/supplier-pickers'
import { compareDecimal, formatMoney } from '@/lib/money'

type Target = 'po' | 'rfq' | 'skip'
type Row = { target: Target; supplier: SupplierSummary | null; quantity: string }

const TARGETS: Record<Target, string> = { po: 'Purchase order', rfq: 'Request quotes', skip: 'Not now' }

/** Approved requisition → draft purchase orders (one per supplier) and/or an RFQ for selected lines. */
export function ConvertDialog({ requisition, open, onOpenChange }: { requisition: Requisition; open: boolean; onOpenChange: (open: boolean) => void }) {
  const lines = (requisition.lines ?? []).filter(hasRemaining)
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { target: l.suggested_supplier ? 'po' : 'rfq', supplier: l.suggested_supplier, quantity: remainingQuantity(l) } satisfies Row])),
  )
  const [title, setTitle] = useState(`Quotes for ${requisition.number}`)
  const [replyBy, setReplyBy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const convert = useConvertRequisitionMutation()
  const idempotency = useIdempotencyKey()

  const patch = (id: string, p: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...(r[id] as Row), ...p } }))

  const problems = lines.flatMap((l) => {
    const row = rows[l.id]
    if (!row || row.target === 'skip') return []
    const name = variantDisplayName(l.variant)
    if (!isPositiveQuantity(row.quantity)) return [`${name}: enter a positive quantity.`]
    if (compareDecimal(row.quantity.trim(), remainingQuantity(l)) > 0) return [`${name}: at most ${remainingQuantity(l)}.`]
    if (row.target === 'po' && !row.supplier) return [`${name}: choose a supplier.`]
    return []
  })
  const poLines = lines.filter((l) => rows[l.id]?.target === 'po')
  const rfqLines = lines.filter((l) => rows[l.id]?.target === 'rfq')
  const supplierCount = new Set(poLines.map((l) => rows[l.id]?.supplier?.id)).size
  const nothing = poLines.length === 0 && rfqLines.length === 0

  const submit = () => {
    if (problems.length > 0 || nothing) return
    const input: ConvertInput = {
      purchase_orders: poLines.length
        ? { lines: poLines.map((l) => ({ requisition_line_id: l.id, quantity: (rows[l.id] as Row).quantity.trim(), supplier_id: (rows[l.id] as Row).supplier?.id })) }
        : null,
      rfq: rfqLines.length ? { lines: rfqLines.map((l) => ({ requisition_line_id: l.id, quantity: (rows[l.id] as Row).quantity.trim() })), title: title.trim() || null, reply_by: replyBy || null } : null,
    }
    setError(null)
    const payload = { id: requisition.id, input }
    convert.mutate({ ...payload, idempotencyKey: idempotency.keyFor(payload) }, {
      onSuccess: (r) => {
        idempotency.settle()
        setResult(r)
      },
      onError: (e) => {
        idempotency.settle(e)
        setError(isRetryable(e) ? `${e.message} You can retry safely.` : e.message)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{result ? `${requisition.number} converted` : `Convert ${requisition.number}`}</DialogTitle>
          <DialogDescription>
            {result
              ? 'The drafts are pre-approved up to the approved amount (+5 %). Review and submit them.'
              : 'Choose per line: a draft purchase order with a supplier (one order per supplier), quotes from several suppliers (RFQ), or leave it for later.'}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3">
            {result.purchase_orders.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Created purchase orders">
                {result.purchase_orders.map((po) => (
                  <li key={po.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                      <Link to={`/purchasing/orders/${po.id}`} className="font-mono text-sm font-medium underline-offset-4 hover:underline">{po.number}</Link>
                      <span className="text-sm">{po.supplier?.name}</span>
                      {po.pre_approved && <Badge variant="success">Pre-approved</Badge>}
                    </div>
                    {po.total && <span className="font-mono text-sm">{formatMoney(po.total, po.currency ?? requisition.currency)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {result.rfq && (
              <div className="flex items-center gap-2 rounded-md border p-3 text-sm">
                <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                RFQ <Link to={`/purchasing/rfqs/${result.rfq.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{result.rfq.number}</Link> created — invite suppliers and send it.
              </div>
            )}
          </div>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every line is already on a purchase order or RFQ.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Lines to convert">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-28 text-right">Quantity</TableHead>
                    <TableHead className="w-44">Convert to</TableHead>
                    <TableHead className="w-52">Supplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const row = rows[l.id] as Row
                    const name = variantDisplayName(l.variant)
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground">Open {remainingQuantity(l)}{l.estimated_unit_cost && ` · est. ${formatMoney(l.estimated_unit_cost, undefined, 2)}`}</div>
                        </TableCell>
                        <TableCell>
                          <Input aria-label={`Quantity to convert of ${name}`} inputMode="decimal" className="h-8 text-right font-mono" value={row.quantity} disabled={row.target === 'skip'} onChange={(e) => patch(l.id, { quantity: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Select value={row.target} onValueChange={(v) => patch(l.id, { target: v as Target })}>
                            <SelectTrigger size="sm" className="w-full" aria-label={`Convert ${name} to`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(TARGETS) as Target[]).map((t) => <SelectItem key={t} value={t}>{TARGETS[t]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {row.target === 'po' ? (
                            <OptionalSupplierSelect size="sm" value={row.supplier?.id ?? null} current={row.supplier} onChange={(s) => patch(l.id, { supplier: s })} label={`Supplier of ${name}`} noneLabel="Choose supplier" />
                          ) : (
                            <span className="text-xs text-muted-foreground">{row.target === 'rfq' ? 'Suppliers invited on the RFQ' : '—'}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {rfqLines.length > 0 && (
              <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">Request for quotation ({rfqLines.length} {rfqLines.length === 1 ? 'line' : 'lines'})</legend>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="convert-rfq-title">RFQ title</Label>
                  <Input id="convert-rfq-title" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="convert-rfq-reply">Reply by</Label>
                  <Input id="convert-rfq-reply" type="date" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
                </div>
              </fieldset>
            )}
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {poLines.length > 0 && `${supplierCount} draft purchase ${supplierCount === 1 ? 'order' : 'orders'}`}
              {poLines.length > 0 && rfqLines.length > 0 && ' and '}
              {rfqLines.length > 0 && '1 RFQ'}
              {nothing && 'Nothing selected.'}
            </p>
            {problems.length > 0 && (
              <ul role="alert" className="list-inside list-disc text-sm text-destructive">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {result || lines.length === 0 ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={convert.isPending || nothing || problems.length > 0}>
                {convert.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Convert
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
