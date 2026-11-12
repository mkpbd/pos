/*
 * B8a: a plain note under a data element's form when the store has nothing to show for it now
 * (no flash sale running, no matching reviews, bundle products no longer sold, a comparison
 * column's product unavailable). It asks POST /builder/resolve for this element, like the canvas.
 */

import { useQuery } from '@tanstack/react-query'
import { InfoIcon } from 'lucide-react'
import type { ComparisonTableData, Element, ElementDataState, FlashSaleBarData, ReviewWallData } from '@/storefront/builder/types'
import { resolvePreview } from '../api'
import { resolveInput, resolveKey } from '../render-tree'

function messages(node: Element, data: unknown): string[] {
  const state = (data as { state?: ElementDataState } | null)?.state
  switch (node.type) {
    case 'flash_sale_bar': {
      const promotion = (data as FlashSaleBarData | null)?.promotion
      const sale = promotion?.state ?? state
      if (!data || sale === 'empty' || sale === 'inactive') return ['No flash sale is running — this bar stays hidden on your shop until one runs.']
      if (sale === 'expired') return ['This sale has ended — the bar stays hidden on your shop. Choose another sale or “The sale that ends soonest”.']
      if (sale === 'scheduled') return ['This sale hasn’t started yet — the bar appears on your shop when it starts.']
      if (sale === 'unavailable') return ['This sale can’t be shown on your shop now.']
      return []
    }
    case 'review_wall':
      return !data || state === 'empty' || (data as ReviewWallData).reviews?.length === 0 ? ['No matching approved reviews yet — this stays hidden on your shop until there are some.'] : []
    case 'bundle':
      return state === 'unavailable' || state === 'empty' ? ['Fewer than 2 of these products are sold online now, so the bundle stays hidden on your shop.'] : []
    case 'comparison_table': {
      const columns = (data as ComparisonTableData | null)?.columns
      if (!columns || Array.isArray(columns)) return []
      return node.props.columns
        .filter((c) => columns[c.id]?.state === 'unavailable')
        .map((c) => `“${c.title || 'Column'}”: its product isn’t sold online now, so the column shows its title only.`)
    }
    default:
      return []
  }
}

/** Notes about what the store shows for this element now (nothing while loading or offline). */
export function DataStateHint({ node }: { node: Element }) {
  const query = useQuery({
    queryKey: ['store-builder', 'element-data', resolveKey(node)] as const,
    queryFn: ({ signal }) => resolvePreview({ elements: [resolveInput(node)], media_ids: [] }, signal).then((result) => result.data[node.id] ?? null),
    staleTime: 30_000,
    retry: false,
  })
  if (!query.isSuccess) return null
  const notes = messages(node, query.data)
  if (notes.length === 0) return null
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100" data-testid="data-state-hint">
      {notes.map((note) => (
        <p key={note} className="flex gap-1.5">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{note}</span>
        </p>
      ))}
    </div>
  )
}
