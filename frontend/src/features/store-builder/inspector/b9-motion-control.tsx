/*
 * The Animation group (B9, rebuilt in B18 "Motion studio", contract §3): the entrance as a grid of
 * tiles with tiny previews, the movement style (easing chips with a drawing of the curve), duration
 * and delay, for sections and inner rows the elements inside one after another, first time only or
 * every time, for elements an attention loop (tiles; "Keep looping" with the note that shoppers get
 * a pause button), ▶ Play, the hover effect (tiles that show the effect when pointed at) and, for
 * sections, the background picture parallax. Every value is the desktop (`base`) value and applies
 * on every device.
 */

import { useId } from 'react'
import { ChartGanttIcon, PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { BackgroundParallax, HoverEffect, HoverStyle, Motion, MotionEntrance, MotionLoop } from '@/storefront/builder/types'
import { B18_ENUMS, B6_ENUMS, B6_LIMITS, B9_DEFAULTS, B9_ENUMS, B9_LIMITS } from '@/storefront/builder/validate'
import { Segmented, SliderControl } from '../controls'
import { HOVER_HINTS } from './b18-motion'
import { EasingChips, EntrancePreview, HoverPreview, LoopPreview, TileGroup } from './b18-motion-tiles'
import { canHover, canLoop, canStagger, ENTRANCE_LABELS, HOVER_LABELS, LOOP_LABELS, motionPlays, motionState, PARALLAX_LABELS, REPEAT_LABELS, toHover, toMotion, type MotionState } from './b9-motion'

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
/** 150 → "0.15 s", 0 → "Off". */
const fineSeconds = (ms: number) => (ms === 0 ? 'Off' : `${Number((ms / 1000).toFixed(2))} s`)

/** Short tile names (the full label is the tooltip). */
const SHORT_LOOP: Record<MotionLoop, string> = {
  none: 'None',
  pulse: 'Pulse',
  float: 'Float',
  shake: 'Shake',
  glow: 'Glow',
  wiggle: 'Wiggle',
  heartbeat: 'Heartbeat',
  breathe: 'Breathe',
  shine: 'Shine',
  'spin-slow': 'Slow spin',
}
const SHORT_ENTRANCE: Partial<Record<MotionEntrance, string>> = { 'slide-left': 'From the right', 'slide-right': 'From the left', 'flip-left': 'Flip sideways', 'mask-left': 'Wipe sideways', 'scale-down': 'Shrink in' }
const SHORT_HOVER: Partial<Record<HoverEffect, string>> = { underline: 'Underline', 'tilt-3d': '3D tilt', 'zoom-image': 'Zoom picture', 'lift-shadow': 'Lift + shadow' }

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

export type ParallaxSetting = {
  value: BackgroundParallax | undefined
  available: boolean
  onChange: (value: BackgroundParallax | undefined) => void
  /** B19: a note when the section's background moves while scrolling (choosing a parallax turns that off). */
  replacedBy?: string
}

/**
 * `value` undefined = nothing moves; a change that leaves nothing moving removes the group.
 * `onPreview` plays the entrance, the sequence and the loop on the canvas (▶ Play).
 */
export function MotionControl({ nodeType = 'heading', value, onChange, onPreview, onTimeline, hover, onHover, parallax }: {
  nodeType?: string
  value: Motion | undefined
  onChange: (value: Motion | undefined) => void
  onPreview?: () => void
  /** B18: opens the Motion timeline (sections and inner rows). */
  onTimeline?: () => void
  hover?: HoverStyle
  onHover?: (value: HoverStyle | undefined) => void
  parallax?: ParallaxSetting
}) {
  const current = motionState(value)
  const on = current.entrance !== 'none'
  const staggering = canStagger(nodeType) && current.stagger_children > 0
  const update = (patch: Partial<MotionState>) => onChange(toMotion({ ...current, ...patch }))
  const hoverEffect = hover?.effect ?? 'none'
  const hoverDuration = hover?.duration ?? B9_DEFAULTS.hoverDuration
  return (
    <div className="flex flex-col gap-4" data-testid="motion-control">
      <TileGroup
        label="Entrance"
        tooltip="Plays when the shopper scrolls to it. Point at a tile to see it. Shoppers who turned off animations in their device settings see it without movement."
        value={current.entrance}
        options={B6_ENUMS.motionEntrance.map((e) => ({ value: e, label: SHORT_ENTRANCE[e] ?? ENTRANCE_LABELS[e], title: ENTRANCE_LABELS[e] }))}
        onChange={(entrance) => update({ entrance })}
        testId="entrance-tiles"
        renderTile={(option, state) => <EntrancePreview entrance={option.value} easing={current.easing} duration={on ? current.duration : 600} active={state.active} checked={state.checked} />}
      />
      {(on || staggering) && <EasingChips value={current.easing} options={B18_ENUMS.motionEasing} onChange={(easing) => update({ easing })} />}
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
          <TileGroup
            label="Attention loop"
            tooltip="A small repeating movement that draws the eye, e.g. on an “Order now” button or a sale badge. It pauses while the shopper points at it."
            value={current.loop}
            options={B9_ENUMS.motionLoop.map((l) => ({ value: l, label: SHORT_LOOP[l], title: LOOP_LABELS[l] }))}
            onChange={(loop) => update({ loop })}
            columns={3}
            testId="loop-tiles"
            renderTile={(option, state) => <LoopPreview loop={option.value} active={state.active} />}
          />
          {current.loop !== 'none' && (
            <ToggleRow
              label="Keep looping"
              checked={current.loop_forever}
              hint={
                current.loop_forever
                  ? 'It keeps moving. Shoppers get a “Pause animations” button on the page, as moving things must be possible to stop.'
                  : `Off: it plays ${B9_LIMITS.loopCycles} times and stops, which is calmer for shoppers.`
              }
              onChange={(loop_forever) => update({ loop_forever })}
            />
          )}
        </>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!motionPlays(value) || !onPreview} onClick={onPreview} aria-label="Play animation">
          <PlayIcon data-icon="inline-start" /> Play
        </Button>
        {onTimeline && canStagger(nodeType) && (
          <Button type="button" variant="outline" size="sm" onClick={onTimeline}>
            <ChartGanttIcon data-icon="inline-start" /> Open timeline
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The same on every device. Entrances don’t play while you edit; use Play, or Preview motion in the toolbar for loops. Shoppers who turned off animations on their device see everything without movement.
      </p>

      {onHover && canHover(nodeType) && (
        <div className="flex flex-col gap-4 border-t pt-4" data-testid="hover-effect-control">
          <TileGroup
            label="Hover effect"
            tooltip="What it does when a shopper points at it with a mouse. Keyboard users see the same when they move to it. Point at a tile to try it."
            value={hoverEffect}
            options={B9_ENUMS.hoverEffect.map((h) => ({ value: h, label: SHORT_HOVER[h] ?? HOVER_LABELS[h], title: HOVER_HINTS[h] ? `${HOVER_LABELS[h]}: ${HOVER_HINTS[h]}` : HOVER_LABELS[h] }))}
            onChange={(effect) => onHover(toHover(effect, hoverDuration))}
            testId="hover-tiles"
            renderTile={(option, state) => <HoverPreview effect={option.value} active={state.active} />}
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
          {parallax.available && parallax.replacedBy && <p className="text-xs text-muted-foreground" data-testid="parallax-replaced">{parallax.replacedBy}</p>}
        </div>
      )}
    </div>
  )
}
