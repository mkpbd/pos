import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ENTITY_SOURCES, type EntitySource, type Hit } from '@/features/reports/entity-sources'
import { api } from '@/lib/api/client'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'

/** Searchable record filters (product, customer, supplier, cashier) for report params. */

type Props = {
  paramKey: string
  /** Key of ENTITY_SOURCES (product, customer, supplier, cashier). */
  entity: string
  label: string
  value: string
  onChange: (id: string | null) => void
  /** False when the user may not search this list: the chosen record (from a shared link) can still be cleared. */
  canSearch: boolean
}

export function EntityFilter({ paramKey, entity, label, value, onChange, canSearch }: Props) {
  const source = ENTITY_SOURCES[entity] as EntitySource
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const [picked, setPicked] = useState<Hit | null>(null)

  const results = useQuery({
    queryKey: ['reports', 'entity-search', paramKey, term],
    queryFn: ({ signal }) => api.get<Record<string, unknown>[]>(source.list, { signal, query: { search: term || undefined, page: 1 } }).then((r) => r.data.map(source.describe)),
    enabled: open && canSearch,
    staleTime: 30_000,
  })
  const selected = useQuery({
    queryKey: ['reports', 'entity', paramKey, value],
    queryFn: ({ signal }) => api.get<Record<string, unknown>>(source.detail(value), { signal }).then((r) => source.describe(r.data)),
    enabled: !!value && canSearch && picked?.id !== value,
    staleTime: 5 * 60_000,
  })
  const current = value ? (picked?.id === value ? picked : selected.data ?? null) : null
  const triggerText = value ? current?.name ?? (selected.isPending && canSearch ? 'Loading…' : `Selected ${source.noun}`) : `All ${source.noun}s`
  const id = `report-${paramKey}`

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm leading-none font-medium select-none">{label}</span>
      <div className="flex items-center gap-1">
        {canSearch ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between font-normal sm:w-52" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open}>
                <span id={`${id}-value`} className={cn('truncate', !value && 'text-muted-foreground')}>{triggerText}</span>
                <ChevronsUpDownIcon className="opacity-50" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
              <Command shouldFilter={false} label={`Search ${source.noun}s`}>
                <CommandInput placeholder={source.placeholder} value={search} onValueChange={setSearch} aria-label={`Search ${source.noun}s`} />
                <CommandList>
                  <CommandEmpty>{results.isFetching ? 'Searching…' : `No ${source.noun}s found.`}</CommandEmpty>
                  <CommandGroup>
                    {(results.data ?? []).map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={hit.id}
                        onSelect={() => {
                          setPicked(hit)
                          onChange(hit.id)
                          setOpen(false)
                          setSearch('')
                        }}
                      >
                        <CheckIcon className={cn(hit.id === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{hit.name}</span>
                          {hit.hint && <span className="truncate text-xs text-muted-foreground">{hit.hint}</span>}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="flex h-9 items-center rounded-md border px-3 text-sm text-muted-foreground">{triggerText}</span>
        )}
        {value && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Clear ${label.toLowerCase()} filter`} onClick={() => onChange(null)}>
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  )
}
