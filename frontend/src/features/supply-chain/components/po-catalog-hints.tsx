import { useEffect, useMemo, useRef } from 'react'
import { useWatch, type Control, type UseFormSetValue } from 'react-hook-form'
import { AlertTriangleIcon, BookOpenIcon } from 'lucide-react'
import type { LinesForm } from '@/components/common/line-values'
import { Button } from '@/components/ui/button'
import { useCatalogLookupQuery, type CatalogTerms } from '@/features/supply-chain/api'
import { catalogHint, normalizeQuantity } from '@/features/supply-chain/quantities'
import { formatMoney, trimDecimal } from '@/lib/money'

type Form = LinesForm & { supplier_id: string }

/**
 * Purchase order editor: once a supplier and products are chosen, fills each line's unit cost
 * from the supplier's catalog (unless the user typed their own) and lists pack-size and
 * minimum-order hints. The catalog is advisory — the server prices the order from the lines.
 */
export function PurchaseOrderCatalogHints<T extends Form>(props: { control: Control<T>; setValue: UseFormSetValue<T>; initialSupplierId?: string }) {
  // Only the supplier and lines of the parent form are touched.
  const control = props.control as unknown as Control<Form>
  const setValue = props.setValue as unknown as UseFormSetValue<Form>
  const { initialSupplierId } = props
  const supplierId = useWatch({ control, name: 'supplier_id' })
  const watched = useWatch({ control, name: 'lines' })
  const lines = useMemo(() => watched ?? [], [watched])
  const variantIds = lines.flatMap((l) => (l.variant ? [l.variant.id] : []))
  const lookup = useCatalogLookupQuery(supplierId || null, variantIds)
  // Supplier+variant pairs already handled (lines loaded from a saved draft count as handled).
  const handled = useRef<Set<string> | null>(null)
  const autoCosts = useRef(new Map<string, Set<string>>())
  if (handled.current === null) {
    handled.current = new Set(initialSupplierId ? lines.flatMap((l) => (l.variant ? [`${initialSupplierId}|${l.variant.id}`] : [])) : [])
  }

  useEffect(() => {
    if (!lookup.data || !supplierId) return
    lines.forEach((line, i) => {
      const variant = line.variant
      if (!variant) return
      const key = `${supplierId}|${variant.id}`
      const terms = lookup.data.get(variant.id)
      if (handled.current!.has(key) || !terms?.unit_cost) return
      handled.current!.add(key)
      const cost = line.unit_cost.trim()
      const previous = autoCosts.current.get(variant.id) ?? new Set<string>()
      // Only replace an empty cost or one filled automatically (product cost price or an earlier catalog cost).
      const automatic = cost === '' || trimDecimal(cost) === trimDecimal(variant.purchase_price ?? '') || previous.has(trimDecimal(cost))
      const catalogCost = trimDecimal(terms.unit_cost)
      if (automatic && trimDecimal(cost) !== catalogCost) setValue(`lines.${i}.unit_cost`, catalogCost, { shouldDirty: true })
      previous.add(catalogCost)
      autoCosts.current.set(variant.id, previous)
    })
  }, [lookup.data, supplierId, lines, setValue])

  if (!supplierId || !lookup.data) return null
  const rows = lines
    .map((line, i) => ({ line, i, terms: line.variant ? lookup.data.get(line.variant.id) : undefined }))
    .filter((r): r is { line: (typeof lines)[number]; i: number; terms: CatalogTerms } => !!r.terms)
  if (rows.length === 0) return null

  return (
    <div role="region" aria-label="Supplier catalog terms" className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium"><BookOpenIcon className="size-4" aria-hidden /> Supplier catalog</div>
      <ul className="flex flex-col gap-1.5">
        {rows.map(({ line, i, terms }) => {
          const hint = catalogHint(line.quantity, terms.pack_size, terms.min_order_qty)
          const facts = [
            terms.unit_cost && `cost ${formatMoney(terms.unit_cost, undefined, 2)}`,
            compareOne(terms.pack_size) && `packs of ${normalizeQuantity(terms.pack_size)}`,
            terms.min_order_qty && `min ${normalizeQuantity(terms.min_order_qty)}`,
            `lead ${terms.lead_time_days} d`,
            terms.supplier_sku && `SKU ${terms.supplier_sku}`,
          ].filter(Boolean)
          return (
            <li key={`${i}-${line.variant?.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">Line {i + 1} · {line.variant?.label}</span>
              <span className="text-muted-foreground">{facts.join(' · ')}</span>
              {hint && !hint.ok && (
                <span className="inline-flex items-center gap-1 text-warning-soft-foreground">
                  <AlertTriangleIcon className="size-3.5" aria-hidden /> {hint.text}
                  {hint.rounded && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setValue(`lines.${i}.quantity`, hint.rounded as string, { shouldDirty: true, shouldValidate: true })}>
                      Use {hint.rounded}
                    </Button>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A pack size worth mentioning (anything but one unit). */
function compareOne(pack: string | null | undefined): boolean {
  return !!pack && normalizeQuantity(pack) !== '1'
}
