import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDownIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Product } from '@/features/products/api'
import { api } from '@/lib/api/client'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import { toVariantOptions, type VariantOption } from '@/components/common/variant-options'

type Props = {
  value: VariantOption | null
  onChange: (option: VariantOption) => void
  /** Only stock-tracked goods (adjustments, transfers). */
  stockedOnly?: boolean
  invalid?: boolean
  'aria-label'?: string
}

/**
 * Searches active products by name, SKU or scanned barcode and picks one variant.
 */
export function VariantPicker({ value, onChange, stockedOnly = false, invalid, ...props }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search, 250)

  const results = useQuery({
    queryKey: ['variant-picker', term],
    queryFn: ({ signal }) =>
      api.get<Product[]>('/products', { signal, query: { search: term || undefined, is_active: 1, per_page: 20 } }).then((r) => toVariantOptions(r.data)),
    enabled: open,
    staleTime: 30_000,
  })
  const options = (results.data ?? []).filter((o) => !stockedOnly || o.track_stock)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={props['aria-label'] ?? 'Product'}
          aria-invalid={invalid || undefined}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="truncate">{value ? value.label : 'Search product, SKU or scan…'}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Name, SKU or barcode" value={search} onValueChange={setSearch} />
          <CommandList>
            {results.isFetching && !results.data ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Searching…</div>
            ) : (
              <CommandEmpty>No matching products.</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={() => {
                    onChange(option)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{option.sku}{option.unit_code && ` · ${option.unit_code}`}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
