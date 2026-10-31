import { useMemo } from 'react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBranchesQuery } from '@/features/branches/api'

type Props = {
  value: string | null
  onChange: (storeId: string) => void
  /** Restrict to stores of these branches (null = all accessible). */
  branchIds?: string[] | null
  exclude?: string | null
  placeholder?: string
  'aria-label'?: string
  invalid?: boolean
}

/**
 * Active stores of the branches the user can access, grouped by branch.
 */
export function StoreSelect({ value, onChange, branchIds = null, exclude = null, placeholder = 'Choose a store', invalid, ...props }: Props) {
  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  const groups = useMemo(
    () =>
      (branches.data?.items ?? [])
        .filter((b) => !branchIds || branchIds.includes(b.id))
        .map((b) => ({ branch: b, stores: b.stores.filter((s) => s.is_active && s.id !== exclude) }))
        .filter((g) => g.stores.length > 0),
    [branches.data, branchIds, exclude],
  )

  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={props['aria-label'] ?? 'Store'} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={branches.isPending ? 'Loading stores…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups.map(({ branch, stores }) => (
          <SelectGroup key={branch.id}>
            <SelectLabel>{branch.name}</SelectLabel>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} <span className="text-muted-foreground">({s.code})</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
