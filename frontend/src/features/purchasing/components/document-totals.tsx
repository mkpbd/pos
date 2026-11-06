import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { variantLabel } from '@/features/inventory/api'
import type { PurchaseLine } from '@/features/purchasing/api'
import { formatMoney, trimDecimal } from '@/lib/money'

type ExtraColumn = { header: string; cell: (line: PurchaseLine) => string }

/** Read-only lines and server-computed totals of a purchase document. */
export function DocumentLinesTable({ lines, currency, subtotal, taxTotal, total, extra }: {
  lines: PurchaseLine[]
  currency: string
  subtotal: string
  taxTotal: string
  total: string
  extra?: ExtraColumn | ExtraColumn[]
}) {
  const extras = extra === undefined ? [] : Array.isArray(extra) ? extra : [extra]
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
