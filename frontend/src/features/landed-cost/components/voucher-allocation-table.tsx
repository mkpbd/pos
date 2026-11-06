import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { variantLabel } from '@/features/inventory/api'
import type { VoucherAllocation } from '@/features/landed-cost/api'
import { sumMoney } from '@/features/landed-cost/allocation'
import { formatMoney, trimDecimal } from '@/lib/money'

function CostChange({ before, after }: { before?: string | null; after?: string | null }) {
  if (!after) return <>—</>
  return (
    <span>
      {before && before !== after && <span className="text-muted-foreground">{formatMoney(before, undefined, 4)} → </span>}
      {formatMoney(after, undefined, 4)}
    </span>
  )
}

/**
 * A voucher's allocation per receipt line: the share for quantity still on hand goes into the
 * stock value (new landed unit cost); the share for quantity already sold goes to an expense.
 */
export function VoucherAllocationTable({ lines, currency, label = 'Voucher allocation' }: { lines: VoucherAllocation[]; currency?: string; label?: string }) {
  const onHand = sumMoney(lines.map((l) => l.on_hand_amount))
  const sold = sumMoney(lines.map((l) => l.consumed_amount))
  const total = sumMoney(lines.map((l) => l.amount))

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Added to stock value</dt><dd className="font-mono font-medium" data-testid="voucher-on-hand-total">{formatMoney(onHand, currency)}</dd></div>
        <div><dt className="text-muted-foreground">Expensed (already sold or used)</dt><dd className="font-mono font-medium" data-testid="voucher-consumed-total">{formatMoney(sold, currency)}</dd></div>
        <div><dt className="text-muted-foreground">Allocated</dt><dd className="font-mono font-semibold">{formatMoney(total, currency)}</dd></div>
      </dl>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="hidden text-right md:table-cell">Received</TableHead>
              <TableHead className="hidden text-right sm:table-cell">On hand</TableHead>
              <TableHead className="text-right">Allocated</TableHead>
              <TableHead className="text-right">To stock</TableHead>
              <TableHead className="text-right">To expense</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Landed unit cost</TableHead>
              <TableHead className="hidden text-right xl:table-cell" title="Weighted average cost of the stock on hand">Average cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.goods_receipt_line_id} aria-label={`${l.goods_receipt_number ?? ''} ${variantLabel(l.variant)}`.trim()}>
                <TableCell>
                  <div className="font-medium">{variantLabel(l.variant)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{l.goods_receipt_number}{l.variant?.sku && ` · ${l.variant.sku}`}{l.batch && ` · batch ${l.batch.batch_number}`}</div>
                </TableCell>
                <TableCell className="hidden text-right font-mono md:table-cell">{trimDecimal(l.received_quantity)}</TableCell>
                <TableCell className="hidden text-right font-mono sm:table-cell">{trimDecimal(l.on_hand_quantity)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(l.amount)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(l.on_hand_amount)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(l.consumed_amount)}</TableCell>
                <TableCell className="hidden text-right font-mono lg:table-cell">
                  <CostChange before={l.landed_unit_cost} after={l.new_landed_unit_cost} />
                </TableCell>
                <TableCell className="hidden text-right font-mono xl:table-cell">
                  <CostChange before={l.average_cost_before} after={l.average_cost_after} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="text-right font-mono">{formatMoney(total)}</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(onHand)}</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(sold)}</TableCell>
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="hidden xl:table-cell" />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  )
}
