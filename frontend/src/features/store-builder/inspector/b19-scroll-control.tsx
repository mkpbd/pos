/*
 * The Style tab's Scroll group (B19 "Scroll stories", contract §3): an effect that plays while the
 * shopper scrolls (tiles with tiny previews that play while pointed at or focused; still under
 * "reduce motion"), how strong it is, when it plays, and ▶ Preview, which scrolls the canvas node
 * through the screen once. For sections, the background picture that moves while scrolling (it
 * replaces the B9 parallax). Every value is the desktop (`base`) value and applies on every device.
 */

import { useRef } from 'react'
import { PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BackgroundScroll, ScrollStyle } from '@/storefront/builder/types'
import { Segmented, SelectControl } from '../controls'
import { Stage, TileGroup } from './b18-motion-tiles'
import { useLoop } from './preview-loop'
import {
  BACKGROUND_SCROLL_LABELS,
  BACKGROUND_SCROLL_PREVIEW,
  BACKGROUND_SCROLLS,
  SCROLL_EFFECT_HINTS,
  SCROLL_EFFECT_LABELS,
  SCROLL_EFFECTS,
  SCROLL_INTENSITIES,
  SCROLL_INTENSITY_LABELS,
  SCROLL_PREVIEW_MS,
  SCROLL_RANGE_LABELS,
  SCROLL_RANGES,
  scrollPreviewKeyframes,
  scrollState,
  toScroll,
  type ScrollState,
} from './b19-scroll'

const EMPTY = 'block size-4 rounded-[3px] border border-dashed border-muted-foreground/60'

/** A scroll effect's tile: the square comes up through the tile as if the page scrolled. */
export function ScrollPreview({ state, active }: { state: ScrollState; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const effect = state.effect
  const play = (el: HTMLElement) => (effect === 'none' ? null : el.animate(scrollPreviewKeyframes(effect, state.intensity, state.range), { duration: SCROLL_PREVIEW_MS, easing: 'linear', fill: 'both' }))
  useLoop(ref, active && effect !== 'none', play, 500, `${effect}:${state.intensity}:${state.range}`)
  return (
    <Stage>
      {effect === 'none' ? <span className={EMPTY} /> : <span ref={ref} className="block size-4 rounded-[3px] bg-primary" data-scroll-preview={effect} />}
    </Stage>
  )
}

/** A background motion's tile: a striped "photo" behind a frame zooms or moves. */
export function BackgroundScrollPreview({ value, active }: { value: BackgroundScroll; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const play = (el: HTMLElement) => (value === 'none' ? null : el.animate(BACKGROUND_SCROLL_PREVIEW[value], { duration: SCROLL_PREVIEW_MS, easing: 'linear', fill: 'both' }))
  useLoop(ref, active && value !== 'none', play, 400, value)
  return (
    <Stage className="bg-transparent">
      <span className="relative block h-full w-full overflow-hidden rounded-sm">
        <span
          ref={ref}
          className={cn('absolute inset-0 block bg-[repeating-linear-gradient(135deg,var(--color-primary)_0_4px,transparent_4px_9px)] opacity-50', value === 'zoom_out' && 'scale-[1.35]')}
        />
      </span>
    </Stage>
  )
}

export type BackgroundScrollSetting = {
  value: BackgroundScroll
  /** The section's desktop background is a picture. */
  available: boolean
  /** The B9 background scrolling (parallax) is on: choosing a motion here replaces it. */
  parallax: boolean
  onChange: (value: BackgroundScroll) => void
}

/**
 * `value` undefined = no scroll effect; "None" removes the group. `onPreview` scrolls the node
 * through the canvas once (canvas message `preview-scroll`).
 */
export function ScrollControl({ value, onChange, onPreview, background }: {
  value: ScrollStyle | undefined
  onChange: (value: ScrollStyle | undefined) => void
  onPreview?: () => void
  background?: BackgroundScrollSetting
}) {
  const current = scrollState(value)
  const on = current.effect !== 'none'
  const update = (patch: Partial<ScrollState>) => onChange(toScroll({ ...current, ...patch }))
  return (
    <div className="flex flex-col gap-4" data-testid="scroll-control">
      <TileGroup
        label="Effect while scrolling"
        tooltip="It changes as the shopper scrolls: the further they scroll, the further it plays. Point at a tile to see it. Shoppers who turned off animations see it in place, without movement."
        value={current.effect}
        options={(['none', ...SCROLL_EFFECTS] as const).map((e) => ({ value: e, label: SCROLL_EFFECT_LABELS[e], title: `${SCROLL_EFFECT_LABELS[e]}: ${SCROLL_EFFECT_HINTS[e]}` }))}
        onChange={(effect) => update({ effect })}
        testId="scroll-effect-tiles"
        renderTile={(option, state) => <ScrollPreview state={{ ...current, effect: option.value }} active={state.active} />}
      />
      {on && (
        <>
          <Segmented
            label="How strong"
            tooltip="How far it moves, turns or grows. Subtle suits most pages."
            value={current.intensity}
            options={SCROLL_INTENSITIES.map((i) => ({ value: i, label: SCROLL_INTENSITY_LABELS[i] }))}
            onChange={(intensity) => update({ intensity })}
          />
          <SelectControl
            label="When it plays"
            tooltip="As it comes in: it settles in place as it scrolls into view. While on screen: all the way across. As it leaves: it plays out as it scrolls away. Both: in, then out."
            value={current.range}
            options={SCROLL_RANGES.map((r) => ({ value: r, label: SCROLL_RANGE_LABELS[r] }))}
            onChange={(range) => update({ range })}
          />
        </>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!on || !onPreview} onClick={onPreview} aria-label="Preview the scroll effect" data-testid="preview-scroll">
          <PlayIcon data-icon="inline-start" /> Preview
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The same on every device. It doesn’t play while you edit; use Preview, or Preview motion in the toolbar and scroll the page. Shoppers who turned off animations, or paused them, see it in place.
      </p>

      {background && (
        <div className="flex flex-col gap-1.5 border-t pt-4" data-testid="background-scroll-control">
          <TileGroup
            label="Background moves while scrolling"
            tooltip="The background picture slowly zooms or moves as shoppers scroll past the section. Shoppers who turned off animations see it still."
            value={background.available ? background.value : 'none'}
            options={(['none', ...BACKGROUND_SCROLLS] as const).map((b) => ({ value: b, label: BACKGROUND_SCROLL_LABELS[b], disabled: !background.available && b !== 'none' }))}
            onChange={background.onChange}
            columns={3}
            testId="background-scroll-tiles"
            renderTile={(option, state) => <BackgroundScrollPreview value={option.value} active={state.active} />}
          />
          {!background.available ? (
            <p className="text-xs text-muted-foreground">Choose a background picture for Desktop first (in Background).</p>
          ) : background.parallax ? (
            <p className="text-xs text-muted-foreground" data-testid="background-scroll-replaces">Choosing one replaces the background picture scrolling set in Animation.</p>
          ) : background.value !== 'none' ? (
            <p className="text-xs text-muted-foreground" data-testid="background-scroll-replaces">This replaces the background picture scrolling in Animation.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
