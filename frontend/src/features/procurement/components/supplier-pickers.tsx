import { useState } from 'react'
import { MailIcon, MailXIcon, SearchIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSuppliersQuery } from '@/features/suppliers/api'
import type { SupplierSummary } from '@/features/procurement/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const NONE = '__none__'

/** Optional supplier (active suppliers, plus the current one even when it is not in the first page). */
export function OptionalSupplierSelect({ value, current, onChange, label, size = 'default', noneLabel = 'No preference' }: {
  value: string | null
  current?: SupplierSummary | null
  onChange: (supplier: SupplierSummary | null) => void
  label: string
  size?: 'sm' | 'default'
  noneLabel?: string
}) {
  const suppliers = useSuppliersQuery({ page: 1 })
  const active = (suppliers.data?.items ?? []).filter((s) => s.is_active)
  const options: SupplierSummary[] = current && value === current.id && !active.some((s) => s.id === current.id) ? [current, ...active] : active

  return (
    <Select value={value ?? NONE} onValueChange={(id) => onChange(id === NONE ? null : (options.find((s) => s.id === id) ?? null))}>
      <SelectTrigger size={size} className="w-full min-w-36" aria-label={label}>
        <SelectValue placeholder={suppliers.isPending ? 'Loading suppliers…' : noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}><span className="text-muted-foreground">{noneLabel}</span></SelectItem>
        {options.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function EmailBadge({ email }: { email: string | null | undefined }) {
  return email ? (
    <Badge variant="info" title={email}><MailIcon aria-hidden /> E-mail</Badge>
  ) : (
    <Badge variant="outline" title="No e-mail address: send the PDF manually"><MailXIcon aria-hidden /> No e-mail</Badge>
  )
}

/** Checklist of active suppliers to invite to an RFQ, each marked with or without an e-mail address. */
export function SupplierChecklist({ selected, onChange, exclude = [], hint }: {
  selected: SupplierSummary[]
  onChange: (suppliers: SupplierSummary[]) => void
  /** Suppliers already invited (not offered again). */
  exclude?: string[]
  hint?: string
}) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const suppliers = useSuppliersQuery({ page: 1, search: term || undefined })
  const active = (suppliers.data?.items ?? []).filter((s) => s.is_active && !exclude.includes(s.id))
  const chosen = new Set(selected.map((s) => s.id))
  const toggle = (s: SupplierSummary, on: boolean) => onChange(on ? [...selected.filter((x) => x.id !== s.id), s] : selected.filter((x) => x.id !== s.id))
  // Chosen suppliers stay listed even when the search hides them.
  const rows: SupplierSummary[] = [...selected.filter((s) => !active.some((a) => a.id === s.id)), ...active]

  return (
    <div className="flex flex-col gap-2">
      <div className="relative sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search suppliers" placeholder="Supplier name or code" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border" aria-label="Suppliers to invite">
        {suppliers.isPending && rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">Loading suppliers…</li>}
        {!suppliers.isPending && rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No active suppliers match.</li>}
        {rows.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
              <Checkbox checked={chosen.has(s.id)} onCheckedChange={(v) => toggle({ id: s.id, code: s.code, name: s.name, email: s.email ?? null }, v === true)} aria-label={`Invite ${s.name}`} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>
                {s.code && <span className="ml-1 font-mono text-xs text-muted-foreground">{s.code}</span>}
              </span>
              <EmailBadge email={s.email} />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground" aria-live="polite">{selected.length} {selected.length === 1 ? 'supplier' : 'suppliers'} {hint ?? 'invited — invite at least 2 to compare quotes.'}</p>
    </div>
  )
}
