import type { LabelData } from '@/features/labels/api'

/** A row on the labels page: label data plus how many labels to print. */
export type LabelItem = Omit<LabelData, 'quantity'> & { key: string; quantity: number }

/** Labels per item at most. */
export const MAX_PER_ITEM = 999

/** Whole labels: received weights ("40.500" kg) get one label, counts their number. */
export function labelCount(quantity: number | string): number {
  const n = Number(quantity)
  if (!Number.isFinite(n) || n <= 0) return 1
  if (!Number.isInteger(n)) return 1
  return Math.min(n, MAX_PER_ITEM)
}

export const itemKey = (l: LabelData) => `${l.variant_id}|${l.batch_number ?? ''}`

/** Adds labels to the list; an item already there gets the new quantity on top. */
export function mergeItems(items: LabelItem[], incoming: LabelData[]): LabelItem[] {
  const next = items.map((i) => ({ ...i }))
  for (const label of incoming) {
    const key = itemKey(label)
    const existing = next.find((i) => i.key === key)
    if (existing) existing.quantity = Math.min(existing.quantity + labelCount(label.quantity), MAX_PER_ITEM)
    else next.push({ ...label, key, quantity: labelCount(label.quantity) })
  }
  return next
}

