import { useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCustomersQuery } from '@/features/customers/api'
import type { DraftCustomer } from '@/features/web-orders/order-entry'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/** Mounted only while the popover is open, so customers are fetched only when someone searches. */
function CustomerResults({ onSelect }: { onSelect: (customer: DraftCustomer) => void }) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const customers = useCustomersQuery({ page: 1, search: term || undefined })
  const active = (customers.data?.items ?? []).filter((c) => c.is_active)

  return (
    <Command shouldFilter={false}>
      <CommandInput placeholder="Name, phone or code" aria-label="Search customers" value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>{customers.isFetching ? 'Searching…' : 'No customers found.'}</CommandEmpty>
        <CommandGroup>
          {active.map((c) => (
            <CommandItem key={c.id} value={c.id} onSelect={() => onSelect({ id: c.id, name: c.name, code: c.code, phone: c.phone, email: c.email })}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{c.name}</span>
                <span className="text-xs text-muted-foreground">{[c.code, c.phone].filter(Boolean).join(' · ')}</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** Finds an existing customer by name, phone or code (customers.view) to link the order to. */
export function CustomerSearch({ onSelect }: { onSelect: (customer: DraftCustomer) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start font-normal sm:w-auto">
          <SearchIcon data-icon="inline-start" /> Find an existing customer
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {open && (
          <CustomerResults
            onSelect={(customer) => {
              onSelect(customer)
              setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
