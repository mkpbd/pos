import { useState, type ReactNode } from 'react'
import { Link2Icon, Unlink2Icon } from 'lucide-react'
import { ColorControl } from './color-control'
import type { PaletteColor } from './color-utils'
import { ControlLabel } from './control-label'
import { LengthControl } from './length-control'
import { CORNERS, cornersLinked, setCorner, type Border } from './model'
import { Segmented } from './primitives'

export type BorderKey = 'width' | 'style' | 'color' | 'radius'

/**
 * Border: width (px, ≤ 20), line style, colour and corner rounding (all corners together, or
 * each one). `parts` limits what is shown (e.g. only the radius for images).
 */
export function BorderControl({ value, onChange, statusFor, parts = ['width', 'style', 'color', 'radius'], themeColors, palette }: {
  value: Border
  onChange: <K extends BorderKey>(key: K, value: Border[K] | undefined) => void
  statusFor?: (key: BorderKey) => ReactNode
  parts?: readonly BorderKey[]
  themeColors?: Record<string, string>
  palette?: readonly PaletteColor[]
}) {
  const [linked, setLinked] = useState(() => cornersLinked(value.radius))
  const show = (key: BorderKey) => parts.includes(key)
  return (
    <div className="flex flex-col gap-3" data-control="border">
      {show('style') && (
        <Segmented
          label="Line"
          value={value.style}
          options={[
            { value: 'none', label: 'None' },
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' },
          ]}
          onChange={(style) => onChange('style', style)}
          status={statusFor?.('style')}
        />
      )}
      {show('width') && (
        <LengthControl label="Line width" value={value.width} units={['px']} max={20} slider={{ min: 0, max: 20 }} placeholder="0" onChange={(width) => onChange('width', width)} status={statusFor?.('width')} />
      )}
      {show('color') && (
        <ColorControl label="Line colour" value={value.color ?? null} onChange={(color) => onChange('color', color ?? undefined)} themeColors={themeColors} palette={palette} allowTokens allowAlpha placeholder="Default" status={statusFor?.('color')} />
      )}
      {show('radius') && (
        <div role="group" aria-label="Rounded corners" className="flex flex-col gap-2">
          <ControlLabel
            label="Rounded corners"
            tooltip="0 = square corners. Use a large value (like 999 px) for a pill shape."
            status={
              <>
                {statusFor?.('radius')}
                <button
                  type="button"
                  aria-pressed={linked}
                  aria-label="Same rounding on all corners"
                  title={linked ? 'All corners the same — click to set each corner' : 'Each corner separately — click to link them'}
                  onClick={() => setLinked(!linked)}
                  className="flex size-6 items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-primary [&_svg]:size-3.5"
                >
                  {linked ? <Link2Icon aria-hidden /> : <Unlink2Icon aria-hidden />}
                </button>
              </>
            }
          />
          {linked ? (
            <LengthControl
              compact
              label="Rounding on all corners"
              value={cornersLinked(value.radius) ? value.radius?.tl : undefined}
              placeholder={cornersLinked(value.radius) ? '0' : 'Mixed'}
              units={['px', '%', 'rem']}
              slider={{ min: 0, max: 48 }}
              onChange={(v) => onChange('radius', setCorner(value.radius, 'all', v))}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {CORNERS.map((corner) => (
                <div key={corner.key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span aria-hidden>{corner.label}</span>
                  <LengthControl compact label={`${corner.label} rounding`} value={value.radius?.[corner.key]} placeholder="0" units={['px', '%', 'rem']} onChange={(v) => onChange('radius', setCorner(value.radius, corner.key, v))} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
