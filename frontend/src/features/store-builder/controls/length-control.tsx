import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ControlLabel } from './control-label'
import { buildLength, splitLength, UNIT_MAX, type LengthRules, type LengthUnit } from './model'

export type LengthControlProps = LengthRules & {
  label: string
  /** A stored length (`16px`, `auto`) or undefined (not set). */
  value: string | undefined
  onChange: (value: string | undefined) => void
  /** Shown in the empty number field, e.g. "Auto" or the inherited value. */
  placeholder?: string
  /** A slider for the common range of the first unit. */
  slider?: { min: number; max: number; step?: number }
  status?: ReactNode
  tooltip?: string
  disabled?: boolean
  /** Without the label row (the label becomes the field's accessible name). */
  compact?: boolean
  className?: string
}

/**
 * A length: a number and a unit (only the units the field allows, `auto` where allowed), with an
 * optional slider. Invalid numbers are flagged and never written; clearing the number unsets it.
 */
export function LengthControl({ label, value, onChange, units = ['px', 'rem', '%'], allowAuto, allowNegative, max, placeholder, slider, status, tooltip, disabled, compact = false, className }: LengthControlProps) {
  const id = useId()
  const rules: LengthRules = { units, allowAuto, allowNegative, max }
  const parsed = splitLength(value)
  const [amount, setAmount] = useState(parsed?.amount ?? '')
  const [unit, setUnit] = useState<LengthUnit | 'auto'>(parsed?.unit ?? units[0] ?? 'px')
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    const next = splitLength(value)
    setAmount(next?.amount ?? '')
    if (next) setUnit(next.unit)
    setError(null)
  }

  const commit = (nextAmount: string, nextUnit: LengthUnit | 'auto') => {
    // Half-typed numbers wait for the next key.
    if (/^-?\.?$/.test(nextAmount.trim()) && nextAmount.trim() !== '') return setError(null)
    const result = buildLength(nextAmount, nextUnit, rules)
    if ('error' in result) return setError(result.error)
    setError(null)
    if (result.value !== value) onChange(result.value)
  }

  const sliderValue = unit !== 'auto' && amount !== '' && Number.isFinite(Number(amount)) ? Number(amount) : undefined
  const showSlider = slider && unit === (units[0] ?? 'px')

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-control="length">
      {!compact && <ControlLabel label={label} htmlFor={`${id}-amount`} tooltip={tooltip} status={status} />}
      <div className="flex items-stretch">
        <input
          id={`${id}-amount`}
          type="text"
          inputMode="decimal"
          aria-label={compact ? label : undefined}
          placeholder={unit === 'auto' ? 'Auto' : (placeholder ?? '—')}
          value={unit === 'auto' ? '' : amount}
          disabled={disabled || unit === 'auto'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setAmount(e.target.value)
            commit(e.target.value, unit)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            e.preventDefault()
            const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
            const next = String(Math.round(((Number(amount) || 0) + step) * 100) / 100)
            setAmount(next)
            commit(next, unit)
          }}
          className="h-8 w-full min-w-0 rounded-l-md border bg-transparent px-2 text-sm tabular-nums shadow-xs outline-none focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-invalid:border-destructive dark:bg-input/30"
        />
        <select
          aria-label={`${label} unit`}
          value={unit}
          disabled={disabled}
          onChange={(e) => {
            const nextUnit = e.target.value as LengthUnit | 'auto'
            setUnit(nextUnit)
            if (nextUnit === 'auto') return commit('', 'auto')
            // Keep the number when it fits the new unit, else its largest value.
            const limit = Math.min(UNIT_MAX[nextUnit], max ?? Infinity)
            const n = Number(amount)
            const nextAmount = amount !== '' && Number.isFinite(n) && Math.abs(n) > limit ? String(Math.sign(n) * limit) : amount
            setAmount(nextAmount)
            commit(nextAmount, nextUnit)
          }}
          className="h-8 shrink-0 rounded-r-md border border-l-0 bg-muted/40 px-1 text-xs shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
          {allowAuto && <option value="auto">auto</option>}
        </select>
      </div>
      {showSlider && (
        <input
          type="range"
          aria-label={`${label} slider`}
          min={slider.min}
          max={slider.max}
          step={slider.step ?? 1}
          value={sliderValue ?? slider.min}
          disabled={disabled}
          onChange={(e) => {
            setAmount(e.target.value)
            commit(e.target.value, unit)
          }}
          className={cn('w-full accent-primary', sliderValue === undefined && 'opacity-60')}
        />
      )}
      {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
