import { useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useReceiptsQuery } from '@/features/purchasing/api'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/** A posted receipt chosen for a landed cost voucher (what the picker needs to show it). */
export type PickedReceipt = {
  id: string
  number: string
  supplier_name: string | null
  store_name: string | null
  branch_id: string | null
  branch_name: string | null
  invoice_date: string | null
  total: string | null
  currency: string | null
}

/**
 * Searchable list of posted goods receipts (every receipt is posted). A voucher applies to
 * receipts of one branch: once one is chosen, receipts of other branches cannot be added.
 */
export function ReceiptPicker({ selected, onChange, invalid }: { selected: PickedReceipt[]; onChange: (receipts: PickedReceipt[]) => void; invalid?: boolean }) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const receipts = useReceiptsQuery({ page: 1, per_page: 10, search: term || undefined, sort: '-invoice_date' })
  const chosen = new Set(selected.map((r) => r.id))
  const branch = selected[0]?.branch_id ?? null
  const branchName = selected[0]?.branch_name ?? null
  const rows: PickedReceipt[] = (receipts.data?.items ?? []).map((r) => ({
    id: r.id,
    number: r.number,
    supplier_name: r.supplier?.name ?? null,
    store_name: r.store?.name ?? null,
    branch_id: r.store?.branch_id ?? null,
    branch_name: r.store?.branch_name ?? null,
    invoice_date: r.invoice_date,
    total: r.total,
    currency: r.currency,
  }))

  const toggle = (r: PickedReceipt, on: boolean) => onChange(on ? [...selected.filter((x) => x.id !== r.id), r] : selected.filter((x) => x.id !== r.id))

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen receipts">
          {selected.map((r) => (
            <li key={r.id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-sm">
              <span className="font-mono">{r.number}</span>
              {r.supplier_name && <span className="text-muted-foreground">· {r.supplier_name}</span>}
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${r.number}`} onClick={() => toggle(r, false)}><XIcon /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative sm:max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search receipts" placeholder="Receipt or supplier invoice number" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} aria-invalid={invalid || undefined} />
      </div>
      <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border" aria-label="Posted receipts">
        {receipts.isPending && <li className="p-3 text-sm text-muted-foreground">Loading receipts…</li>}
        {receipts.error && <li role="alert" className="p-3 text-sm text-destructive">{receipts.error.message}</li>}
        {!receipts.isPending && !receipts.error && rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No receipts match.</li>}
        {rows.map((r) => {
          const otherBranch = branch !== null && r.branch_id !== null && r.branch_id !== branch && !chosen.has(r.id)
          return (
            <li key={r.id}>
              <label className={`flex items-center gap-3 px-3 py-2 text-sm ${otherBranch ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}>
                <Checkbox checked={chosen.has(r.id)} disabled={otherBranch} onCheckedChange={(v) => toggle(r, v === true)} aria-label={`Apply to ${r.number}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span><span className="font-mono font-medium">{r.number}</span> <span className="text-muted-foreground">· {r.supplier_name ?? '—'}</span></span>
                  <span className="text-xs text-muted-foreground">
                    {r.invoice_date} · {r.store_name ?? '—'}
                    {otherBranch && ` · other branch (${r.branch_name ?? '—'})`}
                  </span>
                </span>
                <span className="font-mono text-xs">{formatMoney(r.total, r.currency ?? undefined)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selected.length === 0 ? 'Choose the receipts the charges belong to.' : `${selected.length} ${selected.length === 1 ? 'receipt' : 'receipts'} chosen${branchName ? ` — ${branchName} only` : ''}.`}
      </p>
    </div>
  )
}
