import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { ChartGanttIcon, PlayIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MotionEasing } from '@/storefront/builder/types'
import { nodeLabel, nodeName, useCommands, useEditorUi } from '../commands'
import { useEditor, useEditorStoreApi } from '../store'
import { findNode } from '../tree'
import {
  addEntrance,
  barGeometry,
  dragTiming,
  EASING_LABELS,
  EASINGS,
  keyTiming,
  rowDescription,
  seconds,
  setTiming,
  timelineRows,
  timelineSpan,
  DELAY_LIMITS,
  type TimelineRow,
  type Timing,
} from './timeline-model'

/*
 * B18 §4 Motion timeline: a panel under the canvas for the section of the selection (or the one it
 * was opened for). A ruler (0–3 s, longer when needed), one row per part of the section — the
 * section, inner rows and elements in reading order — with its entrance as a bar: drag the bar to
 * change when it starts, its right edge to change how long it lasts (50 ms steps). Each bar is a
 * slider for the keyboard (←/→ start, Shift+←/→ length, ↑/↓ the row before / after) and says
 * its timing to screen readers. Every change is a normal edit (one undo step per drag).
 */

type Drag = { id: string; mode: 'move' | 'resize'; x: number; start: Timing; width: number; span: number; key: string }

export function MotionTimelinePanel({ nodeId, onClose }: { nodeId: string | null; onClose: () => void }) {
  if (!nodeId) return null
  return <TimelinePanel nodeId={nodeId} onClose={onClose} />
}

function TimelinePanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const store = useEditorStoreApi()
  const commands = useCommands()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const readOnly = useEditor((s) => s.readOnly)
  const { registry, canvas, globals } = useEditorUi()
  const hintId = useId()
  const titleId = useId()
  const listRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  /** Each drag is its own undo step. */
  const drags = useRef(0)

  // The section of the selection; else the one it was opened for.
  const sectionId = findNode(content, selection)?.sectionId ?? findNode(content, nodeId)?.sectionId ?? null
  const section = sectionId ? findNode(content, sectionId)?.node : null
  const rows = sectionId ? timelineRows(content, sectionId, (node) => nodeLabel(node, registry)) : []
  const span = timelineSpan(rows)
  const ticks = Array.from({ length: span / 500 + 1 }, (_, i) => i * 500)
  const anyEntrance = rows.some((row) => row.entrance !== 'none')

  const play = () => {
    if (!sectionId) return
    canvas.current?.scrollTo(sectionId)
    canvas.current?.playMotion(sectionId, 'section')
  }

  const apply = (id: string, timing: Partial<Timing> & { easing?: MotionEasing }, key: string, window?: number) =>
    store.getState().apply((c) => setTiming(c, id, timing), { coalesceKey: key, coalesceWindow: window })

  const startDrag = (event: PointerEvent<HTMLElement>, row: TimelineRow, mode: Drag['mode']) => {
    if (readOnly || event.button !== 0) return
    const track = event.currentTarget.closest<HTMLElement>('[data-timeline-track]')
    if (!track) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    ;(event.currentTarget.closest<HTMLElement>('[data-timeline-bar]') ?? event.currentTarget).focus()
    drag.current = { id: row.id, mode, x: event.clientX, start: { delay: row.delay, duration: row.duration }, width: track.getBoundingClientRect().width, span, key: `timeline:${row.id}:${mode}:${(drags.current += 1)}:${store.getState().history.past.length}` }
  }
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    apply(d.id, dragTiming(d.start, d.mode, event.clientX - d.x, d.width, d.span), d.key, Number.POSITIVE_INFINITY)
  }
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const focusRow = (from: HTMLElement, step: -1 | 1) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-timeline-focus]') ?? [])]
    const index = all.indexOf(from)
    all[Math.max(0, Math.min(all.length - 1, index + step))]?.focus()
  }

  const onKey = (event: KeyboardEvent<HTMLElement>, row: TimelineRow | null) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      return focusRow(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      return onClose()
    }
    // Delete / Backspace on a bar would delete the selected part of the page: not here.
    if (event.key === 'Delete' || event.key === 'Backspace') return event.preventDefault()
    if (!row || readOnly || event.ctrlKey || event.metaKey || event.altKey) return
    const next = keyTiming({ delay: row.delay, duration: row.duration }, event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    apply(row.id, next, `timeline-key:${row.id}:${event.shiftKey ? 'length' : 'start'}`)
  }

  const pick = (id: string) => {
    store.getState().select(id)
    commands.reveal(id)
  }

  const name = section ? nodeName(section, registry, globals) : ''

  return (
    <section aria-labelledby={titleId} data-testid="motion-timeline" className="flex max-h-72 shrink-0 flex-col border-t bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <ChartGanttIcon className="size-4 text-muted-foreground" aria-hidden />
        <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold">
          Motion timeline{name ? <span className="font-normal text-muted-foreground"> · {name}</span> : null}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={play} disabled={!anyEntrance} data-testid="timeline-play">
            <PlayIcon data-icon="inline-start" /> Play section
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Close the motion timeline" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="timeline-empty">
          {section && section.type !== 'section' ? 'This is a global section. Open it to change its motion — every page that uses it changes too.' : 'Select a section (or something in it) to see its motion.'}
        </p>
      ) : (
        <div className="min-h-0 overflow-auto">
          <p id={hintId} className="px-3 pt-1.5 text-xs text-muted-foreground">
            Drag a bar to change when it starts, its right edge to change how long it lasts (steps of 0.05 s). Keyboard: ← → move the start, Shift+← → the length, ↑ ↓ the row before or after.
          </p>
          <div className="grid min-w-[36rem] grid-cols-[11rem_minmax(0,1fr)_7.5rem] items-center gap-x-2 px-3 pb-2" ref={listRef}>
            <span aria-hidden />
            <div className="relative h-6" aria-hidden data-testid="timeline-ruler">
              {ticks.map((ms) => (
                <span key={ms} className="absolute top-1 -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums first:translate-x-0 last:-translate-x-full" style={{ left: `${(ms / span) * 100}%` }}>
                  {ms % 1000 === 0 ? `${ms / 1000} s` : '·'}
                </span>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">Easing</span>
            {rows.map((row) => {
              const geometry = barGeometry(row, span)
              const description = rowDescription(row)
              const entering = row.entrance !== 'none'
              const found = findNode(content, row.id)
              const visible = found ? nodeName(found.node, registry, globals) : row.label
              return (
                <div key={row.id} className="contents" data-testid="timeline-row" data-node-id={row.id}>
                  <button
                    type="button"
                    className={cn('truncate rounded px-1 py-1 text-left text-xs hover:bg-muted', selection === row.id && 'bg-primary/10 font-medium')}
                    style={{ paddingLeft: `${0.25 + row.depth * 0.75}rem` }}
                    title={`Select ${visible}`}
                    onClick={() => pick(row.id)}
                  >
                    {visible}
                  </button>
                  <div className="relative h-7 rounded bg-muted/60" data-timeline-track>
                    {ticks.map((ms) => (
                      <span key={ms} aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: `${(ms / span) * 100}%` }} />
                    ))}
                    {entering ? (
                      <>
                        {geometry.lead > 0 && <span aria-hidden className="absolute inset-y-2.5 border-t border-dashed border-primary/50" style={{ left: 0, width: `${geometry.lead}%` }} title="Waits for the part before it" />}
                        <div
                          role="slider"
                          tabIndex={0}
                          data-timeline-bar
                          data-timeline-focus
                          data-testid="timeline-bar"
                          aria-label={`${row.label} timing`}
                          aria-valuemin={DELAY_LIMITS.min}
                          aria-valuemax={DELAY_LIMITS.max}
                          aria-valuenow={row.delay}
                          aria-valuetext={description}
                          aria-describedby={hintId}
                          aria-disabled={readOnly || undefined}
                          aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                          title={description}
                          className={cn(
                            'absolute inset-y-1 flex min-w-3 items-center overflow-hidden rounded bg-primary/80 text-[10px] text-primary-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                            readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-grab active:cursor-grabbing',
                          )}
                          style={{ left: `${geometry.left}%`, width: `${geometry.width}%`, touchAction: 'none' }}
                          onPointerDown={(e) => startDrag(e, row, 'move')}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onKeyDown={(e) => onKey(e, row)}
                        >
                          <span className="truncate px-1.5" aria-hidden>
                            {seconds(row.duration)}
                          </span>
                          <span
                            aria-hidden
                            data-testid="timeline-resize"
                            className={cn('absolute inset-y-0 right-0 w-2 bg-primary', !readOnly && 'cursor-ew-resize')}
                            onPointerDown={(e) => startDrag(e, row, 'resize')}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center gap-2 px-2 text-xs text-muted-foreground">
                        <span>No entrance</span>
                        <button
                          type="button"
                          data-timeline-focus
                          disabled={readOnly}
                          className="inline-flex items-center gap-1 rounded px-1 text-foreground underline-offset-2 hover:underline disabled:opacity-50"
                          aria-label={`Add a fade-in to ${row.label}`}
                          onKeyDown={(e) => onKey(e, null)}
                          onClick={() => store.getState().apply((c) => addEntrance(c, row.id))}
                        >
                          <PlusIcon className="size-3" aria-hidden /> Fade in
                        </button>
                      </div>
                    )}
                  </div>
                  <select
                    aria-label={`${row.label} easing`}
                    className="h-7 rounded-md border bg-background px-1 text-xs disabled:opacity-50"
                    value={row.easing}
                    disabled={!entering || readOnly}
                    onChange={(e) => apply(row.id, { easing: e.target.value as MotionEasing }, `timeline-easing:${row.id}`)}
                  >
                    {EASINGS.map((easing) => (
                      <option key={easing} value={easing}>
                        {EASING_LABELS[easing]}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
