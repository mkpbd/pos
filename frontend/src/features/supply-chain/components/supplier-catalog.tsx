import { useState } from 'react'
import { PencilIcon, PlusIcon, SearchIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExportMenu } from '@/components/common/export-menu'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import {
  SUPPLY_PERMISSIONS,
  useDeleteSupplierProductMutation,
  useSetPreferredSupplierMutation,
  useSupplierProductsQuery,
  variantDisplayName,
  type SupplierProduct,
} from '@/features/supply-chain/api'
import { SupplierProductDialog } from '@/features/supply-chain/components/supplier-product-dialog'
import { normalizeQuantity } from '@/features/supply-chain/quantities'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/** What a supplier sells: cost per unit, packs, minimum order, lead time, preferred flag. */
export function SupplierCatalog({ supplierId, supplierName, currency }: { supplierId: string; supplierName: string; currency?: string }) {
  const can = useCan()
  const canManage = can(SUPPLY_PERMISSIONS.managePurchasing)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<SupplierProduct | null | undefined>(undefined)
  const [removing, setRemoving] = useState<SupplierProduct | null>(null)
  const term = useDebouncedValue(search)
  const filters = { supplier_id: supplierId, search: term || undefined }
  const { data, error, isPending, refetch } = useSupplierProductsQuery({ page, ...filters })
  const remove = useDeleteSupplierProductMutation()
  const preferred = useSetPreferredSupplierMutation()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search catalog" placeholder="Product, SKU or supplier SKU" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <div className="ml-auto flex gap-2">
          <ExportMenu list="supplierCatalog" query={filters} disabled={!data?.items.length} />
          {canManage && <Button onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> Add product</Button>}
        </div>
      </div>

      {isPending ? (
        <LoadingState rows={4} label="Loading catalog" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={term ? 'No matching catalog products' : 'No products in this catalog yet'} description={term ? undefined : 'Add what this supplier sells to prefill purchase orders and reorder suggestions.'} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Supplier SKU</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Pack</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Min order</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Lead time</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Last cost</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="w-28"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => {
                  const name = variantDisplayName(row.variant)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.variant?.sku}</div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">{row.supplier_sku ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(row.unit_cost, undefined, 2)}</TableCell>
                      <TableCell className="hidden text-right font-mono sm:table-cell">{normalizeQuantity(row.pack_size)}</TableCell>
                      <TableCell className="hidden text-right font-mono md:table-cell">{row.min_order_qty ? normalizeQuantity(row.min_order_qty) : '—'}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell">{row.lead_time_days} d</TableCell>
                      <TableCell className="hidden text-right font-mono lg:table-cell" title={row.last_purchased_at ? `Received ${row.last_purchased_at.slice(0, 10)}` : undefined}>
                        {row.last_purchase_cost ? formatMoney(row.last_purchase_cost, currency) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.is_preferred && <Badge variant="soft"><StarIcon aria-hidden /> Preferred</Badge>}
                          {!row.is_active && <Badge variant="outline">Inactive</Badge>}
                        </div>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right whitespace-nowrap">
                          {!row.is_preferred && row.is_active && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Make ${supplierName} the preferred supplier of ${name}`}
                              disabled={preferred.isPending}
                              onClick={() => preferred.mutate(row.id, { onSuccess: () => toast.success(`${supplierName} is now the preferred supplier of ${name}.`), onError: (e) => toast.error(e.message) })}
                            >
                              <StarIcon />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${name}`} onClick={() => setEditing(row)}><PencilIcon /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} onClick={() => setRemoving(row)}><Trash2Icon /></Button>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      {canManage && (
        <SupplierProductDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} row={editing ?? null} supplierId={supplierId} supplierName={supplierName} />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${variantDisplayName(removing?.variant)} from the catalog?`}
        description="Past purchase orders keep their prices; reorder suggestions stop proposing this supplier for it."
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => toast.success(`${variantDisplayName(removing.variant)} removed from the catalog.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setRemoving(null),
          })
        }
      />
    </div>
  )
}
