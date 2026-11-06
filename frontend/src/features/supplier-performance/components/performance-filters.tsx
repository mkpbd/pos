import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/use-auth'
import { performanceRangeError } from '@/features/supplier-performance/performance'

export type FilterValues = { date_from: string; date_to: string; branch_id: string }

const ALL = '__all__'

/**
 * Period (organization dates) and branch filters. Dates apply once both are valid and in
 * order; until then the last valid period stays on screen and the problem is announced.
 */
export function PerformanceFilters({ value, onChange }: { value: FilterValues; onChange: (value: FilterValues) => void }) {
  const me = useAuth()
  const [from, setFrom] = useState(value.date_from)
  const [to, setTo] = useState(value.date_to)
  const error = performanceRangeError(from, to)

  const changeDates = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom)
    setTo(nextTo)
    if (!performanceRangeError(nextFrom, nextTo)) onChange({ ...value, date_from: nextFrom, date_to: nextTo })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="performance-from">From</Label>
          <Input id="performance-from" type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => changeDates(e.target.value, to)} aria-invalid={!!error || undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="performance-to">To</Label>
          <Input id="performance-to" type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => changeDates(from, e.target.value)} aria-invalid={!!error || undefined} />
        </div>
        {me.branches.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="performance-branch">Branch</Label>
            <Select value={value.branch_id || ALL} onValueChange={(v) => onChange({ ...value, branch_id: v === ALL ? '' : v })}>
              <SelectTrigger id="performance-branch" className="w-48" aria-label="Branch"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {me.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
