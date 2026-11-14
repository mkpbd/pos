import { useId } from 'react'
import { ControlLabel } from '@/features/store-builder/controls'

/** A labelled slider with its value; native range input, so keyboard and screen readers work. */
export function RangeField({ label, tooltip, value, min, max, step, format, onChange, disabled, error, hint }: {
  label: string
  tooltip?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
  error?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel label={label} htmlFor={id} tooltip={tooltip} status={<span className="text-sm text-muted-foreground tabular-nums">{format(value)}</span>} />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
