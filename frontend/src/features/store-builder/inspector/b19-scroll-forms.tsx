/*
 * B19 Scroll stories (contract §3), the Content tab and page settings parts:
 *  - "Slow zoom (Ken Burns)" on pictures (image, image carousel, hero slider): off, slow or normal
 *    and the direction. It keeps moving, so shoppers get the B18 Pause button; still for shoppers
 *    who turned off animations.
 *  - Page settings → "Reading progress bar" (pages, content pages and store page templates): a thin
 *    bar that fills as the shopper reads down the page — on / off, top or bottom, colour, thickness.
 */

import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import type { KenBurns, KenBurnsDirection, ScrollProgress } from '@/storefront/builder/types'
import { Segmented, SliderControl } from '../controls'
import {
  KEN_BURNS_DIRECTION_LABELS,
  KEN_BURNS_DIRECTIONS,
  KEN_BURNS_LABELS,
  KEN_BURNS_SPEEDS,
  SCROLL_PROGRESS_COLOR_LABELS,
  SCROLL_PROGRESS_COLORS,
  SCROLL_PROGRESS_DEFAULTS,
  SCROLL_PROGRESS_LIMITS,
  SCROLL_PROGRESS_POSITIONS,
  withKenBurns,
} from './b19-scroll'
import type { BuilderNode, InspectorChangeOptions } from './types'

type KenBurnsNode = BuilderNode & { props: { ken_burns?: Exclude<KenBurns, 'none'>; ken_burns_direction?: KenBurnsDirection } }

export function KenBurnsPicker({ node, onChange, error }: { node: BuilderNode; onChange: (next: BuilderNode, opts?: InspectorChangeOptions) => void; error?: string }) {
  const n = node as KenBurnsNode
  const speed: KenBurns = n.props.ken_burns ?? 'none'
  const direction: KenBurnsDirection = n.props.ken_burns_direction ?? 'alternate'
  const many = node.type !== 'image'
  const set = (nextSpeed: KenBurns, nextDirection: KenBurnsDirection) =>
    onChange({ ...n, props: withKenBurns(n.props as Record<string, unknown>, nextSpeed, nextDirection) } as BuilderNode, { coalesceKey: `${n.id}:ken_burns` })
  return (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4" data-check-field="ken_burns" data-testid="ken-burns-picker">
      <Segmented
        label="Slow zoom (Ken Burns)"
        tooltip={`The ${many ? 'pictures zoom and drift' : 'picture zooms and drifts'} very slowly, like in a film. Shoppers who turned off animations see ${many ? 'them' : 'it'} still.`}
        value={speed}
        options={KEN_BURNS_SPEEDS.map((s) => ({ value: s, label: KEN_BURNS_LABELS[s] }))}
        onChange={(s) => set(s, direction)}
      />
      {speed !== 'none' && (
        <>
          <Segmented
            label="Direction"
            tooltip={many ? 'In and out: one picture zooms in, the next zooms out.' : 'In and out: it zooms in, then back out.'}
            value={direction}
            options={KEN_BURNS_DIRECTIONS.map((d) => ({ value: d, label: KEN_BURNS_DIRECTION_LABELS[d] }))}
            onChange={(d) => set(speed, d)}
          />
          <p className="text-xs text-muted-foreground">It keeps moving, so shoppers get a “Pause animations” button on the page. Use Preview motion in the toolbar to see it here.</p>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

const POSITION_LABELS: Record<ScrollProgress['position'], string> = { top: 'Top', bottom: 'Bottom' }

/** `value` null = no bar; every change is one `set-scroll-progress` (canonical: all three keys). */
export function ReadingProgressPanel({ value, onChange, themeColors, error }: {
  value: ScrollProgress | null
  onChange: (value: ScrollProgress | null, coalesceKey: string) => void
  themeColors?: Record<string, string>
  error?: string
}) {
  const id = useId()
  const on = value !== null
  const current = value ?? SCROLL_PROGRESS_DEFAULTS
  const set = (patch: Partial<ScrollProgress>, key: string) => onChange({ ...current, ...patch }, `scroll_progress:${key}`)
  const color = themeColors?.[current.color_role]
  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby={`${id}-title`} data-testid="reading-progress" data-check-field="scroll_progress">
      <div className="flex items-center gap-2">
        <h3 id={`${id}-title`} className="flex-1 text-sm font-semibold">Reading progress bar</h3>
        <Switch id={`${id}-on`} checked={on} onCheckedChange={(next) => onChange(next ? { ...SCROLL_PROGRESS_DEFAULTS } : null, 'scroll_progress:on')} aria-label="Show a reading progress bar" aria-describedby={`${id}-hint`} />
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">A thin line at the edge of the screen that fills up as shoppers read down the page. Good for long pages and stories.</p>
      {on && (
        <>
          <Segmented label="Where" value={current.position} options={SCROLL_PROGRESS_POSITIONS.map((p) => ({ value: p, label: POSITION_LABELS[p] }))} onChange={(position) => set({ position }, 'position')} />
          <Segmented
            label="Colour"
            tooltip="From your theme colours (Site styles)."
            value={current.color_role}
            options={SCROLL_PROGRESS_COLORS.map((c) => ({ value: c, label: SCROLL_PROGRESS_COLOR_LABELS[c] }))}
            onChange={(color_role) => set({ color_role }, 'color')}
          />
          <SliderControl
            label="Thickness"
            value={current.thickness}
            min={SCROLL_PROGRESS_LIMITS.thickness.min}
            max={SCROLL_PROGRESS_LIMITS.thickness.max}
            step={1}
            format={(n) => `${n} px`}
            onChange={(thickness) => set({ thickness: Math.round(thickness) }, 'thickness')}
          />
          <div aria-hidden className="h-6 overflow-hidden rounded-sm border bg-muted/40" data-testid="reading-progress-sample">
            <div className={current.position === 'top' ? 'flex h-full flex-col' : 'flex h-full flex-col-reverse'}>
              <span className="block w-3/5 rounded-r-full bg-primary" style={{ height: current.thickness, ...(color ? { backgroundColor: color } : {}) }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Shoppers who turned off animations still see it; it simply moves without easing.</p>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  )
}
