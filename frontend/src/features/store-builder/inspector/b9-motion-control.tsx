/*
 * B9 Animation group (contract §5): the entrance (12 kinds, duration, delay, first time only or
 * every time), for sections and inner rows the elements inside one after another, for elements an
 * attention loop, the hover effect and, for sections, the background picture parallax. Every value
 * is the desktop (`base`) value and applies on every device.
 */

import { useId } from 'react'
import { PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { BackgroundParallax, HoverStyle, Motion } from '@/storefront/builder/types'
import { B6_ENUMS, B6_LIMITS, B9_DEFAULTS, B9_ENUMS, B9_LIMITS } from '@/storefront/builder/validate'
import { Segmented, SelectControl, SliderControl } from '../controls'
import { canHover, canLoop, canStagger, ENTRANCE_LABELS, HOVER_LABELS, LOOP_LABELS, motionPlays, motionState, PARALLAX_LABELS, REPEAT_LABELS, toHover, toMotion, type MotionState } from './b9-motion'

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
/** 150 → "0.15 s", 0 → "Off". */
const fineSeconds = (ms: number) => (ms === 0 ? 'Off' : `${Number((ms / 1000).toFixed(2))} s`)

function ToggleRow({ label, checked, hint, onChange }: { label: string; checked: boolean; hint: string; onChange: (value: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} />
        <label htmlFor={id} className="text-sm">{label}</label>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export type ParallaxSetting = { value: BackgroundParallax | undefined; available: boolean; onChange: (value: BackgroundParallax | undefined) => void }

/**
 * `value` undefined = nothing moves; a change that leaves nothing moving removes the group.
 * `onPreview` replays the entrance, the sequence and the loop on the canvas.
 */
export function MotionControl({ nodeType = 'heading', value, onChange, onPreview, hover, onHover, parallax }: {
  nodeType?: string
  value: Motion | undefined
  onChange: (value: Motion | undefined) => void
  onPreview?: () => void
  hover?: HoverStyle
  onHover?: (value: HoverStyle | undefined) => void
  parallax?: ParallaxSetting
}) {
  const current = motionState(value)
  const on = current.entrance !== 'none'
  const update = (patch: Partial<MotionState>) => onChange(toMotion({ ...current, ...patch }))
  const hoverEffect = hover?.effect ?? 'none'
  const hoverDuration = hover?.duration ?? B9_DEFAULTS.hoverDuration
  return (
    <div className="flex flex-col gap-4" data-testid="motion-control">
      <SelectControl
        label="Entrance"
        tooltip="Plays when the shopper scrolls to it. Shoppers who turned off animations in their device settings see it without movement."
        value={current.entrance}
        options={B6_ENUMS.motionEntrance.map((e) => ({ value: e, label: ENTRANCE_LABELS[e] }))}
        onChange={(entrance) => update({ entrance })}
      />
      {on && (
        <>
          <SliderControl
            label="Duration"
            value={current.duration}
            min={B6_LIMITS.motionDuration.min}
            max={B6_LIMITS.motionDuration.max}
            step={100}
            format={seconds}
            onChange={(duration) => update({ duration })}
          />
          <SliderControl
            label="Delay"
            tooltip="Wait before it starts, e.g. to let elements appear one after another."
            value={current.delay}
            min={B6_LIMITS.motionDelay.min}
            max={B6_LIMITS.motionDelay.max}
            step={100}
            format={seconds}
            onChange={(delay) => update({ delay })}
          />
        </>
      )}
      {canStagger(nodeType) && (
        <SliderControl
          label="Elements inside, one after another"
          tooltip="Elements inside that have an entrance animation appear one after another, this far apart. Off: they all start together."
          value={current.stagger_children}
          min={B9_LIMITS.staggerChildren.min}
          max={B9_LIMITS.staggerChildren.max}
          step={50}
          format={fineSeconds}
          onChange={(stagger_children) => update({ stagger_children })}
        />
      )}
      {(on || current.stagger_children > 0) && (
        <Segmented
          label="Play it"
          tooltip="Every time: it plays again each time the shopper scrolls back to it."
          value={current.repeat}
          options={B9_ENUMS.motionRepeat.map((r) => ({ value: r, label: REPEAT_LABELS[r] }))}
          onChange={(repeat) => update({ repeat })}
        />
      )}
      {canLoop(nodeType) && (
        <>
          <SelectControl
            label="Attention loop"
            tooltip="A small repeating movement that draws the eye, e.g. on an “Order now” button or a sale badge. It pauses while the shopper points at it."
            value={current.loop}
            options={B9_ENUMS.motionLoop.map((l) => ({ value: l, label: LOOP_LABELS[l] }))}
            onChange={(loop) => update({ loop })}
          />
          {current.loop !== 'none' && (
            <ToggleRow
              label="Keep repeating"
              checked={current.loop_forever}
              hint={`Off: it plays ${B9_LIMITS.loopCycles} times and stops, which is calmer for shoppers.`}
              onChange={(loop_forever) => update({ loop_forever })}
            />
          )}
        </>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!motionPlays(value) || !onPreview} onClick={onPreview}>
          <PlayIcon data-icon="inline-start" /> Preview animation
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The same on every device. Animations don’t play while you edit; use Preview to see one. Shoppers who turned off animations on their device see everything without movement.
      </p>

      {onHover && canHover(nodeType) && (
        <div className="flex flex-col gap-4 border-t pt-4" data-testid="hover-effect-control">
          <SelectControl
            label="Hover effect"
            tooltip="What it does when a shopper points at it with a mouse. Keyboard users see the same when they move to it."
            value={hoverEffect}
            options={B9_ENUMS.hoverEffect.map((h) => ({ value: h, label: HOVER_LABELS[h] }))}
            onChange={(effect) => onHover(toHover(effect, hoverDuration))}
          />
          {hoverEffect !== 'none' && (
            <>
              <SliderControl
                label="Hover speed"
                value={hoverDuration}
                min={B9_LIMITS.hoverDuration.min}
                max={B9_LIMITS.hoverDuration.max}
                step={50}
                format={fineSeconds}
                onChange={(duration) => onHover(toHover(hoverEffect, duration))}
              />
              <p className="text-xs text-muted-foreground">Point at it on the page to try it. Phones and tablets don’t show hover effects.</p>
            </>
          )}
        </div>
      )}

      {parallax && (
        <div className="flex flex-col gap-1.5 border-t pt-4" data-testid="parallax-control">
          <Segmented
            label="Background picture scrolling"
            tooltip="The background picture moves slower than the page as shoppers scroll, for a feeling of depth. Off on phones and tablets and for shoppers who turned off animations."
            value={parallax.available ? (parallax.value ?? 'none') : 'none'}
            disabled={!parallax.available}
            options={B9_ENUMS.parallax.map((p) => ({ value: p, label: PARALLAX_LABELS[p] }))}
            onChange={(p) => parallax.onChange(p === 'none' ? undefined : p)}
          />
          {!parallax.available && <p className="text-xs text-muted-foreground">Choose a background picture for Desktop first (in Background).</p>}
        </div>
      )}
    </div>
  )
}
