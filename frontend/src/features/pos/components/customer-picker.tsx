import { forwardRef, useState } from 'react'
import { UserIcon, UserXIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCustomersQuery } from '@/features/customers/api'
import type { CustomerRef } from '@/features/pos/cart-store'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Props = { value: CustomerRef | null; onChange: (customer: CustomerRef | null) => void; open: boolean; onOpenChange: (open: boolean) => void }

/** Walk-in by default; search active customers by name, phone or code (F4). */
export const CustomerPicker = forwardRef<HTMLButtonElement, Props>(function CustomerPicker({ value, onChange, open, onOpenChange }, ref) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search, 250)
  const customers = useCustomersQuery({ page: 1, search: term || undefined })
  const active = (customers.data?.items ?? []).filter((c) => c.is_active)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button ref={ref} type="button" variant="outline" className="min-w-0 justify-start" aria-label="Customer">
          <UserIcon data-icon="inline-start" />
          <span className="truncate">{value ? value.name : 'Walk-in customer'}</span>
          <kbd className="ml-auto hidden text-xs text-muted-foreground sm:inline">F4</kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Name, phone or code" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{customers.isFetching ? 'Searching…' : 'No customers found.'}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="__walk_in" onSelect={() => { onChange(null); onOpenChange(false) }}>
                  <UserXIcon /> Walk-in customer
                </CommandItem>
              )}
              {active.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange({ id: c.id, code: c.code, name: c.name, phone: c.phone })
                    onOpenChange(false)
                    setSearch('')
                  }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{[c.code, c.phone, c.group && `${c.group.name} −${c.group.discount_percent}%`].filter(Boolean).join(' · ')}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})
