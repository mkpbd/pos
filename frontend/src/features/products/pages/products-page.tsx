import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate } from 'react-router'
import { ImageIcon, PlusIcon, SearchIcon, SparklesIcon, TagIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import { ImportButton } from '@/features/imports/components/import-button'
import { AI_HELP_PATH, aiSwitchedOn, MAX_BATCH_SUBJECTS } from '@/features/online-catalog/ai-help/model'
import { productListQuery, useProductsQuery, useRestoreProductMutation } from '@/features/products/api'
import { formatRange } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

export function ProductsPage() {
  const me = useAuth()
  const can = useCan()
  const canEdit = can('products.manage') && can('products.view_cost')
  // Online store staff without product editing still reach the web listing.
  const canListOnline = can('online_catalog.view')
  // AI2a: "Write AI drafts" for the chosen products (AI on, online_catalog.manage).
  const canWriteDrafts = aiSwitchedOn(me) && can('online_catalog.manage')
  const navigate = useNavigate()
  const [chosen, setChosen] = useState<{ id: string; name: string }[]>([])
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [archived, setArchived] = useState(false)
  const debouncedSearch = useDebouncedValue(search)
  const categories = useCatalogList('categories')
  const tree = useMemo(() => flattenCategoryTree(categories.data ?? []), [categories.data])
  const currency = me.organization?.base_currency
  const restore = useRestoreProductMutation()

  const filters = { search: debouncedSearch || undefined, category_id: categoryId === ALL ? undefined : categoryId, archived }
  const { data, error, isPending, refetch } = useProductsQuery({ page, ...filters })
  const selectable = canWriteDrafts && !archived ? (data?.items ?? []) : []
  const showSelect = selectable.length > 0
  const pageAllChosen = showSelect && selectable.every((p) => chosen.some((c) => c.id === p.id))
  const pageSomeChosen = selectable.some((p) => chosen.some((c) => c.id === p.id))
  const toggle = (product: { id: string; name: string }, on: boolean) =>
    setChosen((list) => (on ? (list.length >= MAX_BATCH_SUBJECTS || list.some((c) => c.id === product.id) ? list : [...list, { id: product.id, name: product.name }]) : list.filter((c) => c.id !== product.id)))
  const togglePage = (on: boolean) =>
    setChosen((list) =>
      on
        ? [...list, ...selectable.filter((p) => !list.some((c) => c.id === p.id)).map((p) => ({ id: p.id, name: p.name }))].slice(0, MAX_BATCH_SUBJECTS)
        : list.filter((c) => !selectable.some((p) => p.id === c.id)),
    )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="Everything you sell: goods, variants and services."
        actions={
          <>
            <ExportMenu list="products" query={productListQuery(filters)} disabled={!data?.items.length} />
            <Button asChild variant="outline"><Link to="/products/labels"><TagIcon data-icon="inline-start" /> Print labels</Link></Button>
            <ImportButton type="products" label="Import products" />
            <ImportButton type="price_update" label="Update prices" />
            {canEdit && (
              <Button asChild>
                <Link to="/products/new"><PlusIcon data-icon="inline-start" /> New product</Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search products" placeholder="Name, SKU or scan a barcode" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setPage(1) }}>
          <SelectTrigger aria-label="Filter by category" className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {tree.map((c) => <SelectItem key={c.id} value={c.id}>{c.path}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={archived} onCheckedChange={(v) => { setArchived(v); setPage(1) }} />
          <Label htmlFor="show-archived" className="font-normal">Archived</Label>
        </div>
      </div>

      {canWriteDrafts && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2" role="region" aria-label="Bulk actions">
          <span className="px-1 text-sm font-medium" aria-live="polite">{chosen.length} selected{chosen.length >= MAX_BATCH_SUBJECTS && ` (the most for one run)`}</span>
          <Button size="sm" onClick={() => navigate(`${AI_HELP_PATH}?tab=drafts`, { state: { aiDraftProducts: chosen } })}>
            <SparklesIcon data-icon="inline-start" /> Write AI drafts
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChosen([])}>Clear</Button>
        </div>
      )}

      {isPending ? (
        <LoadingState rows={6} label="Loading products" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={archived ? 'No archived products' : 'No products found'}
          description={search ? 'Try another name, SKU or barcode.' : undefined}
          action={canEdit && !archived && !search ? <Button asChild variant="outline"><Link to="/products/new">Add your first product</Link></Button> : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {showSelect && (
                    <TableHead className="w-10">
                      <Checkbox aria-label="Select all products on this page" checked={pageAllChosen ? true : pageSomeChosen ? 'indeterminate' : false} onCheckedChange={(v) => togglePage(v === true)} />
                    </TableHead>
                  )}
                  <TableHead className="w-14"><span className="sr-only">Image</span></TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="hidden sm:table-cell">Variants</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((product) => {
                  const first = product.variants[0]
                  const thumb = product.images[0]?.url
                  return (
                    <TableRow key={product.id} data-state={chosen.some((c) => c.id === product.id) ? 'selected' : undefined}>
                      {showSelect && (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${product.name}`}
                            checked={chosen.some((c) => c.id === product.id)}
                            disabled={chosen.length >= MAX_BATCH_SUBJECTS && !chosen.some((c) => c.id === product.id)}
                            onCheckedChange={(v) => toggle(product, v === true)}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        {thumb ? (
                          <img src={thumb} alt="" className="size-10 rounded object-cover" loading="lazy" />
                        ) : (
                          <div className="flex size-10 items-center justify-center rounded bg-muted"><ImageIcon className="size-4 text-muted-foreground" aria-hidden /></div>
                        )}
                      </TableCell>
                      <TableCell>
                        {canEdit && !product.archived_at ? (
                          <Link to={`/products/${product.id}`} className="font-medium underline-offset-4 hover:underline">{product.name}</Link>
                        ) : canListOnline && !product.archived_at ? (
                          <Link to={`/products/${product.id}/online-store`} className="font-medium underline-offset-4 hover:underline">{product.name}</Link>
                        ) : (
                          <span className="font-medium">{product.name}</span>
                        )}
                        <div className="font-mono text-xs text-muted-foreground">
                          {first?.sku}{product.variants.length > 1 && ` +${product.variants.length - 1}`}
                          {product.type === 'service' && <Badge variant="outline" className="ml-2">Service</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{product.category?.name ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm whitespace-nowrap">{formatRange(product.variants.map((v) => v.selling_price), currency)}</TableCell>
                      <TableCell className="hidden sm:table-cell">{product.variants.length}</TableCell>
                      <TableCell>
                        {product.archived_at ? (
                          canEdit ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={restore.isPending}
                              onClick={() => restore.mutate(product.id, { onSuccess: (p) => toast.success(`${p.name} restored.`), onError: (e) => toast.error(e.message) })}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Badge variant="outline">Archived</Badge>
                          )
                        ) : (
                          <Badge variant={product.is_active ? 'success' : 'outline'}>{product.is_active ? 'Active' : 'Inactive'}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
