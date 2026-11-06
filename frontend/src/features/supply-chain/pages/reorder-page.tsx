import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightLeftIcon, ClipboardListIcon, SearchIcon, ShoppingCartIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useBranchesQuery } from '@/features/branches/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { useIdempotencyKey } from '@/features/returns/api'
import { useSuppliersQuery } from '@/features/suppliers/api'
import {
  SUPPLY_PERMISSIONS,
  suggestionListQuery,
  useCatalogLookups,
  useCreatePurchaseOrdersMutation,
  useCreateTransfersMutation,
  useReorderSuggestionsQuery,
  useReplenishmentSettingsQuery,
  useSupplierProductsQuery,
  variantDisplayName,
  variantUnit,
  type CreatedPurchaseOrder,
  type CreatedTransfer,
  type ReorderSuggestion,
  type SuggestionFilter,
} from '@/features/supply-chain/api'
import { PurchasePreviewDialog, TransferDialog } from '@/features/supply-chain/components/reorder-dialogs'
import { PROCUREMENT_PERMISSIONS } from '@/features/procurement/api'
import { RaiseRequisitionDialog } from '@/features/procurement/components/raise-requisition-dialog'
import { catalogHint, normalizeQuantity } from '@/features/supply-chain/quantities'
import { effectiveRow, groupPurchases, quantityError, wants, type EffectiveRow, type RowEdit } from '@/features/supply-chain/reorder-lines'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useSessionStore } from '@/stores/session-store'

const ALL = '__all__'

const FILTERS: { value: SuggestionFilter; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'all', label: 'All' },
]

/** The active branch's first selling store (else its first store, else any store). */
function useDefaultStore(): { storeId: string | null; storeName: (id: string | null) => string } {
  const branchId = useSessionStore((s) => s.activeBranchId)
  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  return useMemo(() => {
    const list = branches.data?.items ?? []
    const active = (stores: (typeof list)[number]['stores']) => stores.filter((s) => s.is_active)
    const branch = list.find((b) => b.id === branchId) ?? list[0]
    const candidates = branch ? active(branch.stores) : []
    const store = candidates.find((s) => s.type !== 'warehouse') ?? candidates[0] ?? list.flatMap((b) => active(b.stores))[0]
    const names = new Map(list.flatMap((b) => b.stores.map((s) => [s.id, s.name] as const)))
    return { storeId: store?.id ?? null, storeName: (id: string | null) => (id && names.get(id)) || 'the store' }
  }, [branches.data, branchId])
}

function SupplierFilter({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const suppliers = useSuppliersQuery({ page: 1 })
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className="w-full sm:w-56" aria-label="Filter by supplier"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All suppliers</SelectItem>
        {(suppliers.data?.items ?? []).filter((s) => s.is_active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Supplier of one suggestion row, switchable to any other active catalog supplier of the variant. */
function RowSupplierSelect({ row, current, onChange }: { row: ReorderSuggestion; current: { id: string; name: string } | null; onChange: (edit: NonNullable<RowEdit['supplier']>) => void }) {
  const [open, setOpen] = useState(false)
  const catalog = useSupplierProductsQuery({ variant_id: row.variant.id, per_page: 50 }, open)
  const options = (catalog.data?.items ?? []).filter((c) => c.is_active && c.supplier && c.supplier.id !== current?.id)
  const name = variantDisplayName(row.variant)

  if (!current && !open && (catalog.data?.items.length ?? 1) === 0) return <span className="text-xs text-muted-foreground">No supplier</span>

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={current?.id ?? ''}
      onValueChange={(id) => {
        const entry = catalog.data?.items.find((c) => c.supplier?.id === id)
        if (entry?.supplier) onChange({ id: entry.supplier.id, name: entry.supplier.name, unit_cost: entry.unit_cost, pack_size: entry.pack_size, min_order_qty: entry.min_order_qty })
      }}
    >
      <SelectTrigger size="sm" className="w-full min-w-36" aria-label={`Supplier of ${name}`}>
        <SelectValue placeholder="No supplier" />
      </SelectTrigger>
      <SelectContent>
        {current && <SelectItem value={current.id}>{current.name}</SelectItem>}
        {catalog.isPending && open ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading catalog…</div>
        ) : (
          options.map((c) => (
            <SelectItem key={c.id} value={c.supplier!.id}>
              {c.supplier!.name} <span className="text-muted-foreground">· {formatMoney(c.unit_cost, undefined, 2)}{c.is_preferred ? ' · preferred' : ''}</span>
            </SelectItem>
          ))
        )}
        {!catalog.isPending && options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No other catalog suppliers</div>}
      </SelectContent>
    </Select>
  )
}

function QuantityInput({ label, value, allowDecimal, hint, onChange }: { label: string; value: string; allowDecimal?: boolean; hint?: ReturnType<typeof catalogHint>; onChange: (value: string) => void }) {
  const error = quantityError(value, allowDecimal)
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <Input aria-label={label} inputMode="decimal" className="h-8 text-right font-mono" value={value} aria-invalid={!!error || undefined} onChange={(e) => onChange(e.target.value)} />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        hint.ok ? (
          <p className="text-xs text-muted-foreground">{hint.text}</p>
        ) : (
          <button type="button" className="text-left text-xs text-warning-soft-foreground underline-offset-2 hover:underline" onClick={() => hint.rounded && onChange(hint.rounded)}>
            {hint.text}
          </button>
        )
      ) : null}
    </div>
  )
}

/** Where replenishment transfers come from (the central store in the replenishment settings). */
function TransferSourceNote() {
  const can = useCan()
  const settings = useReplenishmentSettingsQuery(can(SUPPLY_PERMISSIONS.viewInventory))
  const source = settings.data?.source_store
  const link = can(SUPPLY_PERMISSIONS.manageInventory) ? <Link to="/inventory/settings" className="underline underline-offset-4">Inventory → Settings</Link> : 'Inventory → Settings'
  return (
    <p className="mb-3 text-sm text-muted-foreground">
      {settings.data && !settings.data.source_store_id ? (
        <>No central store is set, so nothing is suggested for transfer. Choose one under {link}.</>
      ) : (
        <>Transfers come from {source ? <span className="font-medium text-foreground">{source.name}</span> : 'the central store'} (set under {link}) when it has stock above its own reorder point.</>
      )}
    </p>
  )
}

/** Purchasing → Reorder: what each store should buy or pull from the central store. */
export function ReorderPage() {
  const me = useAuth()
  const can = useCan()
  const canPurchase = can(SUPPLY_PERMISSIONS.managePurchasing)
  // Staff who cannot order directly raise a requisition for approval instead (SC2).
  const canRequisition = !canPurchase && can(PROCUREMENT_PERMISSIONS.request)
  const canEditPurchase = canPurchase || canRequisition
  const canTransfer = can(SUPPLY_PERMISSIONS.transfer)
  const canAct = canEditPurchase || canTransfer
  const currency = me.organization?.base_currency

  const defaults = useDefaultStore()
  const [storeChoice, setStoreChoice] = useState<string | null>(null)
  const storeId = storeChoice ?? defaults.storeId
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SuggestionFilter>('purchase')
  const [page, setPage] = useState(1)
  const term = useDebouncedValue(search)
  const filters = suggestionListQuery({ storeId, supplierId, search: term, filter })
  const { data, error, isPending, isFetching, refetch } = useReorderSuggestionsQuery({ ...filters, page })

  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [selected, setSelected] = useState<Map<string, ReorderSuggestion>>(new Map())
  const [dialog, setDialog] = useState<'purchase' | 'transfer' | 'requisition' | null>(null)
  const [createdOrders, setCreatedOrders] = useState<CreatedPurchaseOrder[] | null>(null)
  const [createdTransfers, setCreatedTransfers] = useState<CreatedTransfer[] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const createOrders = useCreatePurchaseOrdersMutation()
  const createTransfers = useCreateTransfersMutation()
  const orderKey = useIdempotencyKey()
  const transferKey = useIdempotencyKey()

  const items = useMemo(() => data?.items ?? [], [data])
  // Pack sizes and minimums of the suggested suppliers (when the rows do not carry them).
  const lookupGroups = useMemo(() => {
    const bySupplier = new Map<string, string[]>()
    items.filter((r) => r.supplier && r.pack_size === undefined).forEach((r) => bySupplier.set(r.supplier!.id, [...(bySupplier.get(r.supplier!.id) ?? []), r.variant.id]))
    return [...bySupplier].map(([id, variantIds]) => ({ supplierId: id, variantIds }))
  }, [items])
  const terms = useCatalogLookups(lookupGroups)
  const effective = (row: ReorderSuggestion): EffectiveRow => effectiveRow(row, edits[row.variant.id], row.supplier ? terms.get(row.supplier.id)?.get(row.variant.id) : undefined)
  const edit = (variantId: string, patch: RowEdit) => setEdits((e) => ({ ...e, [variantId]: { ...e[variantId], ...patch } }))

  const selectedRows = [...selected.values()].map(effective)
  const invalid = selectedRows.filter((r) => quantityError(r.purchase, r.row.variant.allow_decimal) || quantityError(r.transfer, r.row.variant.allow_decimal))
  const purchases = groupPurchases(selectedRows)
  const transferRows = selectedRows.filter((r) => wants(r.transfer))
  const storeName = defaults.storeName(storeId)

  const allOnPage = items.length > 0 && items.every((r) => selected.has(r.variant.id))
  const someOnPage = items.some((r) => selected.has(r.variant.id))
  const toggle = (row: ReorderSuggestion, on: boolean) =>
    setSelected((s) => {
      const next = new Map(s)
      if (on) next.set(row.variant.id, row)
      else next.delete(row.variant.id)
      return next
    })
  const togglePage = (on: boolean) =>
    setSelected((s) => {
      const next = new Map(s)
      items.forEach((r) => (on ? next.set(r.variant.id, r) : next.delete(r.variant.id)))
      return next
    })

  const forget = (variantIds: string[]) => {
    setSelected((s) => {
      const next = new Map(s)
      variantIds.forEach((id) => next.delete(id))
      return next
    })
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => !variantIds.includes(id))))
  }

  const openDialog = (kind: 'purchase' | 'transfer' | 'requisition') => {
    if (invalid.length > 0) {
      toast.error(`Fix the quantity of ${variantDisplayName(invalid[0]!.row.variant)} first.`)
      return
    }
    setActionError(null)
    setCreatedOrders(null)
    setCreatedTransfers(null)
    setDialog(kind)
  }

  const submitOrders = () => {
    if (!storeId) return
    const input = {
      store_id: storeId,
      lines: purchases.groups.flatMap((g) => g.lines.map((l) => ({ variant_id: l.row.row.variant.id, supplier_id: g.supplier.id, quantity: l.quantity, unit_cost: l.row.unitCost ?? '0' }))),
    }
    setActionError(null)
    createOrders.mutate({ input, idempotencyKey: orderKey.keyFor(input) }, {
      onSuccess: (orders) => {
        orderKey.settle()
        setCreatedOrders(orders)
        forget(input.lines.map((l) => l.variant_id))
        toast.success(`${orders.length} draft purchase ${orders.length === 1 ? 'order' : 'orders'} created.`)
      },
      onError: (e) => {
        orderKey.settle(e)
        setActionError(e.message)
      },
    })
  }

  const submitTransfers = () => {
    if (!storeId) return
    const input = { store_id: storeId, lines: transferRows.map((r) => ({ variant_id: r.row.variant.id, quantity: normalizeQuantity(r.transfer) })) }
    setActionError(null)
    createTransfers.mutate({ input, idempotencyKey: transferKey.keyFor(input) }, {
      onSuccess: (transfers) => {
        transferKey.settle()
        setCreatedTransfers(transfers)
        forget(input.lines.map((l) => l.variant_id))
        toast.success(transfers.length === 1 ? `Transfer ${transfers[0]!.number} created.` : 'Transfer created.')
      },
      onError: (e) => {
        transferKey.settle(e)
        setActionError(e.message)
      },
    })
  }

  // A different store means different suggestions: start over.
  const changeStore = (id: string) => {
    if (id === storeId) return
    setStoreChoice(id)
    setPage(1)
    setEdits({})
    setSelected(new Map())
  }

  const showPurchase = filter !== 'transfer'
  const showTransfer = filter !== 'purchase'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Reorder suggestions from stock, open orders, transfers and recent sales."
        actions={
          <>
            <ExportMenu list="reorderSuggestions" query={filters} disabled={!storeId || !data?.items.length} />
            {canTransfer && (
              <Button variant="outline" disabled={transferRows.length === 0} onClick={() => openDialog('transfer')}>
                <ArrowRightLeftIcon data-icon="inline-start" /> Create transfers
              </Button>
            )}
            {canPurchase && (
              <Button disabled={purchases.groups.length === 0 && purchases.withoutSupplier.length === 0} onClick={() => openDialog('purchase')}>
                <ShoppingCartIcon data-icon="inline-start" /> Create purchase orders
              </Button>
            )}
            {canRequisition && (
              <Button disabled={!selectedRows.some((r) => wants(r.purchase))} onClick={() => openDialog('requisition')}>
                <ClipboardListIcon data-icon="inline-start" /> Raise requisition
              </Button>
            )}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-56">
          <StoreSelect value={storeId} onChange={changeStore} aria-label="Store" />
        </div>
        <SupplierFilter value={supplierId} onChange={(id) => { setSupplierId(id); setPage(1) }} />
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search suggestions" placeholder="Product or SKU" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => { setFilter(v as SuggestionFilter); setPage(1) }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="Suggestion type">
            {FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}
          </TabsList>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 text-sm" aria-live="polite">
              <span>{selected.size} selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>Clear selection</Button>
            </div>
          )}
        </div>
        <TabsContent value={filter} className="pt-3">
          {filter === 'transfer' && <TransferSourceNote />}
          {!storeId ? (
            <EmptyState title="Choose a store" description="Suggestions are calculated per store." />
          ) : isPending ? (
            <LoadingState rows={6} label="Loading reorder suggestions" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title={`Nothing needs reordering at ${storeName}`} description={term || supplierId ? 'Try clearing the search or supplier filter.' : undefined} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border" aria-busy={isFetching || undefined}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canAct && (
                        <TableHead className="w-10">
                          <Checkbox aria-label="Select all on this page" checked={allOnPage ? true : someOnPage ? 'indeterminate' : false} onCheckedChange={(v) => togglePage(v === true)} />
                        </TableHead>
                      )}
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="hidden text-right md:table-cell">On order</TableHead>
                      <TableHead className="hidden text-right md:table-cell">In transit</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Avg / day</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Cover</TableHead>
                      {showPurchase && <TableHead className="text-right">Buy</TableHead>}
                      {showPurchase && <TableHead>Supplier</TableHead>}
                      {showPurchase && <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>}
                      {showTransfer && <TableHead className="text-right">Transfer</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((row) => {
                      const r = effective(row)
                      const name = variantDisplayName(row.variant)
                      const unit = variantUnit(row.variant)
                      return (
                        <TableRow key={row.variant.id} data-state={selected.has(row.variant.id) ? 'selected' : undefined}>
                          {canAct && (
                            <TableCell>
                              <Checkbox aria-label={`Select ${name}`} checked={selected.has(row.variant.id)} onCheckedChange={(v) => toggle(row, v === true)} />
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="font-medium">{name}</div>
                            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                              <span className="font-mono">{row.variant.sku}</span>
                              <Badge variant={row.reason === 'below_min' ? 'warning' : 'info'}>{row.reason === 'below_min' ? 'Below minimum' : 'Sales velocity'}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">Reorder at {trimDecimal(row.reorder_point)} · up to {trimDecimal(row.target)} {unit}</div>
                            {row.draft_on_order && !isZeroDecimal(row.draft_on_order) && (
                              <div className="text-xs text-warning-soft-foreground">{trimDecimal(row.draft_on_order)} {unit} already on draft orders</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">{trimDecimal(row.on_hand)}</TableCell>
                          <TableCell className="hidden text-right font-mono md:table-cell">{trimDecimal(row.on_order)}</TableCell>
                          <TableCell className="hidden text-right font-mono md:table-cell">{trimDecimal(row.in_transit)}</TableCell>
                          <TableCell className="hidden text-right font-mono lg:table-cell">{row.avg_daily}</TableCell>
                          <TableCell className="hidden text-right sm:table-cell">{row.days_of_cover === null ? <span className="text-muted-foreground" title="No sales in the period">—</span> : `${trimDecimal(row.days_of_cover)} d`}</TableCell>
                          {showPurchase && (
                            <TableCell className="text-right align-top">
                              {canEditPurchase ? (
                                <QuantityInput label={`Purchase quantity of ${name}`} value={r.purchase} allowDecimal={row.variant.allow_decimal} hint={r.supplier ? catalogHint(r.purchase, r.packSize, r.minOrder) : null} onChange={(v) => edit(row.variant.id, { purchase: v })} />
                              ) : (
                                <span className="font-mono">{r.purchase}</span>
                              )}
                            </TableCell>
                          )}
                          {showPurchase && (
                            <TableCell className="align-top">
                              {canEditPurchase ? <RowSupplierSelect row={row} current={r.supplier} onChange={(supplier) => edit(row.variant.id, { supplier })} /> : <span className="text-sm">{r.supplier?.name ?? '—'}</span>}
                              {row.lead_time_days > 0 && !edits[row.variant.id]?.supplier && r.supplier && <div className="mt-1 text-xs text-muted-foreground">Lead {row.lead_time_days} d</div>}
                            </TableCell>
                          )}
                          {showPurchase && <TableCell className="hidden text-right font-mono md:table-cell">{r.unitCost ? formatMoney(r.unitCost, undefined, 2) : '—'}</TableCell>}
                          {showTransfer && (
                            <TableCell className="text-right align-top">
                              {canTransfer ? (
                                <QuantityInput label={`Transfer quantity of ${name}`} value={r.transfer} allowDecimal={row.variant.allow_decimal} onChange={(v) => edit(row.variant.id, { transfer: v })} />
                              ) : (
                                <span className="font-mono">{r.transfer}</span>
                              )}
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
        </TabsContent>
      </Tabs>

      {canPurchase && (
        <PurchasePreviewDialog
          open={dialog === 'purchase'}
          onOpenChange={(o) => !o && setDialog(null)}
          storeName={storeName}
          groups={purchases.groups}
          withoutSupplier={purchases.withoutSupplier}
          currency={currency}
          pending={createOrders.isPending}
          error={actionError}
          created={createdOrders}
          onConfirm={submitOrders}
        />
      )}
      {canRequisition && storeId && dialog === 'requisition' && (
        <RaiseRequisitionDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          storeId={storeId}
          storeName={storeName}
          rows={selectedRows}
          currency={currency}
          onCreated={forget}
        />
      )}
      {canTransfer && (
        <TransferDialog
          open={dialog === 'transfer'}
          onOpenChange={(o) => !o && setDialog(null)}
          storeName={storeName}
          rows={transferRows}
          pending={createTransfers.isPending}
          error={actionError}
          created={createdTransfers}
          onConfirm={submitTransfers}
        />
      )}
    </div>
  )
}
