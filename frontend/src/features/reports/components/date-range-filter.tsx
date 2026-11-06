import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DATE_PRESETS, matchPreset, PRESET_LABELS, presetRange, rangeProblem, type DatePreset } from '@/features/reports/params'

const CUSTOM = 'custom'

type Props = {
  idPrefix: string
  from: string
  to: string
  timeZone: string | undefined
  onChange: (range: { from: string; to: string }) => void
  /** Presets offered (default: all). */
  presets?: readonly DatePreset[]
}

/**
 * Period picker: presets (organization calendar) plus custom From / To dates. A custom range
 * applies once both dates are valid and in order; until then the last valid range stays on
 * screen and the problem is announced. Remount (key) it when the applied range changes.
 */
export function DateRangeFilter({ idPrefix, from: appliedFrom, to: appliedTo, timeZone, onChange, presets = DATE_PRESETS }: Props) {
  const [from, setFrom] = useState(appliedFrom)
  const [to, setTo] = useState(appliedTo)
  const problem = rangeProblem(from, to)
  const preset = matchPreset(appliedFrom, appliedTo, timeZone, undefined, presets)

  const change = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom)
    setTo(nextTo)
    if (!rangeProblem(nextFrom, nextTo)) onChange({ from: nextFrom, to: nextTo })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-period`}>Period</Label>
          <Select
            value={preset ?? CUSTOM}
            onValueChange={(v) => {
              if (v === CUSTOM) return
              const range = presetRange(v as DatePreset, timeZone)
              change(range.from, range.to)
            }}
          >
            <SelectTrigger id={`${idPrefix}-period`} className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {presets.map((p) => <SelectItem key={p} value={p}>{PRESET_LABELS[p]}</SelectItem>)}
              <SelectItem value={CUSTOM}>Custom dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-from`}>From</Label>
          <Input id={`${idPrefix}-from`} type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => change(e.target.value, to)} aria-invalid={!!problem || undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-to`}>To</Label>
          <Input id={`${idPrefix}-to`} type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => change(from, e.target.value)} aria-invalid={!!problem || undefined} />
        </div>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    </div>
  )
}
