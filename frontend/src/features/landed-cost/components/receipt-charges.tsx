import { Link } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { GoodsReceipt } from '@/features/purchasing/api'
import { allocationLabel, chargeTypeLabel, sumMoney } from '@/features/landed-cost/allocation'
import { hasLandedCosts } from '@/features/landed-cost/charges'
import { formatMoney } from '@/lib/money'

/** Read-only charges of a posted receipt with goods, charges and landed totals (server figures). */
export function ReceiptCharges({ receipt }: { receipt: GoodsReceipt }) {
  const charges = receipt.charges ?? []
  const vouchers = receipt.landed_cost_vouchers ?? []
  if (!hasLandedCosts(receipt)) return null

  const goods = receipt.goods_total ?? receipt.subtotal
  const chargesTotal = receipt.charges_total ?? sumMoney(charges.map((c) => c.amount))
  const landed = receipt.landed_total ?? sumMoney([goods, chargesTotal])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Charges and landed cost</CardTitle>
        <CardDescription>Charge amounts are spread over the lines and included in the stock cost; tax on charges is recoverable.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {charges.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Receipt charges">
              <TableHeader>
                <TableRow>
                  <TableHead>Charge</TableHead>
                  <TableHead className="hidden sm:table-cell">Billed by</TableHead>
                  <TableHead className="hidden md:table-cell">Allocation</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Tax</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{chargeTypeLabel(c.type)}</div>
                      {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{c.charge_supplier?.name ?? 'This invoice'}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{allocationLabel(c.allocation)}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(c.amount)}</TableCell>
                    <TableCell className="hidden text-right font-mono sm:table-cell">{formatMoney(c.tax_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted-foreground">Goods total</dt><dd className="font-mono font-medium">{formatMoney(goods, receipt.currency)}</dd></div>
          <div><dt className="text-muted-foreground">Charges total</dt><dd className="font-mono font-medium">{formatMoney(chargesTotal, receipt.currency)}</dd></div>
          <div><dt className="text-muted-foreground">Landed total</dt><dd className="font-mono font-semibold" data-testid="receipt-landed-total">{formatMoney(landed, receipt.currency)}</dd></div>
          {receipt.payable_total && (
            <div><dt className="text-muted-foreground">Payable to {receipt.supplier?.name ?? 'supplier'}</dt><dd className="font-mono font-medium" data-testid="receipt-payable-total">{formatMoney(receipt.payable_total, receipt.currency)}</dd></div>
          )}
        </dl>
        {vouchers.length > 0 && (
          <div className="text-sm">
            <div className="text-muted-foreground">Landed cost vouchers posted later</div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1" aria-label="Landed cost vouchers">
              {vouchers.map((v) => (
                <li key={v.id}>
                  <Link to={`/purchasing/landed-costs/${v.id}`} className="font-mono underline-offset-4 hover:underline">{v.number}</Link>
                  {v.amount && <span className="ml-1 font-mono text-muted-foreground">{formatMoney(v.amount)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
