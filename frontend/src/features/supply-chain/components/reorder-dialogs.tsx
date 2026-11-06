import { Link } from 'react-router'
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { variantDisplayName, variantUnit, type CreatedPurchaseOrder, type CreatedTransfer } from '@/features/supply-chain/api'
import type { EffectiveRow, PurchaseGroup } from '@/features/supply-chain/reorder-lines'
import { normalizeQuantity } from '@/features/supply-chain/quantities'
import { formatMoney } from '@/lib/money'

type PurchaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeName: string
  groups: PurchaseGroup[]
  withoutSupplier: EffectiveRow[]
  currency?: string
  pending: boolean
  error: string | null
  created: CreatedPurchaseOrder[] | null
  onConfirm: () => void
}

/** Grouped preview (one draft purchase order per supplier) → confirm → links to the drafts. */
export function PurchasePreviewDialog({ open, onOpenChange, storeName, groups, withoutSupplier, currency, pending, error, created, onConfirm }: PurchaseProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Draft purchase orders created' : 'Create draft purchase orders'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'Review and place them from Purchasing → Purchase orders.'
              : `One draft per supplier, delivered to ${storeName}. Amounts are estimates — the server computes the totals.`}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <ul className="flex flex-col gap-2" aria-label="Created purchase orders">
            {created.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                  <Link to={`/purchasing/orders/${po.id}`} className="font-mono text-sm font-medium underline-offset-4 hover:underline">{po.number}</Link>
                  <span className="text-sm">{po.supplier?.name}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {po.line_count} {po.line_count === 1 ? 'line' : 'lines'} · <span className="font-mono text-foreground">{formatMoney(po.total, po.currency ?? currency)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <section key={g.supplier.id} aria-label={`Order from ${g.supplier.name}`} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{g.supplier.name} <span className="font-normal text-muted-foreground">· {g.lines.length} {g.lines.length === 1 ? 'line' : 'lines'}</span></h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit cost</TableHead>
                        <TableHead className="text-right">Estimate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.lines.map((l) => (
                        <TableRow key={l.row.row.variant.id}>
                          <TableCell>
                            <div className="font-medium">{variantDisplayName(l.row.row.variant)}</div>
                            {l.hint && !l.hint.ok && <div className="flex items-center gap-1 text-xs text-warning-soft-foreground"><AlertTriangleIcon className="size-3" aria-hidden /> {l.hint.text}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono">{l.quantity} {variantUnit(l.row.row.variant)}</TableCell>
                          <TableCell className="text-right font-mono">{l.row.unitCost ? formatMoney(l.row.unitCost, undefined, 2) : '—'}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(l.estimate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3} className="text-right">Estimated total</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatMoney(g.estimate, currency)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </section>
            ))}
            {withoutSupplier.length > 0 && (
              <div role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="font-medium">Skipped — no supplier in the catalog</div>
                <p className="text-muted-foreground">{withoutSupplier.map((r) => variantDisplayName(r.row.variant)).join(', ')}</p>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {created ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={onConfirm} disabled={pending || groups.length === 0}>
                {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Create {groups.length} draft {groups.length === 1 ? 'order' : 'orders'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TransferProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeName: string
  rows: EffectiveRow[]
  pending: boolean
  error: string | null
  created: CreatedTransfer[] | null
  onConfirm: () => void
}

const TRANSFER_STATUS: Record<string, string> = { draft: 'Draft', pending: 'Pending', in_transit: 'In transit', received: 'Received', cancelled: 'Cancelled' }

/** Confirms a replenishment transfer from the central store, then links to it. */
export function TransferDialog({ open, onOpenChange, storeName, rows, pending, error, created, onConfirm }: TransferProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Transfer created' : 'Create replenishment transfer'}</DialogTitle>
          <DialogDescription>
            {created ? 'Track it under Inventory → Transfers.' : `The items below leave the central store now (in transit) and are added to ${storeName} when it receives the transfer.`}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <ul className="flex flex-col gap-2" aria-label="Created transfers">
            {created.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-4 text-success" aria-hidden />
                  <Link to="/inventory/transfers" className="font-mono text-sm font-medium underline-offset-4 hover:underline">{t.number}</Link>
                  {t.status && <Badge variant="outline">{TRANSFER_STATUS[t.status] ?? t.status}</Badge>}
                </div>
                {t.from_store && <div className="text-sm text-muted-foreground">{t.from_store.name} → {t.to_store?.name ?? storeName}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.row.variant.id}>
                      <TableCell className="font-medium">{variantDisplayName(r.row.variant)}</TableCell>
                      <TableCell className="text-right font-mono">{normalizeQuantity(r.transfer)} {variantUnit(r.row.variant)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              <Button onClick={onConfirm} disabled={pending || rows.length === 0}>
                {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Create transfer
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
