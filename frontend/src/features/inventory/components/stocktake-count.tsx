import { useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CheckIcon, Loader2Icon, ScanBarcodeIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { VariantPicker } from '@/components/common/variant-picker'
import type { VariantOption } from '@/components/common/variant-options'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/use-auth'
import { useBatchesQuery } from '@/features/inventory/api'
import {
  scanBarcode,
  stocktakeKeys,
  stocktakeVariantLabel,
  useSaveCountsMutation,
  useStocktakeActionMutation,
  useStocktakeLinesQuery,
  type Stocktake,
  type StocktakeLine,
  type StocktakeVariant,
  type UncountedPolicy,
  quantityError,
} from '@/features/inventory/stocktake-api'
import { ApiError } from '@/lib/api/client'
import { formatMoney, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

type ScanEntry = {
  key: number
  barcode: string
  quantity: string
  state: 'pending' | 'ok' | 'error'
  line?: StocktakeLine | null
  message?: string
}

type BatchOption = { id: string; number: string; expires_on: string | null }

/** A scan that needs its batch: the scan is repeated with the batch the counter picks. */
export type BatchRequest = { barcode: string; variant: StocktakeVariant; quantity: string; batches: BatchOption[] }

/** The variant a BATCH_REQUIRED answer names (details.variant, or just its id). */
function batchVariant(error: ApiError, barcode: string): StocktakeVariant | null {
  const v = error.details.variant as Partial<StocktakeVariant> | undefined
  const id = v?.id ?? (typeof error.details.variant_id === 'string' ? error.details.variant_id : undefined)
  if (!id) return null
  return { id, name: v?.name ?? null, sku: v?.sku ?? barcode, barcode: v?.barcode ?? barcode, product_name: v?.product_name ?? barcode, unit_code: v?.unit_code ?? null, allow_decimal: v?.allow_decimal }
}

/**
 * The scan box. Works with keyboard-wedge scanners: they type the code and press Enter, which
 * submits; the box clears and keeps the focus at once, so the next scan can follow before the
 * server answers. Each scan is its own request — the server adds atomically.
 */
export function ScanBox({ stocktake, showSystem, onBatchRequired }: { stocktake: Stocktake; showSystem: boolean; onBatchRequired: (request: BatchRequest) => void }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const counter = useRef(0)
  const [code, setCode] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [quantityInvalid, setQuantityInvalid] = useState(false)
  const [scans, setScans] = useState<ScanEntry[]>([])
  const latest = scans[0]

  const update = (key: number, patch: Partial<ScanEntry>) => setScans((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    inputRef.current?.focus()
    const barcode = code.trim()
    if (!barcode) return
    const qty = quantity.trim() || '1'
    if (quantityError(qty, undefined, false)) {
      setQuantityInvalid(true)
      return
    }
    counter.current += 1
    const key = counter.current
    setScans((all) => [{ key, barcode, quantity: qty, state: 'pending' as const }, ...all].slice(0, 10))
    setCode('')
    setQuantity('1')
    setQuantityInvalid(false)

    scanBarcode(stocktake.id, barcode, qty)
      .then((line) => {
        update(key, { state: 'ok', line })
        void queryClient.invalidateQueries({ queryKey: stocktakeKeys.all })
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'BATCH_REQUIRED') {
          const variant = batchVariant(error, barcode)
          update(key, { state: 'error', message: variant ? `${stocktakeVariantLabel(variant)} has batches — choose the batch.` : error.message })
          const batches = Array.isArray(error.details.batches) ? (error.details.batches as BatchOption[]) : []
          if (variant) onBatchRequired({ barcode, variant, quantity: qty, batches })
          return
        }
        const message = error instanceof ApiError && error.code === 'UNKNOWN_BARCODE' ? `No product has the barcode ${barcode}.` : error instanceof Error ? error.message : 'The scan failed.'
        update(key, { state: 'error', message })
      })
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="Scan items">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
          <Label htmlFor="stocktake-scan">Scan or type a barcode</Label>
          <div className="relative">
            <ScanBarcodeIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={inputRef}
              id="stocktake-scan"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-12 pl-10 font-mono text-lg"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Barcode"
            />
          </div>
        </div>
        <div className="flex w-20 flex-col gap-1.5">
          <Label htmlFor="stocktake-scan-qty">Quantity</Label>
          <Input
            id="stocktake-scan-qty"
            inputMode="decimal"
            className="h-12 text-center font-mono"
            value={quantity}
            aria-invalid={quantityInvalid || undefined}
            onChange={(e) => {
              setQuantity(e.target.value)
              setQuantityInvalid(false)
            }}
          />
        </div>
        <Button type="submit" size="lg" className="h-12">Add</Button>
      </form>

      <div
        role="status"
        aria-live="polite"
        aria-label="Scan result"
        className={cn(
          'min-h-12 rounded-md border px-3 py-2 text-sm transition-colors',
          !latest && 'text-muted-foreground',
          latest?.state === 'ok' && 'border-success/40 bg-success/10',
          latest?.state === 'error' && 'border-destructive/40 bg-destructive/10',
        )}
      >
        {!latest ? 'Ready to scan.' : <ScanMessage entry={latest} showSystem={showSystem} />}
      </div>

      {scans.length > 1 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Last scans</h3>
          <ol aria-label="Last scans" className="flex flex-col divide-y rounded-md border text-sm">
            {scans.slice(1).map((s) => (
              <li key={s.key} className="flex items-center gap-2 px-3 py-1.5">
                {s.state === 'pending' ? <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden /> : s.state === 'ok' ? <CheckIcon className="size-4 shrink-0 text-success-soft-foreground" aria-hidden /> : <AlertTriangleIcon className="size-4 shrink-0 text-destructive" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{s.line ? stocktakeVariantLabel(s.line.variant) : s.barcode}</span>
                <span className="shrink-0 font-mono text-xs">+{trimDecimal(s.quantity)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function ScanMessage({ entry, showSystem }: { entry: ScanEntry; showSystem: boolean }) {
  if (entry.state === 'pending') return <span className="flex items-center gap-2"><Loader2Icon className="size-4 animate-spin" aria-hidden /> Adding {entry.barcode}…</span>
  if (entry.state === 'error') return <span className="flex items-start gap-2"><AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> {entry.message}</span>
  const line = entry.line
  return (
    <span className="flex items-start gap-2">
      <CheckIcon className="mt-0.5 size-4 shrink-0 text-success-soft-foreground" aria-hidden />
      <span>
        Added {trimDecimal(entry.quantity)} × <strong>{line ? stocktakeVariantLabel(line.variant) : entry.barcode}</strong>
        {line?.batch && ` (batch ${line.batch.number})`}.
        {line?.counted_quantity != null && <> Counted: <strong className="font-mono">{trimDecimal(line.counted_quantity)}</strong>.</>}
        {showSystem && line?.system_quantity != null && <> System: <span className="font-mono">{trimDecimal(line.system_quantity)}</span>.</>}
      </span>
    </span>
  )
}

/** The counted quantity of one line: Enter or leaving the box saves a change. */
export function CountInput({ stocktakeId, line }: { stocktakeId: string; line: StocktakeLine }) {
  const save = useSaveCountsMutation(stocktakeId)
  const initial = trimDecimal(line.counted_quantity)
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const label = `Counted quantity of ${stocktakeVariantLabel(line.variant)}${line.batch ? `, batch ${line.batch.number}` : ''}`

  const commit = () => {
    const v = value.trim()
    if (v === initial || (v === '' && line.counted_quantity == null)) return
    if (v === '') {
      setValue(initial)
      return
    }
    const problem = quantityError(v, line.variant?.allow_decimal)
    if (problem) return setError(problem)
    if (!line.variant) return
    setError(null)
    save.mutate([{ variant_id: line.variant.id, batch_id: line.batch?.id ?? null, counted_quantity: v }], {
      onError: (e) => {
        const message = e instanceof ApiError && e.code === 'VALIDATION_FAILED' ? (Object.values(e.fieldErrors)[0]?.[0] ?? e.message) : e.message
        setError(message)
        toast.error(message)
      },
    })
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {save.isPending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      <Input
        aria-label={label}
        inputMode="decimal"
        className="h-8 w-20 text-right font-mono"
        placeholder="—"
        value={value}
        title={error ?? undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      />
    </div>
  )
}

/** Something found on the shelf, or a count typed in by hand (absolute quantity). */
export function AddCountDialog({ stocktake, open, onOpenChange }: { stocktake: Stocktake; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <AddCountForm stocktake={stocktake} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function AddCountForm({ stocktake, onDone }: { stocktake: Stocktake; onDone: () => void }) {
  const save = useSaveCountsMutation(stocktake.id)
  const [variant, setVariant] = useState<VariantOption | null>(null)
  const [batchId, setBatchId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const storeId = stocktake.store?.id
  const batches = useBatchesQuery({ variant_id: variant?.id, store_id: storeId }, !!variant?.track_batches && !!storeId)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (!variant) local.variant = 'Choose a product.'
    if (variant?.track_batches && !batchId) local.batch = 'Choose the batch.'
    const problem = quantityError(quantity, variant?.allow_decimal)
    if (problem) local.quantity = problem
    if (Object.keys(local).length > 0 || !variant) return setErrors(local)
    save.mutate([{ variant_id: variant.id, batch_id: variant.track_batches ? batchId : null, counted_quantity: quantity.trim() }], {
      onSuccess: () => {
        toast.success(`Counted ${trimDecimal(quantity.trim())} × ${variant.label}.`)
        onDone()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
          const first = Object.values(error.fieldErrors)[0]?.[0]
          return setErrors({ form: first ?? error.message })
        }
        setErrors({ form: error.message })
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Count an item</DialogTitle>
        <DialogDescription>Enter the total you counted. Items outside this stocktake are added to it.</DialogDescription>
      </DialogHeader>
      <form id="add-count-form" onSubmit={submit} noValidate className="grid gap-4">
        <FormField label="Product" error={errors.variant}>
          <VariantPicker value={variant} onChange={(v) => { setVariant(v); setBatchId('') }} stockedOnly aria-label="Product" />
        </FormField>
        {variant?.track_batches && (
          <FormField label="Batch" error={errors.batch} hint={batches.data?.length === 0 ? 'This product has no batches in this store.' : undefined}>
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger className="w-full" aria-label="Batch"><SelectValue placeholder={batches.isPending ? 'Loading…' : 'Choose a batch'} /></SelectTrigger>
              <SelectContent>
                {(batches.data ?? []).map((b) => (
                  <SelectItem key={b.batch.id} value={b.batch.id}>{b.batch.batch_number}{b.batch.expires_on ? ` · exp ${b.batch.expires_on}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
        <FormField label={`Counted quantity${variant?.unit_code ? ` (${variant.unit_code})` : ''}`} error={errors.quantity}>
          <Input inputMode="decimal" className="font-mono" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormField>
        {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" form="add-count-form" disabled={save.isPending}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save count
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * A scanned product that is batch-tracked: the scan can't tell which batch, so the counter picks
 * it here and the scan is repeated for that batch (still an atomic add on the server).
 */
export function BatchCountDialog({ stocktake, request, onOpenChange }: { stocktake: Stocktake; request: BatchRequest | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{request && <BatchCountForm key={`${request.variant.id}:${request.quantity}`} stocktake={stocktake} request={request} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function BatchCountForm({ stocktake, request, onDone }: { stocktake: Stocktake; request: BatchRequest; onDone: () => void }) {
  const queryClient = useQueryClient()
  const groupId = useId()
  const { variant } = request
  // Counted so far per batch, from this stocktake's lines of the product.
  const lines = useStocktakeLinesQuery(stocktake.id, { page: 1, filter: 'all', search: variant.sku, per_page: 100 })
  const counted = new Map<string, string | null>()
  for (const l of lines.data?.items ?? []) if (l.variant?.id === variant.id && l.batch) counted.set(l.batch.id, l.counted_quantity)
  const [batchId, setBatchId] = useState('')
  const [quantity, setQuantity] = useState(request.quantity)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const choice = request.batches.find((b) => b.id === batchId)
    if (!choice) return setError('Choose the batch.')
    const problem = quantityError(quantity, variant.allow_decimal, false)
    if (problem) return setError(problem)
    setPending(true)
    scanBarcode(stocktake.id, request.barcode, quantity.trim(), choice.id)
      .then((line) => {
        toast.success(`Batch ${choice.number}: counted ${trimDecimal(line?.counted_quantity ?? quantity.trim())}.`)
        void queryClient.invalidateQueries({ queryKey: stocktakeKeys.all })
        onDone()
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.code === 'VALIDATION_FAILED' ? (Object.values(err.fieldErrors)[0]?.[0] ?? err.message) : err instanceof Error ? err.message : 'The scan failed.'))
      .finally(() => setPending(false))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Which batch?</DialogTitle>
        <DialogDescription>{stocktakeVariantLabel(variant)} is counted per batch. Pick the batch on the label; the quantity is added to its count.</DialogDescription>
      </DialogHeader>
      <form id="batch-count-form" onSubmit={submit} noValidate className="grid gap-4">
        {request.batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">This product has no batches yet. Receive it with a batch number first.</p>
        ) : (
          <fieldset className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium">Batch</legend>
            {request.batches.map((b) => {
              const so = counted.get(b.id)
              return (
                <label key={b.id} htmlFor={`${groupId}-${b.id}`} className={cn('flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm', batchId === b.id && 'border-primary bg-primary/5')}>
                  <input type="radio" id={`${groupId}-${b.id}`} name={`${groupId}-batch`} value={b.id} checked={batchId === b.id} onChange={() => { setBatchId(b.id); setError(null) }} className="size-4 accent-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono">{b.number}</span>
                    {b.expires_on && <span className="text-muted-foreground"> · exp {b.expires_on}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{so != null ? `Counted ${trimDecimal(so)}` : 'Not counted'}</span>
                </label>
              )
            })}
          </fieldset>
        )}
        <FormField label="Quantity to add">
          <Input inputMode="decimal" className="font-mono" value={quantity} onChange={(e) => { setQuantity(e.target.value); setError(null) }} />
        </FormField>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" form="batch-count-form" disabled={pending || request.batches.length === 0}>
          {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Add to count
        </Button>
      </DialogFooter>
    </>
  )
}

/** Posting (inventory.adjust): what happens to uncounted lines, and the variance it will book. */
export function PostStocktakeDialog({ stocktake, open, onOpenChange }: { stocktake: Stocktake; open: boolean; onOpenChange: (open: boolean) => void }) {
  const post = useStocktakeActionMutation()
  const [policy, setPolicy] = useState<UncountedPolicy>('ignore')
  const groupId = useId()
  const summary = stocktake.summary
  const uncounted = summary?.uncounted ?? 0
  const currency = useAuth().organization?.base_currency

  const confirm = () =>
    post.mutate({ id: stocktake.id, action: 'post', body: { uncounted_policy: policy } }, {
      onSuccess: (s) => {
        const number = s.adjustment?.number
        toast.success(s.adjustment ? `Stocktake ${s.number} posted${number ? ` as ${number}` : ''}.` : `Stocktake ${s.number} posted. Nothing needed changing.`)
        onOpenChange(false)
      },
      onError: (e) => toast.error(e.message),
    })

  const options: { value: UncountedPolicy; label: string; hint: string }[] = [
    { value: 'ignore', label: 'Leave them as they are', hint: 'Only counted items change.' },
    { value: 'zero', label: 'Set them to zero', hint: `The ${uncounted} uncounted ${uncounted === 1 ? 'item is' : 'items are'} treated as counted 0 — use when you counted the whole store.` },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!post.isPending) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post stocktake {stocktake.number}?</DialogTitle>
          <DialogDescription>One stock count adjustment brings the stock in line with what was counted. The stocktake can't be changed afterwards.</DialogDescription>
        </DialogHeader>
        {summary && (
          <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
            <div><dt className="text-muted-foreground">Counted</dt><dd className="font-mono">{summary.counted} of {summary.lines}</dd></div>
            {summary.with_variance != null && <div><dt className="text-muted-foreground">With a difference</dt><dd className="font-mono">{summary.with_variance}</dd></div>}
            {summary.variance_quantity_in != null && <div><dt className="text-muted-foreground">Quantity found</dt><dd className="font-mono text-success-soft-foreground">+{trimDecimal(summary.variance_quantity_in)}</dd></div>}
            {summary.variance_quantity_out != null && <div><dt className="text-muted-foreground">Quantity missing</dt><dd className="font-mono text-destructive-soft-foreground">−{trimDecimal(summary.variance_quantity_out.replace('-', ''))}</dd></div>}
            {summary.variance_value != null && <div className="col-span-2"><dt className="text-muted-foreground">Value of the difference</dt><dd className="font-mono">{formatMoney(summary.variance_value, currency)}</dd></div>}
          </dl>
        )}
        {uncounted > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{uncounted} {uncounted === 1 ? 'item was' : 'items were'} not counted</legend>
            {options.map((o) => (
              <label key={o.value} htmlFor={`${groupId}-${o.value}`} className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm', policy === o.value && 'border-primary bg-primary/5')}>
                <input type="radio" id={`${groupId}-${o.value}`} name={`${groupId}-policy`} value={o.value} checked={policy === o.value} onChange={() => setPolicy(o.value)} className="mt-0.5 size-4 accent-primary" />
                <span><span className="font-medium">{o.label}</span><span className="block text-muted-foreground">{o.hint}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={post.isPending}>Keep counting</Button>
          <Button onClick={confirm} disabled={post.isPending}>
            {post.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Post stocktake
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
