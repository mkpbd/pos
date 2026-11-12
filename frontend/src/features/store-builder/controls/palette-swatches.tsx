import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inkOn, type PaletteColor } from './color-utils'

/** A checkerboard behind see-through colours. */
export const CHECKERBOARD = 'repeating-conic-gradient(#d4d4d8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'

export function Swatch({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span className={cn('relative inline-block size-5 shrink-0 overflow-hidden rounded-full border shadow-xs', className)} style={{ background: CHECKERBOARD }} aria-hidden>
      {color ? <span className="absolute inset-0" style={{ background: color }} /> : <span className="absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,#dc2626_45%,#dc2626_55%,transparent_55%)] bg-white" />}
    </span>
  )
}

export function SwatchButton({ name, color, active, onClick, title, disabled }: {
  /** The accessible name. */
  name: string
  /** CSS colour shown. */
  color: string | undefined
  active: boolean
  onClick: () => void
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title ?? name}
      aria-label={name}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex size-7 items-center justify-center overflow-hidden rounded-full border shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
      style={{ background: CHECKERBOARD }}
    >
      <span className="absolute inset-0" style={{ background: color ?? 'var(--muted)' }} aria-hidden />
      {active && <CheckIcon className="relative size-3.5" style={{ color: inkOn(color) }} aria-hidden />}
    </button>
  )
}

/**
 * A row of named colour swatches (the store palette, a predefined palette, curated colours). The
 * active one (matching `value`, case-insensitive) is pressed; clicking one reports its hex.
 */
export function PaletteSwatches({ label, colors, value, onSelect, hideLabel = false, disabled = false }: {
  label: string
  colors: readonly PaletteColor[]
  value?: string | null
  onSelect: (hex: string) => void
  hideLabel?: boolean
  disabled?: boolean
}) {
  if (colors.length === 0) return null
  const current = value?.toLowerCase()
  return (
    <div className="flex flex-col gap-1.5">
      {!hideLabel && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {colors.map((c, i) => (
          <SwatchButton
            key={`${c.hex}-${i}`}
            name={`${label}: ${c.name}`}
            title={`${c.name} (${c.hex})`}
            color={c.hex}
            active={current === c.hex.toLowerCase()}
            disabled={disabled}
            onClick={() => onSelect(c.hex.toLowerCase())}
          />
        ))}
      </div>
    </div>
  )
}
