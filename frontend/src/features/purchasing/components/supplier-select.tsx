import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSuppliersQuery } from '@/features/suppliers/api'

/** Active suppliers (first 100 by name). */
export function SupplierSelect({ value, onChange, invalid, disabled }: { value: string | null; onChange: (id: string) => void; invalid?: boolean; disabled?: boolean }) {
  const suppliers = useSuppliersQuery({ page: 1 })
  const active = (suppliers.data?.items ?? []).filter((s) => s.is_active)

  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label="Supplier" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={suppliers.isPending ? 'Loading suppliers…' : 'Choose a supplier'} />
      </SelectTrigger>
      <SelectContent>
        {active.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-muted-foreground">({s.code})</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
