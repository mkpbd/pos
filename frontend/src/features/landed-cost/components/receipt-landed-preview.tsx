import { useWatch, type Control } from 'react-hook-form'
import type { LineValue } from '@/components/common/line-values'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { previewLandedCosts, sumMoney } from '@/features/landed-cost/allocation'
import type { ChargeValue } from '@/features/landed-cost/charges'
import { formatMoney, trimDecimal } from '@/lib/money'

type Form = { lines: LineValue[]; charges: ChargeValue[] }

const MONEY = /^\d{1,16}(\.\d{1,2})?$/
const money = (v: string) => (MONEY.test(v.trim()) ? v.trim() : '0')

/**
 * Live allocation of the receipt's charges over its lines — the landed unit cost each line
 * will enter stock at. Computed exactly like the server (largest remainder, 4-dp unit costs).
 */
export function ReceiptLandedPreview<T extends Form>({ control, currency }: { control: Control<T>; currency?: string }) {
  const c = control as unknown as Control<Form>
  const lines = useWatch({ control: c, name: 'lines' }) ?? []
  const charges = useWatch({ control: c, name: 'charges' }) ?? []
  if (charges.length === 0) return null

  const preview = previewLandedCosts(
    lines.map((l) => ({ quantity: l.quantity ?? '', unit_cost: l.unit_cost ?? '' })),
    charges.map((ch) => ({ amount: ch.amount ?? '', allocation: ch.allocation })),
  )
  const onInvoice = sumMoney(charges.filter((ch) => !ch.charge_supplier_id).flatMap((ch) => [money(ch.amount), money(ch.tax_amount)]))
  const separate = sumMoney(charges.filter((ch) => ch.charge_supplier_id).flatMap((ch) => [money(ch.amount), money(ch.tax_amount)]))
  const chargeTax = sumMoney(charges.map((ch) => money(ch.tax_amount)))

  return (
    <section aria-labelledby="landed-preview-heading" className="flex flex-col gap-2">
      <h3 id="landed-preview-heading" className="text-sm font-semibold">Landed cost preview</h3>
      {preview.problem && <p role="status" className="text-sm text-warning-soft-foreground">{preview.problem}</p>}
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Landed cost per line">
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
              <TableHead className="hidden text-right md:table-cell">Line value</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Landed unit cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.lines.map((p, i) => {
              const line = lines[i]
              const name = line?.variant?.label ?? `Line ${i + 1}`
              return (
                <TableRow key={i} aria-label={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-right font-mono">{trimDecimal(line?.quantity ?? '') || '—'}</TableCell>
                  <TableCell className="hidden text-right font-mono sm:table-cell">{line?.unit_cost ? formatMoney(line.unit_cost, undefined, 4) : '—'}</TableCell>
                  <TableCell className="hidden text-right font-mono md:table-cell">{formatMoney(p.subtotal)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(p.landed_cost)}</TableCell>
                  <TableCell className="text-right font-mono" data-testid={`landed-unit-cost-${i}`}>{p.landed_unit_cost ? formatMoney(p.landed_unit_cost, undefined, 4) : '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right">Goods <span className="hidden md:inline">{formatMoney(preview.goods_total)}</span> + charges</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(preview.charges_total)}</TableCell>
              <TableCell className="text-right font-mono font-semibold" aria-label="Landed total">{formatMoney(preview.landed_total, currency)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Added to this invoice</dt><dd className="font-mono">{formatMoney(onInvoice, currency)}</dd></div>
        <div><dt className="text-muted-foreground">Billed by other suppliers</dt><dd className="font-mono">{formatMoney(separate, currency)}</dd></div>
        <div><dt className="text-muted-foreground">Tax on charges (recoverable)</dt><dd className="font-mono">{formatMoney(chargeTax, currency)}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Charge amounts (without tax) are added to the stock cost. Preview only — the server recomputes everything when the receipt is posted.</p>
    </section>
  )
}
