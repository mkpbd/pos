/*
 * B20 Style → Background → "Moving background" (sections and inner rows; `style.base.background_fx`,
 * the same on every device): type tiles with a small live preview that plays while a tile is
 * pointed at or focused (still under "reduce motion"), how many, how fast and which theme colours.
 * The storefront draws it behind the content, moving only while on screen; shoppers can pause it.
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { BackgroundFx, BackgroundFxColorRole, BackgroundFxType } from '@/storefront/builder/types'
import { B20_DEFAULTS, B20_ENUMS, B20_LIMITS } from '@/storefront/builder/validate'
import { ControlLabel } from '../controls'
import { prefersReducedMotion } from './b18-motion'
import { TileGroup } from './b18-motion-tiles'
import {
  BACKGROUND_FX_COLOR_LABELS,
  BACKGROUND_FX_DENSITIES,
  BACKGROUND_FX_LABELS,
  BACKGROUND_FX_SPEEDS,
  backgroundFxTypes,
  defaultFxColors,
  fxColors,
  roleColor,
  toBackgroundFx,
  toggleFxColor,
} from './b20-model'
import { canAnimate } from './preview-loop'

type FxType = Exclude<BackgroundFxType, 'none'>

/** Where the preview's five pieces sit (left %, top %). */
const SPOTS: readonly [number, number][] = [
  [12, 30],
  [32, 65],
  [52, 22],
  [70, 58],
  [86, 32],
]

/** One run of each piece's movement (Web Animations; transform / opacity only). */
function pieceKeyframes(type: FxType, i: number): { keyframes: Keyframe[]; duration: number } {
  const dir = i % 2 === 0 ? 1 : -1
  switch (type) {
    case 'floating_shapes':
      return { keyframes: [{ transform: 'translateY(0)' }, { transform: `translateY(${-5 * dir}px) rotate(${20 * dir}deg)` }, { transform: 'translateY(0)' }], duration: 2400 }
    case 'bubbles':
      return { keyframes: [{ transform: 'translateY(10px)', opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { transform: 'translateY(-14px)', opacity: 0 }], duration: 1800 + i * 200 }
    case 'sparkles':
    case 'stars':
      return { keyframes: [{ transform: 'scale(0.4)', opacity: 0.2 }, { transform: 'scale(1.1)', opacity: 1 }, { transform: 'scale(0.4)', opacity: 0.2 }], duration: 1200 + i * 180 }
    case 'snow':
    case 'petals':
    case 'confetti_fall':
      return { keyframes: [{ transform: 'translate(0, -16px) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translate(${4 * dir}px, 16px) rotate(${type === 'snow' ? 0 : 180 * dir}deg)`, opacity: 0 }], duration: 1600 + i * 220 }
    case 'lanterns':
      return { keyframes: [{ transform: 'rotate(-10deg)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(-10deg)' }], duration: 2000 }
    case 'gradient_flow':
      return { keyframes: [], duration: 0 }
  }
}

function pieceStyle(type: FxType, color: string): CSSProperties {
  switch (type) {
    case 'bubbles':
      return { width: 7, height: 7, borderRadius: '9999px', border: `1.5px solid ${color}` }
    case 'snow':
      return { width: 4, height: 4, borderRadius: '9999px', background: color, boxShadow: '0 0 0 1px rgb(0 0 0 / 0.08)' }
    case 'petals':
      return { width: 6, height: 4, borderRadius: '70% 0 70% 0', background: color }
    case 'confetti_fall':
      return { width: 3, height: 6, borderRadius: 1, background: color }
    case 'lanterns':
      return { width: 5, height: 8, borderRadius: '2px 2px 4px 4px', background: color, transformOrigin: '50% -6px' }
    case 'sparkles':
    case 'stars':
      return { width: 6, height: 6, background: color, clipPath: 'polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)' }
    default:
      return { width: 7, height: 7, borderRadius: 2, background: color, opacity: 0.8 }
  }
}

/** A tile's stage: the pieces (or the gradient) in the theme colours; moves while `active`. */
export function FxPreview({ type, colors, active, className }: { type: FxType | 'none'; colors: string[]; active: boolean; className?: string }) {
  const stage = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const root = stage.current
    if (!active || !root || type === 'none' || prefersReducedMotion()) return
    const runs: Animation[] = []
    const pieces = Array.from(root.querySelectorAll<HTMLElement>('[data-fx-piece]'))
    for (const [i, el] of pieces.entries()) {
      if (!canAnimate(el)) continue
      try {
        if (type === 'gradient_flow') runs.push(el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }], { duration: 2600, iterations: Infinity, easing: 'linear' }))
        else {
          const { keyframes, duration } = pieceKeyframes(type, i)
          runs.push(el.animate(keyframes, { duration, iterations: Infinity, easing: 'ease-in-out', delay: i * 120 }))
        }
      } catch {
        /* still picture */
      }
    }
    return () => {
      for (const run of runs) run.cancel()
    }
  }, [active, type])

  const palette = colors.length > 0 ? colors : ['currentColor']
  return (
    <span ref={stage} aria-hidden className={cn('pointer-events-none relative block h-9 w-full overflow-hidden rounded-sm bg-muted/60', className)} data-tile-art>
      {type === 'none' ? (
        <span className="absolute inset-2 rounded-[3px] border border-dashed border-muted-foreground/60" />
      ) : type === 'gradient_flow' ? (
        <span data-fx-piece className="absolute inset-y-0 left-0 w-[200%]" style={{ background: `linear-gradient(90deg, ${[...palette, ...palette, palette[0]].join(', ')})`, opacity: 0.75 }} />
      ) : (
        SPOTS.map(([left, top], i) => (
          <span key={i} className="absolute" style={{ left: `${left}%`, top: `${top}%` }}>
            <span data-fx-piece className="block" style={pieceStyle(type, palette[i % palette.length]!)} />
          </span>
        ))
      )}
    </span>
  )
}

export type MovingBackgroundProps = {
  value: BackgroundFx | undefined
  onChange: (value: BackgroundFx | undefined) => void
  themeColors?: Record<string, string>
  /** GET /elements `enums` (types, default colours). */
  enums?: Record<string, unknown>
}

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly { value: V; label: string }[]; onChange: (value: V) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ControlLabel label={label} />
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button key={o.value} type="button" size="sm" variant={value === o.value ? 'default' : 'outline'} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function MovingBackgroundControl({ value, onChange, themeColors, enums }: MovingBackgroundProps) {
  const types = backgroundFxTypes(enums)
  const colorOf = (role: BackgroundFxColorRole) => roleColor(role, themeColors)
  const current: FxType | 'none' = value?.type ?? 'none'
  const options = [{ value: 'none' as const, label: 'None', title: 'No moving background' }, ...types.map((t) => ({ value: t, label: BACKGROUND_FX_LABELS[t].label, title: `${BACKGROUND_FX_LABELS[t].label} (${BACKGROUND_FX_LABELS[t].label_bn})` }))]
  const chosen = value ? fxColors(value, enums) : []
  const { min, max } = B20_LIMITS.backgroundFxColors

  return (
    <div className="flex flex-col gap-3 border-t pt-3" data-testid="moving-background">
      <TileGroup<FxType | 'none'>
        label="Moving background"
        tooltip="Shapes or colours that move gently behind this part of the page. The same on every device."
        value={current}
        options={options}
        columns={3}
        testId="background-fx-tiles"
        onChange={(type) => onChange(type === 'none' ? undefined : value ? toBackgroundFx(value, { type }) : { type })}
        renderTile={(option, { active }) => (
          <FxPreview type={option.value} active={active} colors={option.value === 'none' ? [] : (option.value === current && value ? chosen : defaultFxColors(option.value, enums)).map(colorOf)} />
        )}
      />
      {value && (
        <>
          <Segmented label="How many" value={value.density ?? B20_DEFAULTS.backgroundFxDensity} options={BACKGROUND_FX_DENSITIES} onChange={(density) => onChange(toBackgroundFx(value, { density }))} />
          <Segmented label="Speed" value={value.speed ?? B20_DEFAULTS.backgroundFxSpeed} options={BACKGROUND_FX_SPEEDS} onChange={(speed) => onChange(toBackgroundFx(value, { speed }))} />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Colours</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(B20_ENUMS.backgroundFxColor as readonly BackgroundFxColorRole[]).map((role) => {
                const on = chosen.includes(role)
                const locked = (on && chosen.length <= min) || (!on && chosen.length >= max)
                const id = `fx-color-${role}`
                return (
                  <div key={role} className="flex items-center gap-2">
                    <Checkbox id={id} checked={on} disabled={locked} onCheckedChange={(checked) => onChange(toggleFxColor(value, role, checked === true, enums))} />
                    <span aria-hidden className="size-4 shrink-0 rounded-full border" style={{ background: colorOf(role) }} />
                    <Label htmlFor={id} className="text-sm font-normal">
                      {BACKGROUND_FX_COLOR_LABELS[role]}
                    </Label>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {min}–{max} theme colours. They follow your theme.
            </p>
          </fieldset>
          <p className="text-sm text-muted-foreground" data-testid="moving-background-note">
            It moves only while it is on screen. Shoppers can stop it with the pause button, and it stays still for people who ask their device for less motion. Your text stays readable on top.
          </p>
        </>
      )}
    </div>
  )
}
