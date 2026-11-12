/*
 * B6 design controls: the entrance animation (style `motion`, desktop value for every device,
 * with "Preview animation"), the section shape dividers (top / bottom, picked from drawn previews)
 * and the section's background video (YouTube / Vimeo link + poster image).
 */

import { useId, useState } from 'react'
import { PlayIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BackgroundVideo, Motion, MotionEntrance, SectionShape, SectionShapeKind } from '@/storefront/builder/types'
import type { MediaRef } from '@/storefront/types'
import { SHAPE_PATHS } from '@/storefront/builder/section-layer-utils'
import { B6_ENUMS, B6_LIMITS, parseVideoUrl } from '@/storefront/builder/validate'
import { ColorControl, ControlLabel, HelpTip, Segmented, SelectControl, SliderControl, type PaletteColor } from '../controls'
import { MOTION_DEFAULTS } from './b6-model'
import { ImageChooser } from './fields'

/* ----------------------------------------------------------------------------------------------
 * Motion
 * -------------------------------------------------------------------------------------------- */

const ENTRANCES = B6_ENUMS.motionEntrance

const ENTRANCE_LABELS: Record<MotionEntrance, string> = {
  none: 'None',
  fade: 'Fade in',
  'slide-up': 'Slide up',
  'slide-down': 'Slide down',
  'slide-left': 'Slide in from the right',
  'slide-right': 'Slide in from the left',
  zoom: 'Zoom in',
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * The entrance animation of a node. `value` undefined = none. Choosing "None" removes the group.
 * `onPreview` replays the animation on the canvas.
 */
export function MotionControl({ value, onChange, onPreview }: { value: Motion | undefined; onChange: (value: Motion | undefined) => void; onPreview?: () => void }) {
  const current: Required<Motion> = { entrance: value?.entrance ?? 'none', duration: value?.duration ?? MOTION_DEFAULTS.duration, delay: value?.delay ?? MOTION_DEFAULTS.delay }
  const on = current.entrance !== 'none'
  return (
    <div className="flex flex-col gap-4" data-testid="motion-control">
      <SelectControl
        label="Entrance"
        tooltip="Plays once when the shopper scrolls to it. Shoppers who turned off animations in their device settings see it without movement."
        value={current.entrance}
        options={ENTRANCES.map((e) => ({ value: e, label: ENTRANCE_LABELS[e] }))}
        onChange={(entrance) => onChange(entrance === 'none' ? undefined : { ...current, entrance })}
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
            onChange={(duration) => onChange({ ...current, duration })}
          />
          <SliderControl
            label="Delay"
            tooltip="Wait before it starts, e.g. to let elements appear one after another."
            value={current.delay}
            min={B6_LIMITS.motionDelay.min}
            max={B6_LIMITS.motionDelay.max}
            step={100}
            format={seconds}
            onChange={(delay) => onChange({ ...current, delay })}
          />
        </>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!on || !onPreview} onClick={onPreview}>
          <PlayIcon data-icon="inline-start" /> Preview animation
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The same on every device. Animations don’t play while you edit; use Preview to see one.</p>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Shape dividers
 * -------------------------------------------------------------------------------------------- */

const SHAPES = B6_ENUMS.shape
type ShapeName = SectionShapeKind

const SHAPE_LABELS: Record<ShapeName, string> = { wave: 'Wave', curve: 'Curve', tilt: 'Tilt', triangle: 'Triangle', zigzag: 'Zigzag' }

/** A small drawing of the shape as the storefront draws it (SHAPE_PATHS, same flips). */
function ShapePreview({ shape, flip, edge }: { shape: ShapeName | null; flip?: boolean; edge: 'top' | 'bottom' }) {
  return (
    <svg
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
      className="h-5 w-full"
      style={shape ? { transform: `scale(${flip ? -1 : 1}, ${edge === 'top' ? -1 : 1})` } : undefined}
    >
      {shape ? <path d={SHAPE_PATHS[shape]} className="fill-current" /> : <line x1="0" y1="60" x2="1200" y2="60" className="stroke-current" strokeWidth={8} strokeDasharray="40 40" />}
    </svg>
  )
}

/** One shape divider (the top or bottom edge of a section); null = straight edge. */
export function SectionShapeControl({ edge, value, onChange, themeColors, palette, error }: {
  edge: 'top' | 'bottom'
  value: SectionShape | null
  onChange: (value: SectionShape | null, coalesce?: string) => void
  themeColors?: Record<string, string>
  palette?: readonly PaletteColor[]
  error?: string
}) {
  const label = edge === 'top' ? 'Top edge' : 'Bottom edge'
  const options: (ShapeName | null)[] = [null, ...SHAPES]
  return (
    <fieldset className="flex flex-col gap-3" data-testid={`shape-${edge}`}>
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        {label}
        <HelpTip label={label} text="A decorative shape along the edge of the section, usually in the colour of the section next to it." />
      </legend>
      <div role="radiogroup" aria-label={`${label} shape`} className="grid grid-cols-3 gap-1.5">
        {options.map((shape) => {
          const active = (value?.shape ?? null) === shape
          const name = shape ? SHAPE_LABELS[shape] : 'Straight'
          return (
            <button
              key={shape ?? 'none'}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={name}
              title={name}
              onClick={() => onChange(shape === null ? null : { shape, color: value?.color ?? 'theme:canvas', height: value?.height ?? 48, flip: value?.flip ?? false })}
              className={cn(
                'flex flex-col items-stretch gap-1 rounded-md border p-1.5 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                active && 'border-primary bg-primary/10 text-primary',
              )}
            >
              <span className="flex h-6 items-center rounded-sm bg-muted/60 px-0.5"><ShapePreview shape={shape} flip={value?.flip} edge={edge} /></span>
              <span className={cn('text-center', active ? 'font-medium text-foreground' : '')}>{name}</span>
            </button>
          )
        })}
      </div>
      {value && (
        <>
          <ColorControl
            label="Shape colour"
            value={value.color}
            onChange={(color) => color && onChange({ ...value, color }, `${edge}.color`)}
            themeColors={themeColors}
            palette={palette}
            allowTokens
          />
          <SliderControl
            label="Shape height"
            value={value.height}
            min={B6_LIMITS.shapeHeight.min}
            max={B6_LIMITS.shapeHeight.max}
            step={4}
            format={(n) => `${n} px`}
            onChange={(height) => onChange({ ...value, height }, `${edge}.height`)}
          />
          <Segmented
            label="Direction"
            value={value.flip ? 'flip' : 'normal'}
            options={[
              { value: 'normal', label: 'As shown' },
              { value: 'flip', label: 'Mirrored' },
            ]}
            onChange={(v) => onChange({ ...value, flip: v === 'flip' })}
          />
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </fieldset>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Background video (sections and inner rows, desktop value for every device)
 * -------------------------------------------------------------------------------------------- */

/**
 * A muted, looping YouTube / Vimeo video behind the content. Only a link the storefront accepts is
 * saved; until then the field shows what's wrong. The poster shows first, and alone on phones,
 * with reduced motion and with data saving.
 */
export function BackgroundVideoControl({ value, onChange }: { value: BackgroundVideo | undefined; onChange: (value: BackgroundVideo | undefined, media?: Record<string, MediaRef>) => void }) {
  const id = useId()
  const [text, setText] = useState(value?.url ?? '')
  const [seen, setSeen] = useState(value?.url)
  if (seen !== value?.url) {
    setSeen(value?.url)
    setText(value?.url ?? '')
  }
  const parsed = text.trim() === '' ? null : parseVideoUrl(text.trim())
  const invalid = text.trim() !== '' && !parsed
  const setUrl = (url: string) => {
    setText(url)
    const trimmed = url.trim()
    if (trimmed === '') return onChange(undefined)
    const video = parseVideoUrl(trimmed)
    if (video) onChange({ url: trimmed, provider: video.provider, video_id: video.video_id, ...(value?.poster ? { poster: value.poster } : {}) })
  }
  return (
    <div className="flex flex-col gap-3" data-testid="background-video">
      <div className="flex flex-col gap-1.5">
        <ControlLabel label="Video link" htmlFor={id} tooltip="Plays muted and on repeat behind the content, from YouTube’s privacy-enhanced player or Vimeo." />
        <Input
          id={id}
          inputMode="url"
          spellCheck={false}
          maxLength={500}
          placeholder="https://www.youtube.com/watch?v=…"
          value={text}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
        {invalid ? (
          <p className="text-sm text-destructive">Use a YouTube link (youtube.com/watch?v=…, youtu.be/…) or a Vimeo link (vimeo.com/123456).</p>
        ) : parsed ? (
          <p className="text-xs text-muted-foreground" role="status">{parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} video found.</p>
        ) : null}
      </div>
      {value && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Poster image</span>
          <ImageChooser
            title="Choose the poster"
            value={value.poster?.media_id ?? null}
            onChange={(mediaId, ref) => {
              const { poster: _poster, ...rest } = value
              void _poster
              onChange(mediaId ? { ...rest, poster: { media_id: mediaId } } : rest, ref ? { [ref.id]: ref } : undefined)
            }}
          />
          <p className="text-xs text-muted-foreground">Shown while the video loads, and instead of it on phones, for shoppers who turned off animations and when data saving is on.</p>
        </div>
      )}
    </div>
  )
}
