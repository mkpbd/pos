import { useMemo, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import type { LabelSource } from '@/features/labels/api'
import { PO_STATUS, usePurchaseOrdersQuery, useReceiptsQuery, type GoodsReceipt, type PurchaseOrder } from '@/features/purchasing/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type AddProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the chosen source; the page fetches the labels and closes the dialog. */
  onAdd: (source: LabelSource) => void
  pending: boolean
}

function DocumentList<T extends GoodsReceipt | PurchaseOrder>({
  query,
  kind,
  onAdd,
  pending,
}: {
  query: { data?: { items: T[] }; error: unknown; isPending: boolean; refetch: () => unknown }
  kind: 'receipt' | 'order'
  onAdd: (doc: T) => void
  pending: boolean
}) {
  if (query.isPending) return <LoadingState rows={3} label={kind === 'receipt' ? 'Loading receipts' : 'Loading orders'} />
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (query.data.items.length === 0) return <EmptyState title={kind === 'receipt' ? 'No receipts found' : 'No orders found'} />

  return (
    <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border" aria-label={kind === 'receipt' ? 'Goods receipts' : 'Purchase orders'}>
      {query.data.items.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 p-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium">{doc.number}</div>
            <div className="truncate text-xs text-muted-foreground">
              {doc.supplier?.name ?? '—'} · {'invoice_date' in doc ? doc.invoice_date : doc.order_date}
              {'status' in doc && ` · ${PO_STATUS[doc.status].label}`}
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onAdd(doc)} aria-label={`Add labels from ${doc.number}`}>
            Add
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** "Add from goods receipt / purchase order": received or ordered quantities become label counts. */
export function AddFromDocumentDialog({ open, onOpenChange, onAdd, pending }: AddProps) {
  const [tab, setTab] = useState<'receipt' | 'order'>('receipt')
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search, 300)
  const receipts = useReceiptsQuery({ page: 1, per_page: 15, search: term || undefined })
  const orders = usePurchaseOrdersQuery({ page: 1, per_page: 15, search: term || undefined })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add from a receipt or order</DialogTitle>
          <DialogDescription>One label per received unit (receipts) or ordered unit (orders); change the counts afterwards.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'receipt' | 'order')}>
          <TabsList>
            <TabsTrigger value="receipt">Goods receipts</TabsTrigger>
            <TabsTrigger value="order">Purchase orders</TabsTrigger>
          </TabsList>
          <Input className="mt-3" aria-label="Search documents" placeholder={tab === 'receipt' ? 'Receipt or supplier invoice number' : 'Order number'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <TabsContent value="receipt" className="mt-3">
            <DocumentList query={receipts} kind="receipt" pending={pending} onAdd={(doc) => onAdd({ goods_receipt_id: doc.id })} />
          </TabsContent>
          <TabsContent value="order" className="mt-3">
            <DocumentList query={orders} kind="order" pending={pending} onAdd={(doc) => onAdd({ purchase_order_id: doc.id })} />
          </TabsContent>
        </Tabs>
        {pending && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2Icon className="size-4 animate-spin" /> Adding…</p>}
      </DialogContent>
    </Dialog>
  )
}

/** "Add from category": every active variant in the category (and its sub-categories, as the API decides). */
export function AddFromCategoryDialog({ open, onOpenChange, onAdd, pending }: AddProps) {
  const categories = useCatalogList('categories', open)
  const tree = useMemo(() => flattenCategoryTree(categories.data ?? []), [categories.data])
  const [categoryId, setCategoryId] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add from a category</DialogTitle>
          <DialogDescription>Adds one label for each product in the category.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label-category">Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="label-category" className="w-full"><SelectValue placeholder={categories.isPending ? 'Loading…' : 'Choose a category'} /></SelectTrigger>
            <SelectContent>
              {tree.map((c) => <SelectItem key={c.id} value={c.id}>{c.path}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!categoryId || pending} onClick={() => onAdd({ category_id: categoryId })}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Add products
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
