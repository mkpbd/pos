import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, BanIcon, ClipboardCheckIcon, EyeOffIcon, Loader2Icon, PlayIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExportMenu } from '@/components/common/export-menu'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { AddCountDialog, BatchCountDialog, CountInput, PostStocktakeDialog, ScanBox, type BatchRequest } from '@/features/inventory/components/stocktake-count'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import {
  linesQuery,
  SCOPE_LABELS,
  STOCKTAKE_STATUS,
  stocktakeVariantLabel,
  useClearCountMutation,
  useCreateStocktakeMutation,
  useStocktakeActionMutation,
  useStocktakeLinesQuery,
  useStocktakeQuery,
  useStocktakesQuery,
  type LinesFilter,
  type Stocktake,
  type StocktakeLine,
  type StocktakeScope,
  type StocktakeStatus,
} from '@/features/inventory/stocktake-api'
import type { Product } from '@/features/products/api'
import { api, ApiError } from '@/lib/api/client'
import { formatMoney, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'

const ALL = 'all'
const STATUSES = Object.keys(STOCKTAKE_STATUS) as StocktakeStatus[]
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '—')

/** /inventory/stocktakes — counting sessions of each store. */
export function StocktakesPage() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>(ALL)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const { data, error, isPending, refetch } = useStocktakesQuery({ page, status: status === ALL ? undefined : (status as StocktakeStatus), store_id: storeId ?? undefined })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Stocktakes: count a store shelf by shelf, then post the differences in one go."
        actions={can('inventory.stocktake') && <Button onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" /> New stocktake</Button>}
      />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{STOCKTAKE_STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="w-56 max-w-full">
          <StoreSelect value={storeId} onChange={(v) => { setStoreId(v); setPage(1) }} placeholder="All stores" aria-label="Filter by store" />
        </div>
        {storeId && <Button variant="ghost" size="sm" onClick={() => { setStoreId(null); setPage(1) }}><XIcon data-icon="inline-start" /> All stores</Button>}
      </div>
      {isPending ? (
        <LoadingState rows={4} label="Loading stocktakes" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No stocktakes yet" description="Start one to count a store with a barcode scanner or by hand." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="hidden sm:table-cell">Scope</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Counted</TableHead>
                  <TableHead className="hidden md:table-cell">Started</TableHead>
                  <TableHead className="hidden md:table-cell">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">
                      <Link to={`/inventory/stocktakes/${s.id}`} className="underline-offset-4 hover:underline">{s.number}</Link>
                    </TableCell>
                    <TableCell><Badge variant={STOCKTAKE_STATUS[s.status].variant}>{STOCKTAKE_STATUS[s.status].label}</Badge></TableCell>
                    <TableCell className="text-sm">{s.store?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{SCOPE_LABELS[s.scope]}{s.blind && <span className="text-muted-foreground"> · blind</span>}</TableCell>
                    <TableCell className="hidden text-right font-mono text-sm sm:table-cell">{s.lines_count != null && s.status !== 'draft' ? `${s.counted_count ?? 0} / ${s.lines_count}` : '—'}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDate(s.started_at)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDate(s.posted_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
      {can('inventory.stocktake') && <NewStocktakeDialog open={creating} onOpenChange={setCreating} />}
    </div>
  )
}

function NewStocktakeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <NewStocktakeForm onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

type Picked = { id: string; name: string }

function NewStocktakeForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate()
  const create = useCreateStocktakeMutation()
  const start = useStocktakeActionMutation()
  const [storeId, setStoreId] = useState<string | null>(null)
  const [scope, setScope] = useState<StocktakeScope>('all')
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [products, setProducts] = useState<Picked[]>([])
  const [blind, setBlind] = useState(false)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const busy = create.isPending || start.isPending

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (!storeId) local.store_id = 'Choose a store.'
    if (scope === 'categories' && categoryIds.length === 0) local.scope_ids = 'Choose at least one category.'
    if (scope === 'products' && products.length === 0) local.scope_ids = 'Add at least one product.'
    setOpenId(null)
    if (Object.keys(local).length > 0 || !storeId) return setErrors(local)
    setErrors({})

    const scopeIds = scope === 'categories' ? categoryIds : scope === 'products' ? products.map((p) => p.id) : undefined
    create.mutate({ store_id: storeId, scope, ...(scopeIds ? { scope_ids: scopeIds } : {}), blind, notes: notes.trim() || null }, {
      onSuccess: (draft) =>
        start.mutate({ id: draft.id, action: 'start' }, {
          onSuccess: (s) => {
            toast.success(`Stocktake ${s.number} started.`)
            navigate(`/inventory/stocktakes/${s.id}`)
          },
          onError: (err) => {
            toast.error(`${draft.number} was saved as a draft but could not start: ${err.message}`)
            navigate(`/inventory/stocktakes/${draft.id}`)
          },
        }),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'STOCKTAKE_OPEN') {
          const id = err.details.stocktake_id ?? err.details.id
          setOpenId(typeof id === 'string' ? id : null)
          return setErrors({ form: err.message })
        }
        if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
          const mapped: Record<string, string> = {}
          for (const [key, messages] of Object.entries(err.fieldErrors)) mapped[key.split('.')[0] as string] = messages[0] ?? err.message
          return setErrors(mapped.store_id || mapped.scope_ids || mapped.notes || mapped.scope ? mapped : { form: err.message })
        }
        setErrors({ form: err.message })
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New stocktake</DialogTitle>
        <DialogDescription>The list of items to count is made when counting starts. Selling can go on while you count.</DialogDescription>
      </DialogHeader>
      <form id="new-stocktake-form" onSubmit={submit} noValidate className="grid min-w-0 gap-4">
        <FormField label="Store" error={errors.store_id}>
          <StoreSelect value={storeId} onChange={setStoreId} invalid={!!errors.store_id} />
        </FormField>
        <FormField label="What to count" error={errors.scope}>
          <Select value={scope} onValueChange={(v) => setScope(v as StocktakeScope)}>
            <SelectTrigger className="w-full" aria-label="What to count"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(SCOPE_LABELS) as StocktakeScope[]).map((s) => <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
        {scope === 'categories' && <CategoryScope value={categoryIds} onChange={setCategoryIds} error={errors.scope_ids} />}
        {scope === 'products' && <ProductScope value={products} onChange={setProducts} error={errors.scope_ids} />}
        <div className="flex items-start gap-3">
          <Switch id="stocktake-blind" checked={blind} onCheckedChange={setBlind} />
          <div className="grid gap-0.5">
            <Label htmlFor="stocktake-blind">Blind count</Label>
            <p className="text-sm text-muted-foreground">Counters don't see how many the system expects. Managers who post still do.</p>
          </div>
        </div>
        <FormField label="Notes" error={errors.notes}>
          <Textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
            {openId && <> <Link to={`/inventory/stocktakes/${openId}`} className="underline">Open it</Link></>}
          </p>
        )}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" form="new-stocktake-form" disabled={busy}>
          {busy && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Start counting
        </Button>
      </DialogFooter>
    </>
  )
}

function CategoryScope({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const categories = useCatalogList('categories')
  const rows = flattenCategoryTree((categories.data ?? []).filter((c) => c.is_active))
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id))

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Categories</legend>
      <p className="text-xs text-muted-foreground">Sub-categories are included.</p>
      <div className="max-h-48 overflow-y-auto rounded-md border p-2" aria-invalid={error ? true : undefined}>
        {categories.isPending ? (
          <p className="text-sm text-muted-foreground">Loading categories…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1" style={{ paddingLeft: `${c.depth * 1}rem` }}>
              <Checkbox id={`scope-cat-${c.id}`} checked={value.includes(c.id)} onCheckedChange={(on) => toggle(c.id, on === true)} />
              <Label htmlFor={`scope-cat-${c.id}`} className="font-normal">{c.name}</Label>
            </div>
          ))
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </fieldset>
  )
}

function ProductScope({ value, onChange, error }: { value: Picked[]; onChange: (products: Picked[]) => void; error?: string }) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useQuery({
    queryKey: ['stocktake-scope-products', term],
    queryFn: ({ signal }) => api.get<Product[]>('/products', { signal, query: { search: term, is_active: 1, per_page: 10 } }).then((r) => r.data),
    enabled: term.length > 0,
    staleTime: 30_000,
  })
  const options = (results.data ?? []).filter((p) => p.type === 'standard' && p.track_stock && !value.some((v) => v.id === p.id))

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Products</legend>
      {value.length > 0 && (
        <ul aria-label="Chosen products" className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <li key={p.id}>
              <Badge variant="soft" className="gap-1 pr-0.5">
                {p.name}
                <button type="button" aria-label={`Remove ${p.name}`} className="rounded p-0.5 hover:bg-primary/20" onClick={() => onChange(value.filter((v) => v.id !== p.id))}><XIcon className="size-3" /></button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Find products" className="pl-8" placeholder="Name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-invalid={error ? true : undefined} />
      </div>
      {term && (
        <ul aria-label="Matching products" className="max-h-40 overflow-y-auto rounded-md border">
          {results.isFetching && !results.data ? (
            <li className="p-2 text-sm text-muted-foreground">Searching…</li>
          ) : options.length === 0 ? (
            <li className="p-2 text-sm text-muted-foreground">No stocked products match.</li>
          ) : (
            options.map((p) => (
              <li key={p.id}>
                <button type="button" className="w-full truncate px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { onChange([...value, { id: p.id, name: p.name }]); setSearch('') }}>
                  <PlusIcon className="mr-1 inline size-3.5" aria-hidden />{p.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </fieldset>
  )
}

/** /inventory/stocktakes/:stocktakeId — start, count (scan or type), post; read-only once closed. */
export function StocktakePage() {
  const { stocktakeId } = useParams()
  const { data, error, isPending, refetch } = useStocktakeQuery(stocktakeId)

  if (isPending) return <LoadingState rows={5} label="Loading stocktake" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return <StocktakeView stocktake={data} />
}

const FILTERS: { value: LinesFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'uncounted', label: 'Not counted' },
  { value: 'counted', label: 'Counted' },
  { value: 'variance', label: 'Differences' },
]

function StocktakeView({ stocktake }: { stocktake: Stocktake }) {
  const can = useCan()
  const currency = useAuth().organization?.base_currency
  const action = useStocktakeActionMutation()
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [adding, setAdding] = useState(false)
  const [batchRequest, setBatchRequest] = useState<BatchRequest | null>(null)
  const counting = stocktake.status === 'counting'
  const open = counting || stocktake.status === 'draft'
  const canCount = can('inventory.stocktake')
  // The server says whether this user sees system quantities (blind stocktakes hide them from counters).
  const showSystem = stocktake.can_see_system_quantity ?? (!stocktake.blind || can('inventory.adjust'))
  const summary = stocktake.summary
  const status = STOCKTAKE_STATUS[stocktake.status]

  const start = () =>
    action.mutate({ id: stocktake.id, action: 'start' }, {
      onSuccess: (s) => toast.success(`Counting started on ${s.number}.`),
      onError: (e) => toast.error(e.message),
    })
  const cancel = () =>
    action.mutate({ id: stocktake.id, action: 'cancel' }, {
      onSuccess: (s) => {
        toast.success(`Stocktake ${s.number} cancelled.`)
        setCancelling(false)
      },
      onError: (e) => toast.error(e.message),
    })

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to stocktakes"><Link to="/inventory/stocktakes"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Stocktake {stocktake.number}</h1>
        <Badge variant={status.variant}>{status.label}</Badge>
        {stocktake.blind && <Badge variant="outline"><EyeOffIcon aria-hidden /> Blind</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {counting && can('inventory.adjust') && <Button onClick={() => setPosting(true)}><ClipboardCheckIcon data-icon="inline-start" /> Post</Button>}
          {open && canCount && <Button variant="outline" onClick={() => setCancelling(true)}><BanIcon data-icon="inline-start" /> Cancel stocktake</Button>}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Store</dt><dd>{stocktake.store?.name ?? '—'}</dd></div>
            <div>
              <dt className="text-muted-foreground">Scope</dt>
              <dd>
                {SCOPE_LABELS[stocktake.scope]}
                {stocktake.scope_items && stocktake.scope_items.length > 0 && <span className="text-muted-foreground">: {stocktake.scope_items.map((i) => i.name ?? '—').join(', ')}</span>}
              </dd>
            </div>
            <div><dt className="text-muted-foreground">Started</dt><dd>{formatDate(stocktake.started_at)}</dd></div>
            {stocktake.status === 'posted' && (
              <>
                <div><dt className="text-muted-foreground">Posted</dt><dd>{formatDate(stocktake.posted_at)}{stocktake.posted_by?.name && ` by ${stocktake.posted_by.name}`}</dd></div>
                <div><dt className="text-muted-foreground">Uncounted items</dt><dd>{stocktake.uncounted_policy === 'zero' ? 'Set to zero' : 'Left as they were'}</dd></div>
                <div>
                  <dt className="text-muted-foreground">Stock adjustment</dt>
                  <dd>
                    {stocktake.adjustment ? (
                      <Link to={`/inventory/adjustments/${stocktake.adjustment.id}`} className="font-mono underline underline-offset-4">{stocktake.adjustment.number ?? 'View adjustment'}</Link>
                    ) : (
                      'None — nothing needed changing'
                    )}
                  </dd>
                </div>
              </>
            )}
            {stocktake.notes && <div className="sm:col-span-3"><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{stocktake.notes}</dd></div>}
          </dl>
        </CardContent>
      </Card>

      {stocktake.status === 'draft' ? (
        <Card>
          <CardHeader><CardTitle>Not started yet</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
            <p>Starting makes the list of items to count from what the store holds now.</p>
            {canCount && (
              <Button onClick={start} disabled={action.isPending}>
                {action.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PlayIcon data-icon="inline-start" />}
                Start counting
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {summary && <Progress stocktake={stocktake} showSystem={showSystem} currency={currency} />}
          {counting && canCount && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Count</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" /> Count an item</Button>
              </CardHeader>
              <CardContent>
                <ScanBox stocktake={stocktake} showSystem={showSystem} onBatchRequired={setBatchRequest} />
              </CardContent>
            </Card>
          )}
          <LinesSection stocktake={stocktake} editable={counting && canCount} showSystem={showSystem} currency={currency} />
        </>
      )}

      {counting && can('inventory.adjust') && <PostStocktakeDialog stocktake={stocktake} open={posting} onOpenChange={setPosting} />}
      {counting && canCount && <AddCountDialog stocktake={stocktake} open={adding} onOpenChange={setAdding} />}
      {counting && canCount && <BatchCountDialog stocktake={stocktake} request={batchRequest} onOpenChange={(o) => { if (!o) setBatchRequest(null) }} />}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel stocktake ${stocktake.number}?`}
        description="The counts so far are kept for reference, but nothing is posted and the store can start a new stocktake."
        confirmLabel="Cancel stocktake"
        pending={action.isPending}
        onConfirm={cancel}
      />
    </div>
  )
}

function Progress({ stocktake, showSystem, currency }: { stocktake: Stocktake; showSystem: boolean; currency?: string }) {
  const s = stocktake.summary
  if (!s) return null
  const percent = s.lines > 0 ? Math.round((s.counted / s.lines) * 100) : 0

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span id="stocktake-progress-label" className="font-medium">{s.counted} of {s.lines} counted</span>
          <span className="text-muted-foreground">{s.uncounted} not counted yet</span>
        </div>
        <div
          role="progressbar"
          aria-labelledby="stocktake-progress-label"
          aria-valuemin={0}
          aria-valuemax={s.lines}
          aria-valuenow={s.counted}
          aria-valuetext={`${percent}%`}
          className="h-2.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        {showSystem && (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {s.with_variance != null && <div><dt className="text-muted-foreground">With a difference</dt><dd className="font-mono">{s.with_variance}</dd></div>}
            {s.variance_quantity_in != null && <div><dt className="text-muted-foreground">Found</dt><dd className="font-mono text-success-soft-foreground">+{trimDecimal(s.variance_quantity_in)}</dd></div>}
            {s.variance_quantity_out != null && <div><dt className="text-muted-foreground">Missing</dt><dd className="font-mono text-destructive-soft-foreground">−{trimDecimal(s.variance_quantity_out.replace('-', ''))}</dd></div>}
            {s.variance_value != null && <div><dt className="text-muted-foreground">Value of the difference</dt><dd className="font-mono">{formatMoney(s.variance_value, currency)}</dd></div>}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function signed(value: string | null): { text: string; tone: string } {
  if (value == null) return { text: '—', tone: 'text-muted-foreground' }
  const t = trimDecimal(value)
  if (t === '0') return { text: '0', tone: 'text-muted-foreground' }
  return t.startsWith('-') ? { text: `−${t.slice(1)}`, tone: 'text-destructive-soft-foreground' } : { text: `+${t}`, tone: 'text-success-soft-foreground' }
}

function LinesSection({ stocktake, editable, showSystem, currency }: { stocktake: Stocktake; editable: boolean; showSystem: boolean; currency?: string }) {
  const [filter, setFilter] = useState<LinesFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebouncedValue(search.trim(), 300)
  const params = { page, filter, search: term || undefined }
  const { data, error, isPending, refetch } = useStocktakeLinesQuery(stocktake.id, params)
  const filters = showSystem ? FILTERS : FILTERS.filter((f) => f.value !== 'variance')

  return (
    <section aria-labelledby="stocktake-lines-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stocktake-lines-heading" className="font-heading text-lg font-semibold">Items</h2>
        <ExportMenu list="stocktakeLines" pathParams={{ id: stocktake.id }} query={linesQuery({ filter, search: term || undefined })} disabled={!data?.items.length} size="sm" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show items" className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} aria-pressed={filter === f.value} onClick={() => { setFilter(f.value); setPage(1) }}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 basis-48">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search items" className="pl-8" placeholder="Name, SKU or barcode" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
      </div>
      {isPending ? (
        <LoadingState rows={5} label="Loading items" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={filter === 'all' && !term ? 'Nothing to count' : 'No matching items'} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Stocktake items">
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  {showSystem && <TableHead className="hidden text-right sm:table-cell">System</TableHead>}
                  {showSystem && <TableHead className="text-right">Difference</TableHead>}
                  {showSystem && <TableHead className="hidden text-right md:table-cell">Value</TableHead>}
                  <TableHead className="hidden lg:table-cell">Counted by</TableHead>
                  {editable && <TableHead><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((line) => (
                  <LineRow key={line.id} stocktakeId={stocktake.id} line={line} editable={editable} showSystem={showSystem} currency={currency} />
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </section>
  )
}

function LineRow({ stocktakeId, line, editable, showSystem, currency }: { stocktakeId: string; line: StocktakeLine; editable: boolean; showSystem: boolean; currency?: string }) {
  const clear = useClearCountMutation(stocktakeId)
  const diff = signed(line.difference)
  const name = stocktakeVariantLabel(line.variant)

  return (
    <TableRow>
      <TableCell className="max-w-48 sm:max-w-none">
        <div className="truncate font-medium whitespace-normal">{name}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {line.variant?.sku}
          {line.batch && ` · batch ${line.batch.number}${line.batch.expires_on ? ` (exp ${line.batch.expires_on})` : ''}`}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono">
        {editable ? <CountInput key={`${line.id}:${line.counted_quantity ?? ''}`} stocktakeId={stocktakeId} line={line} /> : line.counted_quantity != null ? trimDecimal(line.counted_quantity) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      {showSystem && <TableCell className="hidden text-right font-mono sm:table-cell">{line.system_quantity != null ? trimDecimal(line.system_quantity) : '—'}</TableCell>}
      {showSystem && <TableCell className={cn('text-right font-mono', diff.tone)}>{diff.text}</TableCell>}
      {showSystem && <TableCell className="hidden text-right font-mono md:table-cell">{line.value_difference != null ? formatMoney(line.value_difference, currency) : '—'}</TableCell>}
      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{line.counted_by?.name ?? '—'}{line.counted_at && <div className="text-xs">{new Date(line.counted_at).toLocaleTimeString()}</div>}</TableCell>
      {editable && (
        <TableCell className="text-right">
          {line.counted_quantity != null && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Clear the count of ${name}${line.batch ? `, batch ${line.batch.number}` : ''}`}
              disabled={clear.isPending}
              onClick={() => clear.mutate(line.id, { onSuccess: () => toast.success(`Count of ${name} cleared.`), onError: (e) => toast.error(e.message) })}
            >
              <XIcon />
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  )
}
