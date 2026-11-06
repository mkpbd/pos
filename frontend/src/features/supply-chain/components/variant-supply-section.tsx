import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Loader2Icon, PencilIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import { useBranchesQuery } from '@/features/branches/api'
import type { Product, ProductVariant } from '@/features/products/api'
import {
  SUPPLY_PERMISSIONS,
  useDeleteReorderRuleMutation,
  useDeleteSupplierProductMutation,
  useSaveReorderRulesMutation,
  useSetPreferredSupplierMutation,
  useSupplierProductsQuery,
  useVariantReorderRules,
  type CatalogVariant,
  type ReorderRule,
  type SupplierProduct,
} from '@/features/supply-chain/api'
import { SupplierProductDialog } from '@/features/supply-chain/components/supplier-product-dialog'
import { isWholeQuantity, normalizeQuantity, QUANTITY_PATTERN } from '@/features/supply-chain/quantities'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, formatMoney, trimDecimal } from '@/lib/money'

function variantName(v: ProductVariant): string | null {
  return v.name || (Object.keys(v.option_values).length ? Object.values(v.option_values).join(' / ') : null)
}

function toCatalogVariant(product: Product, v: ProductVariant): CatalogVariant {
  return { id: v.id, sku: v.sku, product_name: product.name, variant_name: variantName(v), unit: product.unit?.code ?? null, allow_decimal: product.unit?.allow_decimal ?? true }
}

// ---------------------------------------------------------------- suppliers panel

function SuppliersPanel({ variant }: { variant: CatalogVariant }) {
  const can = useCan()
  const canManage = can(SUPPLY_PERMISSIONS.managePurchasing)
  const { data, error, isPending, refetch } = useSupplierProductsQuery({ variant_id: variant.id, per_page: 50 })
  const preferred = useSetPreferredSupplierMutation()
  const remove = useDeleteSupplierProductMutation()
  const [editing, setEditing] = useState<SupplierProduct | null | undefined>(undefined)
  const [removing, setRemoving] = useState<SupplierProduct | null>(null)

  return (
    <section aria-labelledby={`suppliers-${variant.id}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`suppliers-${variant.id}`} className="text-sm font-semibold">Suppliers</h3>
        {canManage && <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> Add supplier</Button>}
      </div>
      {isPending ? (
        <LoadingState rows={2} label="Loading suppliers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No supplier catalog entries yet. Reorder suggestions need one to propose a purchase.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Pack</TableHead>
                <TableHead className="hidden text-right md:table-cell">Min order</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Lead time</TableHead>
                <TableHead className="hidden text-right md:table-cell">Last cost</TableHead>
                {canManage && <TableHead className="w-28"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((row) => {
                const supplierName = row.supplier?.name ?? 'Unknown supplier'
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {row.supplier ? <Link to={`/suppliers/${row.supplier.id}`} className="font-medium underline-offset-4 hover:underline">{supplierName}</Link> : supplierName}
                        {row.is_preferred && <Badge variant="soft"><StarIcon aria-hidden /> Preferred</Badge>}
                        {!row.is_active && <Badge variant="outline">Inactive</Badge>}
                      </div>
                      {row.supplier_sku && <div className="font-mono text-xs text-muted-foreground">{row.supplier_sku}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(row.unit_cost, undefined, 2)}</TableCell>
                    <TableCell className="hidden text-right font-mono sm:table-cell">{normalizeQuantity(row.pack_size)}</TableCell>
                    <TableCell className="hidden text-right font-mono md:table-cell">{row.min_order_qty ? normalizeQuantity(row.min_order_qty) : '—'}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{row.lead_time_days} d</TableCell>
                    <TableCell className="hidden text-right font-mono md:table-cell">{row.last_purchase_cost ? formatMoney(row.last_purchase_cost, undefined, 2) : '—'}</TableCell>
                    {canManage && (
                      <TableCell className="text-right whitespace-nowrap">
                        {!row.is_preferred && row.is_active && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Make ${supplierName} preferred`}
                            disabled={preferred.isPending}
                            onClick={() => preferred.mutate(row.id, { onSuccess: () => toast.success(`${supplierName} is now the preferred supplier.`), onError: (e) => toast.error(e.message) })}
                          >
                            <StarIcon />
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${supplierName} terms`} onClick={() => setEditing(row)}><PencilIcon /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${supplierName}`} onClick={() => setRemoving(row)}><Trash2Icon /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {canManage && <SupplierProductDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} row={editing ?? null} variant={variant} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.supplier?.name ?? 'this supplier'}?`}
        description="The supplier's catalog entry for this product is deleted; past documents are unchanged."
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id, { onSuccess: () => toast.success('Supplier removed.'), onError: (e) => toast.error(e.message), onSettled: () => setRemoving(null) })}
      />
    </section>
  )
}

// ---------------------------------------------------------------- reorder rules

type StoreInfo = { id: string; name: string; code: string; branchName: string }

function ruleError(min: string, max: string, allowDecimal: boolean): { min?: string; max?: string } {
  const errors: { min?: string; max?: string } = {}
  if (!QUANTITY_PATTERN.test(min.trim())) errors.min = 'A quantity (up to 3 decimals).'
  else if (!allowDecimal && !isWholeQuantity(min)) errors.min = 'Whole units only.'
  if (max.trim() !== '') {
    if (!QUANTITY_PATTERN.test(max.trim())) errors.max = 'A quantity (up to 3 decimals).'
    else if (!allowDecimal && !isWholeQuantity(max)) errors.max = 'Whole units only.'
    else if (!errors.min && compareDecimal(max.trim(), min.trim()) < 0) errors.max = 'At least the minimum.'
  }
  return errors
}

function RuleRow({ store, variant, rule, fallback, canManage }: { store: StoreInfo; variant: CatalogVariant; rule: ReorderRule | undefined; fallback: string; canManage: boolean }) {
  const initial = { min: rule ? normalizeQuantity(rule.min_qty) : '', max: rule?.max_qty ? normalizeQuantity(rule.max_qty) : '', active: rule?.is_active ?? true }
  const [values, setValues] = useState(initial)
  const [serverErrors, setServerErrors] = useState<{ min?: string; max?: string }>({})
  const [touched, setTouched] = useState(false)
  const save = useSaveReorderRulesMutation()
  const remove = useDeleteReorderRuleMutation()
  const dirty = values.min !== initial.min || values.max !== initial.max || values.active !== initial.active
  const errors = touched ? ruleError(values.min, values.max, variant.allow_decimal ?? true) : {}
  const shown = { min: errors.min ?? serverErrors.min, max: errors.max ?? serverErrors.max }
  const label = `${store.name} (${store.branchName})`

  const onSave = () => {
    setTouched(true)
    const local = ruleError(values.min, values.max, variant.allow_decimal ?? true)
    if (local.min || local.max) return
    setServerErrors({})
    save.mutate(
      { storeId: store.id, rules: [{ variant_id: variant.id, min_qty: values.min.trim(), max_qty: values.max.trim() || null, is_active: values.active }] },
      {
        onSuccess: () => toast.success(`Reorder rule for ${store.name} saved.`),
        onError: (e) => {
          const details = e instanceof ApiError ? e.fieldErrors : {}
          const min = details['rules.0.min_qty']?.[0]
          const max = details['rules.0.max_qty']?.[0]
          if (min || max) setServerErrors({ min, max })
          else toast.error(details['rules.0.variant_id']?.[0] ?? e.message)
        },
      },
    )
  }

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{store.name}</div>
        <div className="text-xs text-muted-foreground">{store.branchName}{!rule && ` · default: reorder at ${trimDecimal(fallback) || '0'}`}</div>
      </TableCell>
      {canManage ? (
        <>
          <TableCell className="align-top">
            <Input aria-label={`Minimum at ${label}`} inputMode="decimal" className="h-8 w-24 font-mono" placeholder={trimDecimal(fallback) || '0'} value={values.min} aria-invalid={!!shown.min || undefined} onChange={(e) => setValues({ ...values, min: e.target.value })} />
            {shown.min && <p className="mt-1 text-xs text-destructive">{shown.min}</p>}
          </TableCell>
          <TableCell className="align-top">
            <Input aria-label={`Maximum at ${label}`} inputMode="decimal" className="h-8 w-24 font-mono" placeholder="Auto" value={values.max} aria-invalid={!!shown.max || undefined} onChange={(e) => setValues({ ...values, max: e.target.value })} />
            {shown.max && <p className="mt-1 text-xs text-destructive">{shown.max}</p>}
          </TableCell>
          <TableCell className="align-top">
            <Switch aria-label={`Rule active at ${label}`} checked={values.active} onCheckedChange={(active) => setValues({ ...values, active })} className="mt-1.5" />
          </TableCell>
          <TableCell className="text-right align-top whitespace-nowrap">
            <Button type="button" size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={onSave} aria-label={`Save rule for ${label}`}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save
            </Button>
            {rule && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove rule for ${label}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(rule.id, { onSuccess: () => toast.success(`Reorder rule for ${store.name} removed.`), onError: (e) => toast.error(e.message) })}
              >
                <Trash2Icon />
              </Button>
            )}
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="font-mono">{rule ? trimDecimal(rule.min_qty) : <span className="text-muted-foreground">{trimDecimal(fallback) || '0'}</span>}</TableCell>
          <TableCell className="font-mono">{rule?.max_qty ? trimDecimal(rule.max_qty) : 'Auto'}</TableCell>
          <TableCell>{rule ? (rule.is_active ? 'Yes' : 'No') : '—'}</TableCell>
        </>
      )}
    </TableRow>
  )
}

function ReorderRulesPanel({ variant, fallback }: { variant: CatalogVariant; fallback: string }) {
  const can = useCan()
  const canManage = can(SUPPLY_PERMISSIONS.manageInventory)
  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  const stores = useMemo<StoreInfo[]>(
    () => (branches.data?.items ?? []).flatMap((b) => b.stores.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name, code: s.code, branchName: b.name }))),
    [branches.data],
  )
  const rules = useVariantReorderRules(variant.id, stores.map((s) => s.id), stores.length > 0)

  return (
    <section aria-labelledby={`rules-${variant.id}`} className="flex flex-col gap-3">
      <div>
        <h3 id={`rules-${variant.id}`} className="text-sm font-semibold">Reorder rules per store</h3>
        <p className="text-xs text-muted-foreground">Minimum = reorder point; maximum = order up to (empty: sales-based target). Without a rule, the variant's reorder level applies.</p>
      </div>
      {branches.isPending || rules.isPending ? (
        <LoadingState rows={2} label="Loading reorder rules" />
      ) : branches.error || rules.error ? (
        <ErrorState error={branches.error ?? rules.error} onRetry={() => { void branches.refetch(); rules.refetch() }} />
      ) : stores.length === 0 ? (
        <EmptyState title="No active stores" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Min</TableHead>
                <TableHead>Max</TableHead>
                <TableHead>Active</TableHead>
                {canManage && <TableHead className="w-32"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((s) => {
                const rule = rules.byStore.get(s.id)
                // Remount when the saved rule changes so the inputs show the new baseline.
                return <RuleRow key={`${s.id}:${rule?.id ?? 'none'}:${rule?.min_qty}:${rule?.max_qty}:${rule?.is_active}`} store={s} variant={variant} rule={rule} fallback={fallback} canManage={canManage} />
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- section

/** Product page: supplier catalog entries and per-store reorder rules of each variant. */
export function VariantSupplySection({ product }: { product: Product }) {
  const can = useCan()
  const showSuppliers = can(SUPPLY_PERMISSIONS.viewPurchasing)
  const showRules = can(SUPPLY_PERMISSIONS.viewInventory) && product.type === 'standard' && product.track_stock
  const variants = product.variants.filter((v) => v.is_active)
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '')
  const current = variants.find((v) => v.id === variantId) ?? variants[0]

  if ((!showSuppliers && !showRules) || !current || product.type !== 'standard') return null
  const variant = toCatalogVariant(product, current)

  return (
    <Card className="mx-auto w-full max-w-5xl">
      <CardHeader>
        <CardTitle>Suppliers & reordering</CardTitle>
        <CardDescription>Who supplies this product, at what cost and pack size, and when each store should reorder.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {variants.length > 1 && (
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor="supply-variant">Variant</Label>
            <Select value={current.id} onValueChange={setVariantId}>
              <SelectTrigger id="supply-variant" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {variants.map((v) => <SelectItem key={v.id} value={v.id}>{variantName(v) ?? v.sku} <span className="font-mono text-muted-foreground">({v.sku})</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showSuppliers && <SuppliersPanel key={`s-${variant.id}`} variant={variant} />}
        {showRules && <ReorderRulesPanel key={`r-${variant.id}`} variant={variant} fallback={current.reorder_level} />}
      </CardContent>
    </Card>
  )
}
