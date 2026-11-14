import { useState } from 'react'
import { ChevronsUpDownIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProductSearchQuery } from '@/features/online-catalog/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Props = {
  /** The chosen product's id, or null for every product. */
  value: string | null
  /** Its name for the chip (null while unknown). */
  name: string | null
  onChange: (product: { id: string; name: string } | null) => void
  /** Searching products needs products.view; without it only a chosen product can be cleared. */
  canSearch: boolean
}

/** "All products" or one product, chosen with a product search (GET /products?search=). */
export function ProductFilter({ value, name, onChange, canSearch }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useProductSearchQuery(term, open)
  const hits = results.data?.items ?? []

  if (value) {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 py-1 pr-1 pl-2.5 text-sm" data-testid="product-filter">
        <span className="truncate">
          Product: <span className="font-medium">{name ?? 'the chosen product'}</span>
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Show questions about all products" onClick={() => onChange(null)}>
          <XIcon />
        </Button>
      </span>
    )
  }
  if (!canSearch) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The name keeps the visible words ("All products") for speech input users. */}
        <Button type="button" variant="outline" className="justify-between gap-2" aria-label="Filter by product: All products">
          All products
          <ChevronsUpDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false} label="Filter by product">
          <CommandInput placeholder="Search name, SKU or barcode" value={search} onValueChange={setSearch} aria-label="Search products" />
          <CommandList>
            <CommandEmpty>{results.isFetching ? 'Searching…' : 'No products found.'}</CommandEmpty>
            <CommandGroup>
              {hits.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onChange({ id: p.id, name: p.name })
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{p.name}</span>
                    {p.variants[0]?.sku && <span className="text-xs text-muted-foreground">{p.variants[0].sku}</span>}
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
