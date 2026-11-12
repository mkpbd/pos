import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ControlLabel } from './control-label'

/*
 * Small building blocks of the design controls: a segmented choice (radio buttons), a native
 * select and a slider with its number. Native elements keep the narrow inspector simple and
 * accessible.
 */

export type Option<T extends string> = { value: T; label: string; icon?: ReactNode; title?: string }

/** One of a few options as pressed buttons (`role="radiogroup"`); `value` undefined = none chosen. */
export function Segmented<T extends string>({ label, value, options, onChange, status, tooltip, disabled, hideLabel = false, className }: {
  label: string
  value: T | undefined
  options: readonly Option<T>[]
  onChange: (value: T) => void
  status?: ReactNode
  tooltip?: string
  disabled?: boolean
  hideLabel?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {!hideLabel && <ControlLabel label={label} id={`${id}-label`} tooltip={tooltip} status={status} />}
      <div role="radiogroup" aria-label={hideLabel ? label : undefined} aria-labelledby={hideLabel ? undefined : `${id}-label`} className="flex rounded-md border p-0.5">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.icon || option.title ? (option.title ?? option.label) : undefined}
              title={option.title ?? option.label}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-3.5',
                active ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {option.icon ?? <span className="truncate">{option.label}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A labelled native select. `value` undefined shows the placeholder option. */
export function SelectControl<T extends string>({ label, value, options, onChange, status, tooltip, placeholder, disabled }: {
  label: string
  value: T | undefined
  options: readonly Option<T>[]
  onChange: (value: T) => void
  status?: ReactNode
  tooltip?: string
  placeholder?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel label={label} htmlFor={id} tooltip={tooltip} status={status} />
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => e.target.value !== '' && onChange(e.target.value as T)}
        className="h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
      >
        {value === undefined && <option value="">{placeholder ?? 'Default'}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

/** A slider with the number beside it (both edit the same value). */
export function SliderControl({ label, value, min, max, step = 1, onChange, format, status, tooltip, disabled, placeholder }: {
  label: string
  value: number | undefined
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  status?: ReactNode
  tooltip?: string
  disabled?: boolean
  /** The value shown on the slider when none is set. */
  placeholder?: number
}) {
  const id = useId()
  const shown = value ?? placeholder ?? min
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel label={label} htmlFor={id} tooltip={tooltip} status={status} />
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          aria-valuetext={format ? format(shown) : undefined}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1 accent-primary disabled:opacity-50"
        />
        <span className={cn('w-14 text-right text-xs tabular-nums', value === undefined && 'text-muted-foreground')}>{format ? format(shown) : shown}</span>
      </div>
    </div>
  )
}
