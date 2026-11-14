import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BellIcon, Loader2Icon, PackagePlusIcon, PlusIcon, Trash2Icon, Undo2Icon, WandSparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/features/auth/use-auth'
import { useBranchesQuery } from '@/features/branches/api'
import { useAttributesQuery } from '@/features/catalog/api'
import { useSaveVariantGridMutation, type Product } from '@/features/products/api'
import { StockAdjustDialog, type StockTarget } from '@/features/products/components/stock-adjust-dialog'
import {
  applyBulk,
  bulkValueError,
  combinationCount,
  defaultSkuBase,
  generateRows,
  gridErrorKey,
  MAX_OPTIONS,
  MAX_VARIANTS,
  parseClipboard,
  rowLabel,
  rowsWithValue,
  skuFor,
  splitValues,
  toGridInput,
  toGridValues,
  TooManyVariantsError,
  variantGridSchema,
  type BulkAction,
  type GridRow,
  type VariantGridValues,
} from '@/features/products/variant-grid'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

/** Editable text columns in keyboard order. */
const COLUMNS = [
  { key: 'sku', label: 'SKU', short: 'SKU', mono: true, width: 'w-52' },
  { key: 'barcodes', label: 'Barcodes', short: 'Barcodes', mono: true, width: 'w-40' },
  { key: 'purchase_price', label: 'Cost price', short: 'Cost', decimal: true, width: 'w-24' },
  { key: 'selling_price', label: 'Selling price', short: 'Selling', decimal: true, width: 'w-24' },
  { key: 'wholesale_price', label: 'Wholesale price', short: 'Wholesale', decimal: true, width: 'w-24' },
  { key: 'compare_at_price', label: 'Compare-at price', short: 'Compare-at (web)', decimal: true, width: 'w-24' },
  { key: 'reorder_level', label: 'Reorder level', short: 'Reorder at', decimal: true, width: 'w-20' },
  { key: 'opening_stock', label: 'Opening stock', short: 'Stock', decimal: true, width: 'w-20' },
] as const
type ColumnKey = (typeof COLUMNS)[number]['key']

const BULK_ACTIONS: { id: string; label: string; action: Pick<BulkAction, 'kind'> & { field?: string; value?: boolean }; compare?: boolean }[] = [
  { id: 'selling_price:set', label: 'Set selling price', action: { kind: 'set', field: 'selling_price' } },
  { id: 'selling_price:percent', label: 'Change selling price by %', action: { kind: 'percent', field: 'selling_price' } },
  { id: 'purchase_price:set', label: 'Set cost price', action: { kind: 'set', field: 'purchase_price' } },
  { id: 'purchase_price:percent', label: 'Change cost price by %', action: { kind: 'percent', field: 'purchase_price' } },
  { id: 'wholesale_price:set', label: 'Set wholesale price', action: { kind: 'set', field: 'wholesale_price' } },
  { id: 'compare_at_price:set', label: 'Set compare-at price', action: { kind: 'set', field: 'compare_at_price' }, compare: true },
  { id: 'reorder_level:set', label: 'Set reorder level', action: { kind: 'set', field: 'reorder_level' } },
  { id: 'active:true', label: 'Activate', action: { kind: 'active', value: true } },
  { id: 'active:false', label: 'Deactivate', action: { kind: 'active', value: false } },
]

function initialSkuBase(product: Product): string {
  const withOptions = product.variants.find((v) => Object.keys(v.option_values).length > 0 && v.sku.includes('-') && !/^SKU-\d+$/.test(v.sku))
  return withOptions ? (withOptions.sku.split('-')[0] ?? '') : defaultSkuBase(product.name)
}

function stockOf(product: Product, variantId: string | undefined, storeId: string): string | null {
  const stock = product.variants.find((v) => v.id === variantId)?.stock
  if (!stock) return null
  if (!storeId) return trimDecimal(stock.total)
  return trimDecimal(stock.by_store.find((s) => s.store_id === storeId)?.quantity ?? '0')
}

type Props = { product: Product }

/**
 * The product's variants as a spreadsheet-like grid (P1a §2): options → Generate → one row per
 * combination with SKU, barcodes, prices, compare-at, reorder level, stock and active. Arrow
 * keys / Enter move between cells, a block copied from a spreadsheet pastes across cells, and
 * bulk edits apply to selected rows or every row of a value ("all Red"). Saved in one request
 * (PUT /products/{id}/variants); stock only changes through Inventory adjustments.
 */
export function VariantGrid({ product }: Props) {
  const can = useCan()
  const ids = useId()
  const save = useSaveVariantGridMutation(product.id)
  const attributes = useAttributesQuery()
  const canAdjust = can('inventory.adjust')
  const canCompare = can('online_catalog.manage')
  const stockable = product.type === 'standard' && product.track_stock
  const simpleStock = stockable && !product.track_batches && !product.track_serials
  const showStock = stockable && (product.variants.some((v) => v.stock) || (simpleStock && canAdjust))

  const form = useForm<VariantGridValues>({ resolver: zodResolver(variantGridSchema), defaultValues: toGridValues(product) })
  const { errors, isDirty } = form.formState
  const options = useFieldArray({ control: form.control, name: 'options' })
  const variants = useFieldArray({ control: form.control, name: 'variants' })
  const watchedOptions = useWatch({ control: form.control, name: 'options' })
  const [skuBase, setSkuBase] = useState(() => initialSkuBase(product))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkId, setBulkId] = useState('selling_price:set')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [stockStore, setStockStore] = useState('')
  const [adjusting, setAdjusting] = useState<StockTarget[] | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  // Structural values (ids, combinations) only change through generate/reset, which re-render via `variants.fields`.
  const rows: GridRow[] = form.getValues('variants') ?? []
  const liveRows = rows.flatMap((r, i) => (r.removed ? [] : [i]))
  const removedRows = rows.flatMap((r, i) => (r.removed ? [i] : []))
  const optionList = (watchedOptions ?? []).map((o) => ({ name: (o?.name ?? '').trim(), values: splitValues(o?.values ?? '') })).filter((o) => o.name && o.values.length)
  const count = combinationCount(watchedOptions ?? [])
  const hasNewRows = rows.some((r) => !r.id && !r.removed)
  const columns = COLUMNS.filter((c) => (c.key === 'compare_at_price' ? canCompare || rows.some((r) => r.compare_at_price) : c.key === 'opening_stock' ? simpleStock && canAdjust && hasNewRows : true))
  const columnKeys = columns.map((c) => c.key)

  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  const stockStores = useMemo(() => {
    const present = new Set(product.variants.flatMap((v) => v.stock?.by_store.map((s) => s.store_id) ?? []))
    return (branches.data?.items ?? []).flatMap((b) => b.stores.filter((s) => present.has(s.id)).map((s) => ({ id: s.id, label: `${s.name} (${b.name})` })))
  }, [branches.data, product.variants])

  const attributeFor = (name: string | undefined) => (attributes.data ?? []).find((a) => a.name.toLowerCase() === (name ?? '').trim().toLowerCase())

  const generate = () => {
    const current = form.getValues()
    try {
      const next = generateRows(current.options, current.variants, skuBase)
      variants.replace(next)
      setSelected(new Set())
      setGenerateError(null)
      const added = next.filter((r) => !r.id).length
      toast.success(`${next.filter((r) => !r.removed).length} variants${added ? `, ${added} new` : ''}. Check the prices, then save.`)
    } catch (e) {
      if (e instanceof TooManyVariantsError) setGenerateError(e.message)
      else throw e
    }
  }

  const applySkuBase = () => {
    const current = form.getValues('variants')
    current.forEach((row, i) => {
      if (!row.id && !row.removed && optionList.length) form.setValue(`variants.${i}.sku`, skuFor(skuBase, row.option_values, optionList), { shouldDirty: true })
    })
  }

  const bulk = BULK_ACTIONS.find((b) => b.id === bulkId) ?? BULK_ACTIONS[0]!
  const applyBulkEdit = () => {
    const targets = [...selected].filter((i) => !rows[i]?.removed)
    if (targets.length === 0) return
    const error = bulkValueError(bulk.action, bulkValue)
    setBulkError(error)
    if (error) return
    const action: BulkAction =
      bulk.action.kind === 'active'
        ? { kind: 'active', value: !!bulk.action.value }
        : bulk.action.kind === 'percent'
          ? { kind: 'percent', field: bulk.action.field as 'selling_price', percent: bulkValue }
          : { kind: 'set', field: bulk.action.field as 'selling_price', value: bulkValue }
    const current = form.getValues('variants')
    const next = applyBulk(current, targets, action)
    const field = action.kind === 'active' ? 'is_active' : action.field
    targets.forEach((i) => {
      const value = next[i]?.[field]
      if (value !== undefined && value !== current[i]?.[field]) form.setValue(`variants.${i}.${field}` as Path<VariantGridValues>, value, { shouldDirty: true })
    })
    toast.success(`${bulk.label.replace(/^Set /, '').replace(/^Change /, '').replace(/ by %$/, '')}: updated ${targets.length} ${targets.length === 1 ? 'variant' : 'variants'}.`)
  }

  const toggle = (i: number, on: boolean) => setSelected((s) => {
    const next = new Set(s)
    if (on) next.add(i)
    else next.delete(i)
    return next
  })
  const allSelected = liveRows.length > 0 && liveRows.every((i) => selected.has(i))

  // Spreadsheet keys: arrows and Enter move between cells of the same column / row.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target
    if (!(target instanceof HTMLInputElement) || !target.dataset.col) return
    const row = Number(target.dataset.row)
    const col = columnKeys.indexOf(target.dataset.col as ColumnKey)
    let dr = 0
    let dc = 0
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) dr = 1
    else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) dr = -1
    else if (e.key === 'ArrowLeft' && target.selectionStart === 0 && target.selectionEnd === 0) dc = -1
    else if (e.key === 'ArrowRight' && target.selectionStart === target.value.length && target.selectionEnd === target.value.length) dc = 1
    else return
    if (e.key === 'Enter') e.preventDefault()
    const find = (r: number, c: number) => tableRef.current?.querySelector<HTMLInputElement>(`input[data-row="${r}"][data-col="${columnKeys[c]}"]`)
    let next: HTMLInputElement | null | undefined = null
    if (dr) for (let r = row + dr; r >= 0 && r < rows.length && !next; r += dr) next = find(r, col)
    if (dc) for (let c = col + dc; c >= 0 && c < columnKeys.length && !next; c += dc) next = find(row, c)
    if (next) {
      e.preventDefault()
      next.focus()
      next.select()
    }
  }

  // Pasting a block copied from a spreadsheet fills cells to the right and below.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const target = e.target
    if (!(target instanceof HTMLInputElement) || !target.dataset.col) return
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const startRow = Number(target.dataset.row)
    const startCol = columnKeys.indexOf(target.dataset.col as ColumnKey)
    const order = rows.flatMap((r, i) => (r.removed || i < startRow ? [] : [i]))
    let filled = 0
    parseClipboard(text).forEach((cells, dr) => {
      const r = order[dr]
      if (r === undefined) return
      cells.forEach((value, dc) => {
        const key = columnKeys[startCol + dc]
        if (!key || (key === 'opening_stock' && rows[r]?.id)) return
        form.setValue(`variants.${r}.${key}`, value, { shouldDirty: true })
        filled++
      })
    })
    toast.success(`Pasted ${filled} ${filled === 1 ? 'cell' : 'cells'}.`)
  }

  const onSubmit = form.handleSubmit((values) => {
    const { input, rowOf: map } = toGridInput(values)
    save.mutate(input, {
      onSuccess: (saved) => {
        toast.success('Variants saved.')
        setSelected(new Set())
        form.reset(toGridValues(saved))
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED' && Object.keys(error.fieldErrors).length) {
          for (const [key, messages] of Object.entries(error.fieldErrors)) {
            let path = gridErrorKey(key, map).replace(/\.barcodes\.\d+$/, '.barcodes')
            if (path === 'variants') path = 'variants.root'
            form.setError(path as Path<VariantGridValues>, { type: 'server', message: messages[0] })
          }
          toast.error('Please correct the highlighted cells.')
        } else {
          toast.error(error.message)
        }
      },
    })
  })

  const rowError = (i: number, key: string): string | undefined => {
    const row = errors.variants?.[i] as Record<string, { message?: string } | undefined> | undefined
    return row?.[key]?.message
  }
  const rootError = errors.variants?.root?.message ?? errors.variants?.message

  return (
    <Card id="variants" role="region" aria-labelledby={`${ids}-title`}>
      <CardHeader>
        <CardTitle id={`${ids}-title`}>Variants, prices & stock</CardTitle>
        <CardDescription>
          List the options (for example Size and Colour), press Generate, then fill the grid like a spreadsheet: arrow keys and Enter move between
          cells, and you can paste a block copied from Excel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate aria-label="Variants" className="flex flex-col gap-5">
          <section aria-labelledby={`${ids}-options`} className="flex flex-col gap-3 rounded-md border p-3">
            <h3 id={`${ids}-options`} className="text-sm font-semibold">Options</h3>
            {options.fields.length === 0 && <p className="text-sm text-muted-foreground">No options: this product is sold as a single item. Add an option such as Size or Colour to sell it in several versions.</p>}
            {options.fields.map((option, i) => {
              const attribute = attributeFor(watchedOptions?.[i]?.name)
              const listed = new Set(splitValues(watchedOptions?.[i]?.values ?? '').map((v) => v.toLowerCase()))
              const suggestions = (attribute?.values ?? []).filter((v) => !listed.has(v.value.toLowerCase())).slice(0, 24)
              const nameError = errors.options?.[i]?.name?.message
              const valuesError = errors.options?.[i]?.values?.message
              return (
                <div key={option.id} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${ids}-o${i}-name`}>Option {i + 1}</Label>
                    <Input id={`${ids}-o${i}-name`} placeholder="e.g. Size" list={`${ids}-attributes`} aria-invalid={nameError ? true : undefined} {...form.register(`options.${i}.name`)} />
                    {nameError && <p className="text-sm text-destructive">{nameError}</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${ids}-o${i}-values`}>Values of option {i + 1}</Label>
                    <Input id={`${ids}-o${i}-values`} placeholder="Comma separated, e.g. S, M, L" aria-invalid={valuesError ? true : undefined} {...form.register(`options.${i}.values`)} />
                    {valuesError && <p className="text-sm text-destructive">{valuesError}</p>}
                    {suggestions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1" aria-label={`Known ${attribute?.name} values`} role="group">
                        <span className="text-xs text-muted-foreground">Add:</span>
                        {suggestions.map((v) => (
                          <Button
                            key={v.id}
                            type="button"
                            variant="outline"
                            size="xs"
                            aria-label={`Add ${v.value} to ${attribute?.name}`}
                            onClick={() => {
                              const current = form.getValues(`options.${i}.values`).trim()
                              form.setValue(`options.${i}.values`, current ? `${current.replace(/,\s*$/, '')}, ${v.value}` : v.value, { shouldDirty: true })
                            }}
                          >
                            {v.swatch_hex && <span aria-hidden className="size-3 rounded-full border" style={{ background: v.swatch_hex }} />}
                            {v.value}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="sm:mt-6" aria-label={`Remove option ${i + 1}`} onClick={() => options.remove(i)}>
                    <Trash2Icon />
                  </Button>
                </div>
              )
            })}
            <datalist id={`${ids}-attributes`}>
              {(attributes.data ?? []).map((a) => <option key={a.id} value={a.name} />)}
            </datalist>
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" variant="outline" size="sm" disabled={options.fields.length >= MAX_OPTIONS} onClick={() => options.append({ name: '', values: '' })}>
                <PlusIcon data-icon="inline-start" /> Add option
              </Button>
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${ids}-sku-base`} className="text-xs">SKU start</Label>
                  <Input id={`${ids}-sku-base`} className="h-7 w-32 font-mono text-xs" value={skuBase} maxLength={20} onChange={(e) => setSkuBase(e.target.value.replace(/[^A-Za-z0-9\-_]/g, '').toUpperCase())} />
                </div>
                {hasNewRows && optionList.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={applySkuBase}>Use for new SKUs</Button>
                )}
              </div>
              <Button type="button" size="sm" onClick={generate} disabled={count > MAX_VARIANTS}>
                <WandSparklesIcon data-icon="inline-start" /> Generate {count} {count === 1 ? 'variant' : 'variants'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              New SKUs follow {skuBase || 'SKU'}-VALUE-VALUE; existing variants keep their SKU, prices and stock. Up to {MAX_VARIANTS} variants.
            </p>
            {(generateError || count > MAX_VARIANTS) && <p role="alert" className="text-sm text-destructive">{generateError ?? `These options make ${count} variants; the limit is ${MAX_VARIANTS}.`}</p>}
          </section>

          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Select variants">
            {optionList.length > 0 && (
              <Select
                value=""
                onValueChange={(v) => {
                  if (v === '__all') return setSelected(new Set(liveRows))
                  const [name, value] = JSON.parse(v) as [string, string]
                  setSelected(new Set(rowsWithValue(rows, name, value).filter((i) => !rows[i]?.removed)))
                }}
              >
                <SelectTrigger size="sm" aria-label="Select rows by value" className="w-48"><SelectValue placeholder="Select rows…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All variants</SelectItem>
                  {optionList.map((o) => (
                    <SelectGroup key={o.name}>
                      <SelectLabel>{o.name}</SelectLabel>
                      {o.values.map((v) => <SelectItem key={v} value={JSON.stringify([o.name, v])}>All {v}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
            {showStock && stockStores.length > 1 && (
              <Select value={stockStore || '__total'} onValueChange={(v) => setStockStore(v === '__total' ? '' : v)}>
                <SelectTrigger size="sm" aria-label="Stock shown for" className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__total">Stock: all stores</SelectItem>
                  {stockStores.map((s) => <SelectItem key={s.id} value={s.id}>Stock: {s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {selected.size > 0 && (
            <div role="region" aria-label="Bulk edit" className="flex flex-wrap items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
              <span className="self-center text-sm font-medium">{selected.size} selected</span>
              <Select value={bulkId} onValueChange={(v) => { setBulkId(v); setBulkError(null) }}>
                <SelectTrigger size="sm" aria-label="Bulk action" className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BULK_ACTIONS.filter((b) => !b.compare || canCompare).map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {bulk.action.kind !== 'active' && (
                <div className="flex flex-col gap-1">
                  <Input
                    aria-label="Bulk value"
                    className="h-7 w-28"
                    inputMode="decimal"
                    placeholder={bulk.action.kind === 'percent' ? 'e.g. 10 or -15' : bulk.action.field === 'compare_at_price' || bulk.action.field === 'wholesale_price' ? 'Empty clears' : '0.00'}
                    value={bulkValue}
                    aria-invalid={bulkError ? true : undefined}
                    onChange={(e) => setBulkValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        applyBulkEdit()
                      }
                    }}
                  />
                  {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}
                </div>
              )}
              <Button type="button" size="sm" onClick={applyBulkEdit}>Apply to {selected.size}</Button>
              {simpleStock && canAdjust && [...selected].some((i) => rows[i]?.id && !rows[i]?.removed) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setAdjusting(
                      [...selected]
                        .filter((i) => rows[i]?.id && !rows[i]?.removed)
                        .sort((a, b) => a - b)
                        .map((i) => ({ variant_id: rows[i]!.id!, label: rowLabel(rows[i]!, optionList), stock: product.variants.find((v) => v.id === rows[i]!.id)?.stock })),
                    )
                  }
                >
                  <PackagePlusIcon data-icon="inline-start" /> Adjust stock
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </div>
          )}

          <div ref={tableRef} className="relative overflow-x-auto rounded-md border" onKeyDown={onKeyDown} onPaste={onPaste}>
            <table className="w-full text-sm" aria-label="Variant grid">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-9 min-w-9 bg-muted px-2 py-2">
                    <Checkbox aria-label="Select all variants" checked={allSelected} onCheckedChange={(on) => setSelected(on === true ? new Set(liveRows) : new Set())} />
                  </th>
                  <th scope="col" className="sticky left-9 z-10 min-w-32 bg-muted px-2 py-2 font-medium">Variant</th>
                  {columns.map((c) => <th key={c.key} scope="col" className="px-1 py-2 font-medium whitespace-nowrap">{c.key === 'opening_stock' ? 'Opening stock' : c.short}</th>)}
                  {showStock && <th scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap">In stock</th>}
                  <th scope="col" className="px-2 py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {variants.fields.map((field, i) => {
                  const row = rows[i]
                  if (!row || row.removed) return null
                  const label = rowLabel(row, optionList)
                  const saved = row.id ? product.variants.find((v) => v.id === row.id) : undefined
                  const stock = row.id ? stockOf(product, row.id, stockStore) : null
                  const low = stock !== null && saved && compareDecimal(saved.reorder_level, '0') > 0 && !stock.startsWith('-') && compareDecimal(stock, trimDecimal(saved.reorder_level)) <= 0
                  const comboError = rowError(i, 'option_values')
                  return (
                    <tr key={field.id} className={cn('border-t align-top', selected.has(i) && 'bg-primary/5')}>
                      <td className="sticky left-0 z-[1] w-9 min-w-9 bg-card px-2 py-2">
                        <Checkbox aria-label={`Select ${label}`} checked={selected.has(i)} onCheckedChange={(on) => toggle(i, on === true)} />
                      </td>
                      <th scope="row" className="sticky left-9 z-[1] bg-card px-2 py-2 text-left font-medium">
                        <span className="block whitespace-nowrap">{label}</span>
                        {!row.id && <Badge variant="info" className="mt-0.5">New</Badge>}
                        {(saved?.back_in_stock_open ?? 0) > 0 && (
                          <a href="#back-in-stock" className="mt-0.5 flex items-center gap-1 text-xs font-normal text-primary underline-offset-2 hover:underline">
                            <BellIcon className="size-3" aria-hidden /> {saved!.back_in_stock_open} waiting
                          </a>
                        )}
                        {comboError && <p className="text-xs font-normal text-destructive">{comboError}</p>}
                      </th>
                      {columns.map((c) => {
                        const error = rowError(i, c.key)
                        if (c.key === 'opening_stock' && row.id) return <td key={c.key} className="px-1 py-1.5 text-xs text-muted-foreground">—</td>
                        return (
                          <td key={c.key} className="px-1 py-1.5">
                            <Input
                              data-row={i}
                              data-col={c.key}
                              aria-label={`${c.label} for ${label}`}
                              aria-invalid={error ? true : undefined}
                              className={cn('h-8 px-2', c.width, 'mono' in c && c.mono && 'font-mono text-xs', 'decimal' in c && c.decimal && 'text-right tabular-nums')}
                              inputMode={'decimal' in c && c.decimal ? 'decimal' : undefined}
                              placeholder={c.key === 'sku' ? 'Auto' : c.key === 'wholesale_price' || c.key === 'compare_at_price' ? '—' : c.key === 'opening_stock' ? '0' : undefined}
                              disabled={c.key === 'compare_at_price' && !canCompare}
                              {...form.register(`variants.${i}.${c.key}`)}
                            />
                            {error && <p className={cn('mt-0.5 text-xs text-destructive', c.width)}>{error}</p>}
                          </td>
                        )
                      })}
                      {showStock && (
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {row.id ? (
                            <span className="inline-flex items-center gap-1">
                              <span className={cn('tabular-nums', low && 'font-semibold text-warning-soft-foreground')}>{stock ?? '—'}</span>
                              {low && <span className="sr-only">(low)</span>}
                              {simpleStock && canAdjust && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  aria-label={`Adjust stock of ${label}`}
                                  onClick={() => setAdjusting([{ variant_id: row.id!, label, stock: saved?.stock }])}
                                >
                                  Adjust
                                </Button>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">after saving</span>
                          )}
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <Controller control={form.control} name={`variants.${i}.is_active`} render={({ field: f }) => (
                          <Switch aria-label={`Active: ${label}`} checked={f.value} onCheckedChange={f.onChange} />
                        )} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {removedRows.length > 0 && (
            <div className="rounded-md border border-dashed p-3 text-sm">
              <p className="font-medium">No longer in the options ({removedRows.length})</p>
              <p className="text-muted-foreground">
                On save these are switched off (kept for their sales and stock history) or removed if they were never used. Add the value back and
                generate again to keep one.
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Variants no longer in the options">
                {removedRows.map((i) => <li key={i}><Badge variant="outline">{rowLabel(rows[i]!)} · {rows[i]!.sku}</Badge></li>)}
              </ul>
            </div>
          )}

          {stockable && !simpleStock && canAdjust && <p className="text-sm text-muted-foreground">This product tracks batches or serial numbers: change its stock under Inventory → Adjustments.</p>}

          {simpleStock && canAdjust && hasNewRows && (
            <div className="flex max-w-md flex-col gap-1.5">
              <Label>Opening stock goes to</Label>
              <Controller control={form.control} name="stock_store_id" render={({ field }) => (
                <StoreSelect value={field.value || null} onChange={field.onChange} aria-label="Opening stock goes to" invalid={!!errors.stock_store_id} />
              )} />
              {errors.stock_store_id?.message ? <p className="text-sm text-destructive">{errors.stock_store_id.message}</p> : <p className="text-xs text-muted-foreground">Only for the new rows, recorded as opening stock when you save.</p>}
            </div>
          )}

          {rootError && <p role="alert" className="text-sm text-destructive">{rootError}</p>}

          <div className={cn('flex flex-wrap items-center justify-end gap-3 border-t pt-4', isDirty && 'sticky bottom-0 z-20 -mx-4 bg-card/95 px-4 pb-3 backdrop-blur')}>
            {isDirty && <span className="text-sm text-muted-foreground">Unsaved variant changes</span>}
            {isDirty && (
              <Button type="button" variant="ghost" onClick={() => { form.reset(toGridValues(product)); setSelected(new Set()) }}>
                <Undo2Icon data-icon="inline-start" /> Undo changes
              </Button>
            )}
            <Button type="submit" disabled={save.isPending || !isDirty}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save variants
            </Button>
          </div>
        </form>
        {adjusting && <StockAdjustDialog productId={product.id} targets={adjusting} allowDecimal={product.unit?.allow_decimal ?? false} onClose={() => setAdjusting(null)} />}
      </CardContent>
    </Card>
  )
}
