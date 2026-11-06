import type { CatalogTerms, ReorderSuggestion } from '@/features/supply-chain/api'
import { catalogHint, isPositiveQuantity, isWholeQuantity, lineEstimate, normalizeQuantity, sumAmounts } from '@/features/supply-chain/quantities'

/** What the user changed on a suggestion row (everything else comes from the server). */
export type RowEdit = {
  purchase?: string
  transfer?: string
  /** Another catalog supplier chosen for the row, with its terms. */
  supplier?: { id: string; name: string; unit_cost: string | null; pack_size: string | null; min_order_qty: string | null }
}

export type EffectiveRow = {
  row: ReorderSuggestion
  purchase: string
  transfer: string
  supplier: { id: string; name: string } | null
  unitCost: string | null
  packSize: string | null
  minOrder: string | null
}

export function effectiveRow(row: ReorderSuggestion, edit: RowEdit | undefined, terms?: CatalogTerms): EffectiveRow {
  const swapped = edit?.supplier
  return {
    row,
    purchase: edit?.purchase ?? normalizeQuantity(row.suggested_purchase),
    transfer: edit?.transfer ?? normalizeQuantity(row.suggested_transfer),
    supplier: swapped ? { id: swapped.id, name: swapped.name } : row.supplier,
    unitCost: swapped ? swapped.unit_cost : row.unit_cost,
    packSize: swapped ? swapped.pack_size : (row.pack_size ?? terms?.pack_size ?? null),
    minOrder: swapped ? swapped.min_order_qty : (row.min_order_qty ?? terms?.min_order_qty ?? null),
  }
}

/** Error for a typed quantity, or null. Empty and zero mean "skip this row". */
export function quantityError(value: string, allowDecimal: boolean | undefined): string | null {
  const v = value.trim()
  if (v === '' || /^0*(\.0*)?$/.test(v)) return null
  if (!isPositiveQuantity(v)) return 'A positive quantity (up to 3 decimals).'
  if (allowDecimal === false && !isWholeQuantity(v)) return 'Whole units only.'
  return null
}

export const wants = (value: string): boolean => isPositiveQuantity(value.trim())

export type PurchaseGroup = {
  supplier: { id: string; name: string }
  lines: { row: EffectiveRow; quantity: string; estimate: string; hint: ReturnType<typeof catalogHint> }[]
  estimate: string
}

/** Selected rows with a purchase quantity, grouped by supplier; rows without a supplier are returned apart. */
export function groupPurchases(rows: EffectiveRow[]): { groups: PurchaseGroup[]; withoutSupplier: EffectiveRow[] } {
  const groups = new Map<string, PurchaseGroup>()
  const withoutSupplier: EffectiveRow[] = []
  for (const r of rows) {
    if (!wants(r.purchase)) continue
    if (!r.supplier) {
      withoutSupplier.push(r)
      continue
    }
    const group = groups.get(r.supplier.id) ?? { supplier: r.supplier, lines: [], estimate: '0.00' }
    const quantity = normalizeQuantity(r.purchase)
    group.lines.push({ row: r, quantity, estimate: lineEstimate(quantity, r.unitCost), hint: catalogHint(quantity, r.packSize, r.minOrder) })
    group.estimate = sumAmounts(group.lines.map((l) => l.estimate))
    groups.set(r.supplier.id, group)
  }
  return { groups: [...groups.values()].sort((a, b) => a.supplier.name.localeCompare(b.supplier.name)), withoutSupplier }
}
