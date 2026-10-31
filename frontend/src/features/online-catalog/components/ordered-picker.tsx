import { useState, type ReactNode } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProductSearchQuery } from '@/features/online-catalog/api'
import { moveItem, type PickedItem } from '@/features/online-catalog/move'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export type { PickedItem } from '@/features/online-catalog/move'

type ListProps<T extends PickedItem> = {
  /** Accessible name of the list, e.g. "Related products". */
  label: string
  value: T[]
  onChange: (value: T[]) => void
  disabled?: boolean
  /** The control that appends items (search popover or select). */
  adder?: ReactNode
  hint?: ReactNode
  error?: string
}

/** An ordered list of chosen records with move up/down and remove. */
export function OrderedList<T extends PickedItem>({ label, value, onChange, disabled, adder, hint, error }: ListProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label} <span className="font-normal text-muted-foreground">({value.length})</span></span>
      {value.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label={label}>
          {value.map((item, i) => (
            <li key={item.id} className="flex items-center gap-3 rounded-md border p-2">
              {item.image_url !== undefined && (
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                  {item.image_url ? <img src={item.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.name}</span>
                {item.sku && <span className="block truncate text-xs text-muted-foreground">{item.sku}</span>}
              </span>
              {!disabled && (
                <span className="flex shrink-0">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${item.name} up`} disabled={i === 0} onClick={() => onChange(moveItem(value, i, -1))}><ArrowUpIcon /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${item.name} down`} disabled={i === value.length - 1} onClick={() => onChange(moveItem(value, i, 1))}><ArrowDownIcon /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((x) => x.id !== item.id))}><XIcon /></Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {!disabled && adder}
      {error ? <p className="text-sm text-destructive">{error}</p> : hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Searches products (GET /products?search=) and appends the chosen one. */
export function ProductSearchAdder({ label, exclude, onPick, disabled }: { label: string; exclude: string[]; onPick: (item: PickedItem) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useProductSearchQuery(term, open)
  const hits = (results.data?.items ?? []).filter((p) => !exclude.includes(p.id))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled}>
          <PlusIcon data-icon="inline-start" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false} label={label}>
          <CommandInput placeholder="Search name, SKU or barcode" value={search} onValueChange={setSearch} aria-label="Search products" />
          <CommandList>
            <CommandEmpty>{results.isFetching ? 'Searching…' : 'No products found.'}</CommandEmpty>
            <CommandGroup>
              {hits.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onPick({ id: p.id, name: p.name, image_url: p.images[0]?.url ?? null, sku: p.variants[0]?.sku ?? null })
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{[p.variants[0]?.sku, p.is_active ? null : 'inactive'].filter(Boolean).join(' · ')}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Ordered product list with search; used for related products and manual homepage sections. */
export function ProductPicker({ label, addLabel, value, onChange, max, excludeIds = [], disabled, hint, error }: {
  label: string
  addLabel: string
  value: PickedItem[]
  onChange: (value: PickedItem[]) => void
  max: number
  excludeIds?: string[]
  disabled?: boolean
  hint?: ReactNode
  error?: string
}) {
  return (
    <OrderedList
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hint={hint ?? `Up to ${max}.`}
      error={error}
      adder={value.length < max && <ProductSearchAdder label={addLabel} exclude={[...excludeIds, ...value.map((v) => v.id)]} onPick={(item) => onChange([...value, item])} />}
    />
  )
}

/** Ordered list fed by a known set of options (categories, brands). */
export function OptionPicker({ label, addLabel, value, onChange, options, max, disabled, hint, error }: {
  label: string
  addLabel: string
  value: PickedItem[]
  onChange: (value: PickedItem[]) => void
  options: PickedItem[]
  max: number
  disabled?: boolean
  hint?: ReactNode
  error?: string
}) {
  const rest = options.filter((o) => !value.some((v) => v.id === o.id))

  return (
    <OrderedList
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hint={hint ?? `Up to ${max}.`}
      error={error}
      adder={
        value.length < max &&
        rest.length > 0 && (
          <Select
            value=""
            onValueChange={(id) => {
              const option = rest.find((o) => o.id === id)
              if (option) onChange([...value, option])
            }}
          >
            <SelectTrigger aria-label={addLabel} className="w-full sm:w-72"><SelectValue placeholder={`${addLabel}…`} /></SelectTrigger>
            <SelectContent>{rest.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
          </Select>
        )
      }
    />
  )
}
