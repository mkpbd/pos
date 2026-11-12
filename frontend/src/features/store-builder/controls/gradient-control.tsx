import { useId, type ReactNode } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Gradient, GradientStop } from '@/storefront/builder/types'
import { normalizeGradient } from '@/storefront/builder/validate'
import { ColorControl } from './color-control'
import type { PaletteColor } from './color-utils'
import { ControlLabel } from './control-label'
import { CHECKERBOARD } from './palette-swatches'
import { addStop, DEFAULT_GRADIENT, gradientPreviewCss, MAX_STOPS, MIN_STOPS, removeStop } from './model'
import { Segmented } from './primitives'

const DIRECTIONS = [
  { angle: 180, label: 'Top to bottom', arrow: '↓' },
  { angle: 90, label: 'Left to right', arrow: '→' },
  { angle: 135, label: 'Diagonal down', arrow: '↘' },
  { angle: 45, label: 'Diagonal up', arrow: '↗' },
] as const

export type GradientControlProps = {
  label: string
  value: Gradient | undefined
  onChange: (value: Gradient) => void
  themeColors?: Record<string, string>
  palette?: readonly PaletteColor[]
  allowTokens?: boolean
  status?: ReactNode
  tooltip?: string
}

/**
 * A gradient: linear (angle: quick directions, slider and number) or radial (circle / ellipse),
 * with 2–5 colour stops (colour + position) and a live preview strip. Only valid gradients are
 * written (the builder's rules, validate.ts).
 */
export function GradientControl({ label, value, onChange, themeColors, palette, allowTokens = true, status, tooltip }: GradientControlProps) {
  const id = useId()
  const gradient = value ?? DEFAULT_GRADIENT
  const write = (next: Gradient) => {
    const valid = normalizeGradient(next)
    if (valid) onChange(valid)
  }
  const setStop = (index: number, patch: Partial<GradientStop>) => write({ ...gradient, stops: gradient.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  const angle = gradient.angle ?? 180

  return (
    <div className="flex flex-col gap-3" data-control="gradient">
      <ControlLabel label={label} tooltip={tooltip} status={status} />
      <div className="h-8 overflow-hidden rounded-md border" style={{ background: CHECKERBOARD }} aria-hidden>
        <div className="size-full" data-testid="gradient-preview" style={{ background: gradientPreviewCss(gradient, themeColors) }} />
      </div>
      <Segmented
        label={`${label} type`}
        value={gradient.type}
        options={[{ value: 'linear', label: 'Straight' }, { value: 'radial', label: 'Round' }]}
        onChange={(type) => write(type === 'linear' ? { type, angle: gradient.angle ?? 180, stops: gradient.stops } : { type, shape: gradient.shape ?? 'ellipse', stops: gradient.stops })}
      />
      {gradient.type === 'linear' ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1" role="group" aria-label="Direction">
            {DIRECTIONS.map((d) => (
              <button
                key={d.angle}
                type="button"
                aria-label={d.label}
                title={d.label}
                aria-pressed={angle === d.angle}
                onClick={() => write({ ...gradient, angle: d.angle })}
                className="flex size-7 items-center justify-center rounded-md border text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10"
              >
                {d.arrow}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border" aria-hidden>
              <span className="block h-3 w-0.5 rounded bg-foreground" style={{ transform: `rotate(${angle}deg)` }} />
            </span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              aria-label="Angle"
              value={angle}
              onChange={(e) => write({ ...gradient, angle: Number(e.target.value) })}
              className="min-w-0 flex-1 accent-primary"
            />
            <input
              type="number"
              min={0}
              max={360}
              aria-label="Angle in degrees"
              value={angle}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n <= 360) write({ ...gradient, angle: Math.round(n) })
              }}
              className="h-8 w-16 rounded-md border bg-transparent px-2 text-sm tabular-nums"
            />
          </div>
        </div>
      ) : (
        <Segmented label="Shape" value={gradient.shape ?? 'ellipse'} options={[{ value: 'ellipse', label: 'Oval' }, { value: 'circle', label: 'Circle' }]} onChange={(shape) => write({ ...gradient, shape })} />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Colours ({gradient.stops.length} of {MAX_STOPS})</legend>
        {gradient.stops.map((stop, index) => (
          <div key={index} className="grid grid-cols-[1fr_auto_auto] items-end gap-1.5" data-testid={`gradient-stop-${index}`}>
            <ColorControl
              label={`Colour ${index + 1}`}
              value={stop.color}
              onChange={(color) => color && setStop(index, { color })}
              themeColors={themeColors}
              palette={palette}
              allowTokens={allowTokens}
              allowAlpha
            />
            <label className="flex flex-col gap-1 text-xs">
              <span className="sr-only">Colour {index + 1} position</span>
              <span className="flex items-center rounded-md border shadow-xs">
                <input
                  id={`${id}-pos-${index}`}
                  type="number"
                  min={0}
                  max={100}
                  aria-label={`Colour ${index + 1} position`}
                  value={stop.position}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n <= 100) setStop(index, { position: Math.round(n * 100) / 100 })
                  }}
                  className="h-8 w-12 bg-transparent px-1.5 text-sm tabular-nums outline-none"
                />
                <span className="pr-1.5 text-muted-foreground">%</span>
              </span>
            </label>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove colour ${index + 1}`} disabled={gradient.stops.length <= MIN_STOPS} onClick={() => write(removeStop(gradient, index))}>
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={gradient.stops.length >= MAX_STOPS} onClick={() => write(addStop(gradient))}>
          <PlusIcon data-icon="inline-start" /> Add colour
        </Button>
      </fieldset>
    </div>
  )
}
