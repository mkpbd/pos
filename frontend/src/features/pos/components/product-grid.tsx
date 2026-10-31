import { PackageIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { useCatalogList } from '@/features/catalog/api'
import { itemLabel, usePosCatalogQuery, type PosItem } from '@/features/pos/api'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Top-level categories as quick filters; a category includes its sub-categories. */
export function CategoryBar({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const categories = useCatalogList('categories')
  const top = (categories.data ?? []).filter((c) => c.parent_id === null && c.is_active)
  if (top.length === 0) return null

  return (
    <div className="flex gap-1 overflow-x-auto pb-1" role="toolbar" aria-label="Categories">
      {[{ id: null, name: 'All' }, ...top].map((c) => (
        <Button key={c.id ?? 'all'} type="button" size="sm" variant={value === c.id ? 'default' : 'outline'} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          {c.name}
        </Button>
      ))}
    </div>
  )
}

function stockLabel(item: PosItem): { text: string; low: boolean } | null {
  if (item.on_hand === null) return null
  const low = item.on_hand.startsWith('-') || isZeroDecimal(item.on_hand)
  return { text: `${trimDecimal(item.on_hand)} ${item.unit_code ?? ''}`.trim(), low }
}

export function ProductGrid({
  storeId,
  categoryId,
  search,
  page,
  onPageChange,
  onPick,
}: {
  storeId: string | null
  categoryId: string | null
  search: string
  page: number
  onPageChange: (page: number) => void
  onPick: (item: PosItem) => void
}) {
  const { data, error, isPending, refetch } = usePosCatalogQuery({ store_id: storeId, category_id: categoryId ?? undefined, search: search || undefined, page })

  if (!storeId) return <EmptyState title="Choose a store" description="Select the store you are selling from." />
  if (isPending) return <LoadingState rows={6} label="Loading products" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (data.items.length === 0) return <EmptyState title="No products found" description={search ? `Nothing matches “${search}”.` : undefined} />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4" aria-label="Products">
        {data.items.map((item) => {
          const stock = stockLabel(item)
          return (
            <button
              key={item.variant_id}
              type="button"
              disabled={!item.sellable}
              onClick={() => onPick(item)}
              className="flex flex-col gap-1 rounded-lg border bg-card p-2 text-left text-sm transition-colors hover:border-primary hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            >
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-muted">
                {item.image_url ? <img src={item.image_url} alt="" className="size-full object-cover" loading="lazy" /> : <PackageIcon className="size-6 text-muted-foreground" aria-hidden />}
              </div>
              <span className="line-clamp-2 font-medium leading-tight">{itemLabel(item)}</span>
              <span className="flex items-center justify-between gap-1">
                <span className="font-mono font-semibold">{formatMoney(item.price)}</span>
                {stock && <span className={cn('text-xs', stock.low ? 'text-destructive' : 'text-muted-foreground')}>{stock.text}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {data.pagination.last_page > 1 && <PaginationBar pagination={data.pagination} onPageChange={onPageChange} />}
    </div>
  )
}
