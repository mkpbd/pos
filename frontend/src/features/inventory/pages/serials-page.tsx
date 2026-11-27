import { useState } from 'react'
import { Link } from 'react-router'
import { SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { VariantPicker } from '@/components/common/variant-picker'
import type { VariantOption } from '@/components/common/variant-options'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { SERIAL_EVENTS, SERIAL_STATUS, serialReferencePath, useSerialQuery, useSerialsQuery, variantLabel, type SerialStatus, type UserRef } from '@/features/inventory/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { formatDateTime } from '@/features/web-orders/orders'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
const personName = (ref: UserRef | undefined): string | null => (ref && typeof ref === 'object' ? ref.name : null)

/** ST2d: one serial number and every movement of it, newest first. */
function SerialSheet({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }) {
  const timeZone = useAuth().organization?.timezone
  const { data, error, isPending, refetch } = useSerialQuery(id)

  return (
    <Sheet open={id !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono">{data?.serial ?? 'Serial number'}</SheetTitle>
          <SheetDescription>{data ? variantLabel(data.variant) : 'Where this unit has been.'}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {isPending ? (
            <LoadingState rows={4} label="Loading serial number" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Status</dt><dd><Badge variant={SERIAL_STATUS[data.status].variant}>{SERIAL_STATUS[data.status].label}</Badge></dd></div>
                <div><dt className="text-xs text-muted-foreground">Store</dt><dd>{data.store?.name ?? '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">SKU</dt><dd className="font-mono">{data.variant?.sku ?? '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Updated</dt><dd>{formatDateTime(data.updated_at, timeZone)}</dd></div>
              </dl>
              {data.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table aria-label="Serial number history">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Store</TableHead>
                        <TableHead>Document</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.events.map((e, i) => {
                        const to = serialReferencePath(e.reference_type, e.reference_id)
                        const label = e.reference_number ?? e.reference_type ?? '—'
                        return (
                          <TableRow key={e.id ?? i}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {formatDateTime(e.created_at, timeZone)}
                              {personName(e.created_by) && <div className="text-xs text-muted-foreground">by {personName(e.created_by)}</div>}
                            </TableCell>
                            <TableCell className="text-sm">{SERIAL_EVENTS[e.type] ?? e.type}</TableCell>
                            <TableCell className="text-sm">{e.store?.name ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{to ? <Link to={to} className="underline-offset-4 hover:underline">{label}</Link> : label}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** ST2d: find a serial number by search, status, store or product, and open its history. */
export function SerialsPage() {
  const timeZone = useAuth().organization?.timezone
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<SerialStatus | typeof ALL>(ALL)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [product, setProduct] = useState<VariantOption | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const term = useDebouncedValue(search)
  const filters = { search: term || undefined, status: status === ALL ? undefined : status, store_id: storeId ?? undefined, variant_id: product?.id }
  const { data, error, isPending, refetch } = useSerialsQuery({ page, ...filters })
  const filtered = Object.values(filters).some((v) => v !== undefined)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inventory" description="Serial numbers of phones and other serial-tracked products: where each unit is and where it has been." />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search serial numbers" placeholder="Serial number" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as SerialStatus | typeof ALL); setPage(1) }}>
          <SelectTrigger className="w-48" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            {(Object.keys(SERIAL_STATUS) as SerialStatus[]).map((s) => <SelectItem key={s} value={s}>{SERIAL_STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="w-56">
          <StoreSelect value={storeId} onChange={(id) => { setStoreId(id); setPage(1) }} placeholder="All stores" aria-label="Filter by store" />
        </div>
        <div className="w-64">
          <VariantPicker value={product} onChange={(option) => { setProduct(option); setPage(1) }} stockedOnly aria-label="Filter by product" />
        </div>
        {(storeId || product) && <Button variant="ghost" size="sm" onClick={() => { setStoreId(null); setProduct(null); setPage(1) }}>Clear filters</Button>}
      </div>

      {isPending ? (
        <LoadingState rows={6} label="Loading serial numbers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={filtered ? 'No serial numbers match' : 'No serial numbers yet'} description={filtered ? undefined : 'They are recorded when serial-tracked products are received, adjusted in or sold.'} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Store</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <button type="button" className="font-mono text-sm underline-offset-4 hover:underline" onClick={() => setViewing(row.id)}>{row.serial}</button>
                    </TableCell>
                    <TableCell className="text-sm">
                      {variantLabel(row.variant)}
                      <div className="font-mono text-xs text-muted-foreground">{row.variant?.sku}</div>
                    </TableCell>
                    <TableCell><Badge variant={SERIAL_STATUS[row.status].variant}>{SERIAL_STATUS[row.status].label}</Badge></TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{row.store?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDateTime(row.updated_at, timeZone)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
      <SerialSheet id={viewing} onOpenChange={(open) => !open && setViewing(null)} />
    </div>
  )
}
