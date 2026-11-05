import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router'
import { ImageIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="Everything you sell: goods, variants and services."
        actions={
          <>
            <ExportMenu list="products" query={productListQuery(filters)} disabled={!data?.items.length} />
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
                    <TableRow key={product.id}>
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
