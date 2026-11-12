import { useState, type ReactNode } from 'react'
import { Link2Icon, Unlink2Icon } from 'lucide-react'
import type { Sides } from '@/storefront/builder/types'
import { HelpTip } from './control-label'
import { LengthControl } from './length-control'
import { setSide, SIDES, sidesLinked, type LengthRules } from './model'

export type SpacingBoxName = 'margin' | 'padding'
export type SpacingValue = { margin?: Sides; padding?: Sides }


const BOXES: Record<SpacingBoxName, { label: string; tooltip: string; rules: LengthRules }> = {
  margin: { label: 'Outer space (margin)', tooltip: 'Space outside the border, pushing neighbours away. Can be negative to pull closer, or auto to centre.', rules: { units: ['px', 'rem', '%', 'em'], allowAuto: true, allowNegative: true } },
  padding: { label: 'Inner space (padding)', tooltip: 'Space inside the border, between the edge and the content.', rules: { units: ['px', 'rem', '%', 'em'] } },
}

/** Margin and padding, each with linked (one value) or separate sides. */
export function SpacingBox({ value, onChange, statusFor, boxes = ['margin', 'padding'], placeholder }: {
  value: SpacingValue
  onChange: (box: SpacingBoxName, sides: Sides | undefined) => void
  statusFor?: (box: SpacingBoxName) => ReactNode
  boxes?: readonly SpacingBoxName[]
  /** Placeholder text of empty fields. */
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-4" data-control="spacing">
      {boxes.map((box) => (
        <SidesEditor key={box} box={box} sides={value[box]} onChange={(sides) => onChange(box, sides)} status={statusFor?.(box)} placeholder={placeholder} />
      ))}
    </div>
  )
}

function SidesEditor({ box, sides, onChange, status, placeholder }: { box: SpacingBoxName; sides: Sides | undefined; onChange: (sides: Sides | undefined) => void; status?: ReactNode; placeholder?: string }) {
  const meta = BOXES[box]
  const [linked, setLinked] = useState(() => sidesLinked(sides))
  return (
    <div role="group" aria-label={meta.label} className="flex flex-col gap-2" data-testid={`spacing-${box}`}>
      <div className="flex min-h-6 items-center gap-1.5">
        <span className="text-sm leading-none font-medium">{meta.label}</span>
        <HelpTip label={meta.label} text={meta.tooltip} />
        <span className="ml-auto flex items-center gap-1">
          {status}
          <button
            type="button"
            aria-pressed={linked}
            aria-label={`Same ${box} on all sides`}
            title={linked ? 'Same on all sides — click to set each side' : 'Each side separately — click to link them'}
            onClick={() => setLinked(!linked)}
            className="flex size-6 items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-primary [&_svg]:size-3.5"
          >
            {linked ? <Link2Icon aria-hidden /> : <Unlink2Icon aria-hidden />}
          </button>
        </span>
      </div>
      {linked ? (
        <LengthControl
          compact
          label={`${box === 'margin' ? 'Margin' : 'Padding'} on all sides`}
          value={sidesLinked(sides) ? sides?.top : undefined}
          placeholder={sidesLinked(sides) ? placeholder : 'Mixed'}
          onChange={(v) => onChange(setSide(sides, 'all', v))}
          {...meta.rules}
          slider={{ min: 0, max: 120, step: 4 }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {SIDES.map((side) => (
            <div key={side} className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span className="capitalize" aria-hidden>{side}</span>
              <LengthControl compact label={`${box === 'margin' ? 'Margin' : 'Padding'} ${side}`} value={sides?.[side]} placeholder={placeholder} onChange={(v) => onChange(setSide(sides, side, v))} {...meta.rules} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
