import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PlusIcon, SearchIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { ImportButton } from '@/features/imports/components/import-button'
import { useBatchesQuery, useMovementsQuery, useStockQuery, useValuationQuery, MOVEMENT_LABELS, variantLabel } from '@/features/inventory/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { todayIn } from '@/features/cod-remittances/remittances'
import { compareDecimal, formatMoney, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

function Header({ exportMenu }: { exportMenu: ReactNode }) {
  const can = useCan()

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand per store, batches, and every movement in the ledger."
        actions={
          <>
            {exportMenu}
            <ImportButton type="opening_stock" label="Import opening stock" />
            {can('inventory.transfer') && <Button asChild variant="outline"><Link to="/inventory/transfers/new">New transfer</Link></Button>}
            {can('inventory.adjust') && <Button asChild><Link to="/inventory/adjustments/new"><PlusIcon data-icon="inline-start" /> New adjustment</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
    </>
  )
}

export function StockPage() {
  const me = useAuth()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [storeId, setStoreId] = useState<string | null>(null)
  const [params] = useSearchParams()
  const [lowOnly, setLowOnly] = useState(params.get('low_stock') === '1')
  const term = useDebouncedValue(search)
  const filters = { search: term || undefined, store_id: storeId ?? undefined, low_stock: lowOnly ? 1 : undefined }
  const { data, error, isPending, refetch } = useStockQuery({ page, ...filters })
  const currency = me.organization?.base_currency

  return (
    <div className="flex flex-col gap-6">
      <Header exportMenu={<ExportMenu list="stock" query={filters} disabled={!data?.items.length} />} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search stock" placeholder="Product, SKU or barcode" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <div className="w-56">
          <StoreSelect value={storeId} onChange={(id) => { setStoreId(id); setPage(1) }} placeholder="All stores" aria-label="Filter by store" />
        </div>
        {storeId && <Button variant="ghost" size="sm" onClick={() => setStoreId(null)}>Clear store</Button>}
        <div className="flex items-center gap-2">
          <Switch id="low-only" checked={lowOnly} onCheckedChange={(v) => { setLowOnly(v); setPage(1) }} />
          <Label htmlFor="low-only" className="font-normal">Low stock only</Label>
        </div>
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading stock" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={lowOnly ? 'Nothing is running low' : 'No stock recorded yet'} description={lowOnly ? undefined : 'Post opening stock or receive a purchase to get started.'} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Reorder at</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={`${row.store?.id}-${row.variant?.id}`}>
                    <TableCell>
                      <div className="font-medium">{variantLabel(row.variant)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.variant?.sku}</div>
                    </TableCell>
                    <TableCell className="text-sm">{row.store?.name}<div className="text-xs text-muted-foreground">{row.store?.branch_name}</div></TableCell>
                    <TableCell className="text-right font-mono">
                      {trimDecimal(row.quantity)} {row.variant?.unit_code}
                      {row.is_low && <Badge variant="warning" className="ml-2">Low</Badge>}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-muted-foreground md:table-cell">{compareDecimal(row.reorder_level, '0') > 0 ? trimDecimal(row.reorder_level) : '—'}</TableCell>
                    <TableCell className="hidden text-right font-mono lg:table-cell">{row.value === null ? '—' : formatMoney(row.value, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

export function BatchesPage() {
  const [days, setDays] = useState('')
  const filters = { expiring_within_days: days === '' ? undefined : Number(days) }
  const { data, error, isPending, refetch } = useBatchesQuery(filters)

  return (
    <div className="flex flex-col gap-6">
      <Header exportMenu={<ExportMenu list="batches" query={filters} disabled={!data?.length} />} />
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expiring">Expiring within (days)</Label>
          <Input id="expiring" inputMode="numeric" className="w-40" placeholder="Any" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {isPending ? (
        <LoadingState rows={5} label="Loading batches" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="No batches in stock" description="Batch-tracked products appear here once received." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={`${row.store?.id}-${row.batch.id}`}>
                  <TableCell className="font-medium">{variantLabel(row.variant)}</TableCell>
                  <TableCell className="font-mono text-sm">{row.batch.batch_number}</TableCell>
                  <TableCell>
                    {row.batch.expires_on ?? '—'}
                    {row.is_expired && <Badge variant="destructive" className="ml-2">Expired</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">{row.store?.name}</TableCell>
                  <TableCell className="text-right font-mono">{trimDecimal(row.quantity)} {row.variant?.unit_code}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

export function MovementsPage() {
  const me = useAuth()
  const [page, setPage] = useState(1)
  const { data, error, isPending, refetch } = useMovementsQuery({ page })

  return (
    <div className="flex flex-col gap-6">
      <Header exportMenu={<ExportMenu list="movements" disabled={!data?.items.length} />} />
      {isPending ? (
        <LoadingState rows={6} label="Loading movements" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No movements yet" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Store</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Balance</TableHead>
                  <TableHead className="hidden lg:table-cell">Document</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{MOVEMENT_LABELS[m.type]}</Badge></TableCell>
                    <TableCell className="text-sm">{variantLabel(m.variant)}{m.batch && <span className="ml-1 font-mono text-xs text-muted-foreground">#{m.batch.batch_number}</span>}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{m.store?.name}</TableCell>
                    <TableCell className={`text-right font-mono ${m.quantity.startsWith('-') ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {m.quantity.startsWith('-') ? '' : '+'}{trimDecimal(m.quantity)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono sm:table-cell">{trimDecimal(m.balance_after)}</TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">{m.reference.number ?? m.reference.type}{m.unit_cost && ` @ ${formatMoney(m.unit_cost, me.organization?.base_currency, 2)}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** "2026-11-30" → "30 Nov 2026". */
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * ST2d: stock value per store (weighted average cost), now or at the end of a past day in the
 * organization's timezone — e.g. the month-end value after later movements.
 */
export function ValuationPage() {
  const me = useAuth()
  const today = todayIn(me.organization?.timezone)
  const [asOf, setAsOf] = useState(today)
  const valid = DATE.test(asOf) && asOf <= today
  // Today is the live value (no as_of), exactly as before ST2d.
  const filters = { as_of: valid && asOf !== today ? asOf : undefined }
  const { data, error, isPending, refetch } = useValuationQuery(filters)
  const rows = data?.stores ?? []
  const currency = me.organization?.base_currency
  // The day the shown figures are for (the previous figures stay visible while a new day loads).
  const shown = (data && 'as_of' in data ? data.as_of : filters.as_of) ?? today

  return (
    <div className="flex flex-col gap-6">
      <Header exportMenu={<ExportMenu list="valuation" query={filters} disabled={!rows.length} />} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="as-of">As of</Label>
        <Input id="as-of" type="date" className="w-44" max={today} value={asOf} aria-invalid={!valid || undefined} onChange={(e) => setAsOf(e.target.value)} />
        {!valid && <p className="text-xs text-destructive">Choose a day up to today.</p>}
      </div>

      {isPending ? (
        <LoadingState rows={4} label="Loading stock value" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No stock value" description={`Nothing was in stock on ${longDate(shown)}.`} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Stock value per store">
            <caption className="px-3 py-2 text-left text-sm font-medium">Value as of {longDate(shown)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.store?.id ?? i}>
                  <TableCell className="text-sm">{row.store?.name ?? '—'}<div className="text-xs text-muted-foreground">{row.store?.branch_name}</div></TableCell>
                  <TableCell className="text-right font-mono">{row.products}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(row.value, currency)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono" data-testid="valuation-total">{formatMoney(data?.total ?? '0', currency)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
