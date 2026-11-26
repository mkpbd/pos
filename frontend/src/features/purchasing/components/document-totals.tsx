import { useWatch, type Control } from 'react-hook-form'
import type { LinesForm } from '@/components/common/line-values'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { variantLabel } from '@/features/inventory/api'
import { effectiveUnitCost, lineSubtotal, lineTax, sumMoney } from '@/features/landed-cost/allocation'
import type { PurchaseLine } from '@/features/purchasing/api'
import { formatMoney, trimDecimal } from '@/lib/money'

type ExtraColumn = { header: string; cell: (line: PurchaseLine) => string }

/** ST2a: free quantity and discount columns of order / receipt lines. */
const DISCOUNT_COLUMNS: ExtraColumn[] = [
  { header: 'Free qty', cell: (l) => trimDecimal(l.bonus_quantity ?? '0') || '0' },
  { header: 'Disc %', cell: (l) => trimDecimal(l.discount_percent ?? '0') || '0' },
]

/** Read-only lines and server-computed totals of a purchase document. */
export function DocumentLinesTable({ lines, currency, subtotal, taxTotal, total, extra, discounts }: {
  lines: PurchaseLine[]
  currency: string
  subtotal: string
  taxTotal: string
  total: string
  extra?: ExtraColumn | ExtraColumn[]
  /** Show the free quantity and discount % of each line (ST2a). */
  discounts?: boolean
}) {
  const extras = [...(discounts ? DISCOUNT_COLUMNS : []), ...(extra === undefined ? [] : Array.isArray(extra) ? extra : [extra])]
  const span = 4 + extras.length
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            {extras.map((x) => <TableHead key={x.header} className="text-right">{x.header}</TableHead>)}
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Tax</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <div className="font-medium">{variantLabel(l.variant)}</div>
                <div className="font-mono text-xs text-muted-foreground">{l.variant?.sku}{l.batch && ` · batch ${l.batch.batch_number}`}</div>
              </TableCell>
              <TableCell className="text-right font-mono">{trimDecimal(l.quantity)} {l.variant?.unit_code}</TableCell>
              {extras.map((x) => <TableCell key={x.header} className="text-right font-mono">{x.cell(l)}</TableCell>)}
              <TableCell className="text-right font-mono">{formatMoney(l.unit_cost, undefined, 2)}</TableCell>
              <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(l.line_tax)} <span className="text-xs text-muted-foreground">({trimDecimal(l.tax_rate)}%)</span></TableCell>
              <TableCell className="text-right font-mono">{formatMoney(l.line_total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow><TableCell colSpan={span} className="text-right">Subtotal</TableCell><TableCell className="text-right font-mono">{formatMoney(subtotal)}</TableCell></TableRow>
          <TableRow><TableCell colSpan={span} className="text-right">Tax</TableCell><TableCell className="text-right font-mono">{formatMoney(taxTotal)}</TableCell></TableRow>
          <TableRow><TableCell colSpan={span} className="text-right font-semibold">Total</TableCell><TableCell className="text-right font-mono font-semibold">{formatMoney(total, currency)}</TableCell></TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

/** Label of the ST2a effective cost (what each unit in stock cost). */
export const EFFECTIVE_COST_LABEL = 'Cost per unit after discount and free goods'

/**
 * ST2a: live totals of the lines being edited, by the server's rule (PurchaseTotals): line
 * subtotal = quantity × unit cost less the discount, rounded once; tax on that subtotal (an empty
 * tax % uses the product's rate). Preview only — the server recomputes everything.
 */
export function LinesTotalsPreview<T extends LinesForm>({ control, currency, effectiveCost, unpricedNote }: {
  control: Control<T>
  currency?: string
  /** Show the cost per unit after discount and free goods (receipts). */
  effectiveCost?: boolean
  /** Shown when a line has no cost yet (e.g. the server prices it). */
  unpricedNote?: string
}) {
  const lines = useWatch({ control: control as unknown as Control<LinesForm>, name: 'lines' }) ?? []
  const rows = lines.map((l) => {
    const priced = (l.unit_cost ?? '').trim() !== ''
    const subtotal = lineSubtotal(l.quantity ?? '', l.unit_cost ?? '', l.discount_percent ?? '')
    const tax = lineTax(subtotal, (l.tax_rate ?? '').trim() || l.variant?.tax_rate || '0')
    const effective = effectiveUnitCost(l.quantity ?? '', l.unit_cost ?? '', l.discount_percent ?? '', l.bonus_quantity ?? '')
    return { name: l.variant?.label, priced, subtotal, tax, total: sumMoney([subtotal, tax]), effective }
  })
  const subtotal = sumMoney(rows.map((r) => r.subtotal))
  const tax = sumMoney(rows.map((r) => r.tax))
  const span = effectiveCost ? 4 : 3

  return (
    <section aria-label="Totals preview" className="mt-4 flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Line totals">
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="hidden text-right sm:table-cell">After discount</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Tax</TableHead>
              {effectiveCost && <TableHead className="text-right">{EFFECTIVE_COST_LABEL}</TableHead>}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} aria-label={r.name ?? `Line ${i + 1}`}>
                <TableCell className="font-medium">{r.name ?? `Line ${i + 1}`}</TableCell>
                <TableCell className="hidden text-right font-mono sm:table-cell">{r.priced ? formatMoney(r.subtotal) : '—'}</TableCell>
                <TableCell className="hidden text-right font-mono sm:table-cell">{r.priced ? formatMoney(r.tax) : '—'}</TableCell>
                {effectiveCost && <TableCell className="text-right font-mono" data-testid={`effective-cost-${i}`}>{r.priced && r.effective ? formatMoney(r.effective, undefined, 4) : '—'}</TableCell>}
                <TableCell className="text-right font-mono">{r.priced ? formatMoney(r.total) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow><TableCell colSpan={span} className="text-right">Subtotal</TableCell><TableCell className="text-right font-mono">{formatMoney(subtotal)}</TableCell></TableRow>
            <TableRow><TableCell colSpan={span} className="text-right">Tax</TableCell><TableCell className="text-right font-mono">{formatMoney(tax)}</TableCell></TableRow>
            <TableRow><TableCell colSpan={span} className="text-right font-semibold">Total</TableCell><TableCell className="text-right font-mono font-semibold" aria-label="Previewed total">{formatMoney(sumMoney([subtotal, tax]), currency)}</TableCell></TableRow>
          </TableFooter>
        </Table>
      </div>
      {unpricedNote && rows.some((r) => !r.priced) && <p className="text-xs text-muted-foreground">{unpricedNote}</p>}
    </section>
  )
}
