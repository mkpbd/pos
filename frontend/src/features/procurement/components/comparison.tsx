import { useState } from 'react'
import { Link } from 'react-router'
import { CheckCircle2Icon, Loader2Icon, TrophyIcon, ZapIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { isRetryable, useIdempotencyKey } from '@/features/returns/api'
import { variantDisplayName } from '@/features/supply-chain/api'
import { isPositiveQuantity, lineEstimate, sumAmounts } from '@/features/supply-chain/quantities'
import { useAwardRfqMutation, type AwardResult, type Comparison, type Rfq } from '@/features/procurement/api'
import { coverageLabel, defaultAward, type AwardChoice } from '@/features/procurement/procurement'
import { compareDecimal, formatMoney, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Lines × suppliers: unit price, line total and lead time per quote; lowest price and fastest delivery highlighted. */
export function ComparisonMatrix({ comparison, currency }: { comparison: Comparison; currency?: string }) {
  const suppliers = comparison.suppliers
  if (suppliers.length === 0) return <p className="text-sm text-muted-foreground">No suppliers invited.</p>

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="Quote comparison">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-44">Product</TableHead>
            {suppliers.map((s) => (
              <TableHead key={s.supplier.id} className="min-w-40 text-right" scope="col">
                <div className="font-medium text-foreground">{s.supplier.name}</div>
                {s.status !== 'received' && <Badge variant={s.status === 'declined' ? 'destructive' : 'outline'}>{s.status === 'declined' ? 'Declined' : 'No quote yet'}</Badge>}
                {s.status === 'received' && s.expired && <Badge variant="warning">Expired</Badge>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparison.lines.map(({ line, quotes }) => {
            const product = variantDisplayName(line.variant)
            return (
              <TableRow key={line.id}>
                <TableHead scope="row" className="font-normal">
                  <div className="font-medium text-foreground">{product}</div>
                  <div className="text-xs text-muted-foreground">{trimDecimal(line.quantity)} {line.variant?.unit_code ?? line.variant?.unit}</div>
                </TableHead>
                {suppliers.map((s) => {
                  const q = quotes.find((x) => x.supplier_id === s.supplier.id)
                  if (!q) return <TableCell key={s.supplier.id} className="text-right text-muted-foreground" aria-label={`${s.supplier.name}: not quoted`}>—</TableCell>
                  return (
                    <TableCell key={s.supplier.id} className={cn('text-right align-top', q.lowest_price && 'bg-success/10')} data-lowest={q.lowest_price || undefined} data-fastest={q.fastest || undefined}>
                      <div className="font-mono">{formatMoney(q.unit_price, undefined, 2)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{formatMoney(q.line_total)}</div>
                      <div className="text-xs text-muted-foreground">
                        {q.lead_time_days != null ? `${q.lead_time_days} d` : 'Lead —'}
                        {q.quantity_offered && (q.partial || compareDecimal(q.quantity_offered, line.quantity) < 0) && ` · only ${trimDecimal(q.quantity_offered)}`}
                      </div>
                      <div className="mt-1 flex flex-wrap justify-end gap-1">
                        {q.lowest_price && <Badge variant="success"><TrophyIcon aria-hidden /> Lowest</Badge>}
                        {q.fastest && <Badge variant="info"><ZapIcon aria-hidden /> Fastest</Badge>}
                      </div>
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableHead scope="row" className="font-semibold text-foreground">Total quoted</TableHead>
            {suppliers.map((s) => <TableCell key={s.supplier.id} className="text-right font-mono font-semibold">{s.status === 'received' ? formatMoney(s.total, currency) : '—'}</TableCell>)}
          </TableRow>
          <TableRow>
            <TableHead scope="row" className="font-normal text-foreground">Coverage</TableHead>
            {suppliers.map((s) => <TableCell key={s.supplier.id} className="text-right text-sm">{coverageLabel(s.lines_quoted, comparison.line_count)}</TableCell>)}
          </TableRow>
          <TableRow>
            <TableHead scope="row" className="font-normal text-foreground">Valid until</TableHead>
            {suppliers.map((s) => <TableCell key={s.supplier.id} className="text-right text-sm">{s.valid_until ?? '—'}</TableCell>)}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

const SKIP = '__skip__'

/** Pick a supplier per line (defaults to the lowest price; split awards allowed) → draft purchase orders per supplier. */
export function AwardDialog({ rfq, comparison, onClose }: { rfq: Rfq; comparison: Comparison; onClose: () => void }) {
  const [choices, setChoices] = useState<Record<string, AwardChoice>>(() => defaultAward(comparison))
  const [updateCatalog, setUpdateCatalog] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AwardResult | null>(null)
  const award = useAwardRfqMutation()
  const idempotency = useIdempotencyKey()
  const names = new Map(comparison.suppliers.map((s) => [s.supplier.id, s.supplier.name]))

  const patch = (lineId: string, p: Partial<AwardChoice>) => setChoices((c) => ({ ...c, [lineId]: { ...(c[lineId] as AwardChoice), ...p } }))

  const awarded = comparison.lines.filter(({ line }) => choices[line.id]?.supplierId)
  const problems = awarded.flatMap(({ line }) => {
    const c = choices[line.id] as AwardChoice
    return isPositiveQuantity(c.quantity) ? [] : [`${variantDisplayName(line.variant)}: enter a positive quantity.`]
  })
  const bySupplier = new Map<string, string[]>()
  awarded.forEach(({ line, quotes }) => {
    const c = choices[line.id] as AwardChoice
    const q = quotes.find((x) => x.supplier_id === c.supplierId)
    if (!q || !c.supplierId) return
    bySupplier.set(c.supplierId, [...(bySupplier.get(c.supplierId) ?? []), isPositiveQuantity(c.quantity) ? lineEstimate(c.quantity, q.unit_price) : '0.00'])
  })

  const submit = () => {
    if (awarded.length === 0 || problems.length > 0) return
    const input = {
      lines: awarded.map(({ line }) => {
        const c = choices[line.id] as AwardChoice
        return { rfq_line_id: line.id, supplier_id: c.supplierId as string, quantity: c.quantity.trim() }
      }),
      update_catalog: updateCatalog,
    }
    const payload = { id: rfq.id, input }
    setError(null)
    award.mutate({ ...payload, idempotencyKey: idempotency.keyFor(payload) }, {
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{result ? `${rfq.number} awarded` : `Award ${rfq.number}`}</DialogTitle>
          <DialogDescription>
            {result
              ? 'Draft purchase orders were created at the quoted prices.'
              : `One draft purchase order per supplier at the quoted prices.${rfq.requisition ? ` Pre-approved within ${rfq.requisition.number}'s approved amount (+5 %).` : ' They follow the usual purchase order approval.'}`}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <ul className="flex flex-col gap-2" aria-label="Created purchase orders">
            {result.purchase_orders.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                  <Link to={`/purchasing/orders/${po.id}`} className="font-mono text-sm font-medium underline-offset-4 hover:underline">{po.number}</Link>
                  <span className="text-sm">{po.supplier?.name}</span>
                  {po.pre_approved && <Badge variant="success">Pre-approved</Badge>}
                </div>
                {po.total && <span className="font-mono text-sm">{formatMoney(po.total, po.currency ?? rfq.currency)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3" aria-label="Award per line">
              {comparison.lines.map(({ line, quotes }) => {
                const c = choices[line.id] as AwardChoice
                const product = variantDisplayName(line.variant)
                const sorted = [...quotes].sort((a, b) => compareDecimal(a.unit_price, b.unit_price))
                return (
                  <li key={line.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_14rem_7rem] sm:items-center">
                    <div>
                      <div className="font-medium">{product}</div>
                      <div className="text-xs text-muted-foreground">Requested {trimDecimal(line.quantity)}{quotes.length === 0 && ' · no quotes'}</div>
                    </div>
                    <Select value={c.supplierId ?? SKIP} onValueChange={(v) => patch(line.id, { supplierId: v === SKIP ? null : v })} disabled={quotes.length === 0}>
                      <SelectTrigger size="sm" className="w-full" aria-label={`Supplier for ${product}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {sorted.map((q) => (
                          <SelectItem key={q.supplier_id} value={q.supplier_id}>
                            {names.get(q.supplier_id) ?? q.supplier_id} · {formatMoney(q.unit_price, undefined, 2)}{q.lowest_price ? ' · lowest' : ''}{q.fastest ? ' · fastest' : ''}
                          </SelectItem>
                        ))}
                        <SelectItem value={SKIP}>Don't award</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input aria-label={`Quantity awarded of ${product}`} inputMode="decimal" className="h-8 text-right font-mono" value={c.quantity} disabled={!c.supplierId} onChange={(e) => patch(line.id, { quantity: e.target.value })} />
                  </li>
                )
              })}
            </ul>
            {bySupplier.size > 0 && (
              <ul className="flex flex-col gap-1 text-sm" aria-label="Orders to create">
                {[...bySupplier].map(([id, amounts]) => (
                  <li key={id} className="flex justify-between gap-2">
                    <span>{names.get(id)} · {amounts.length} {amounts.length === 1 ? 'line' : 'lines'}</span>
                    <span className="font-mono">{formatMoney(sumAmounts(amounts), rfq.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-start gap-2">
              <Checkbox id="award-update-catalog" checked={updateCatalog} onCheckedChange={(v) => setUpdateCatalog(v === true)} />
              <Label htmlFor="award-update-catalog" className="flex flex-col items-start gap-0.5 font-normal">
                <span>Update supplier catalog</span>
                <span className="text-xs text-muted-foreground">Save the awarded prices and lead times as each supplier's catalog terms.</span>
              </Label>
            </div>
            {problems.length > 0 && <ul role="alert" className="list-inside list-disc text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={award.isPending || awarded.length === 0 || problems.length > 0}>
                {award.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Award and create {bySupplier.size} {bySupplier.size === 1 ? 'order' : 'orders'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
