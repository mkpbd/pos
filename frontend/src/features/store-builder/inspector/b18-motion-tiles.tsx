/*
 * B18 Motion studio pickers (contract §3): visual tiles for the entrances, attention loops and
 * hover effects, each with a tiny preview that plays while the tile is pointed at or focused (the
 * chosen entrance plays once when picked), and the easing chips with a drawing of their curve.
 * The previews use the Web Animations API on a small decorative square (`aria-hidden`); with
 * "reduce motion" in the admin's device settings they stay still. Each picker is one radio group:
 * Tab reaches the chosen tile, the arrow keys move between the tiles and choose.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import type { HoverEffect, MotionEasing, MotionEntrance, MotionLoop } from '@/storefront/builder/types'
import { ControlLabel } from '../controls'
import { cssEasing, EASING_HINTS, EASING_LABELS, easingPath, ENTRANCE_PREVIEW, HOVER_HINTS, LOOP_PREVIEW, prefersReducedMotion } from './b18-motion'

/* ----------------------------------------------------------------------------------------------
 * A radio group of tiles with roving focus
 * -------------------------------------------------------------------------------------------- */

export type TileOption<T extends string> = { value: T; label: string; title?: string; disabled?: boolean }

type TileGroupProps<T extends string> = {
  label: string
  tooltip?: string
  value: T
  options: readonly TileOption<T>[]
  onChange: (value: T) => void
  columns?: 2 | 3 | 4
  testId?: string
  renderTile: (option: TileOption<T>, state: { checked: boolean; active: boolean }) => ReactNode
}

export function TileGroup<T extends string>({ label, tooltip, value, options, onChange, columns = 3, testId, renderTile }: TileGroupProps<T>) {
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [active, setActive] = useState<T | null>(null)
  const enabled = options.filter((o) => !o.disabled)
  const focusable = enabled.some((o) => o.value === value) ? value : (enabled[0]?.value ?? value)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: columns, ArrowLeft: -1, ArrowUp: -columns, Home: -Infinity, End: Infinity }
    const step = keys[event.key]
    if (step === undefined) return
    event.preventDefault()
    const index = options.findIndex((o) => o.value === value)
    let next = step === -Infinity ? 0 : step === Infinity ? options.length - 1 : Math.min(options.length - 1, Math.max(0, index + step))
    // Skip disabled tiles in the direction of travel.
    const dir = step > 0 ? 1 : -1
    while (options[next]?.disabled && next + dir >= 0 && next + dir < options.length) next += dir
    const option = options[next]
    if (!option || option.disabled || option.value === value) return
    onChange(option.value)
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <ControlLabel label={label} id={labelId} tooltip={tooltip} />
      <div role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown} className={cn('grid gap-1.5', columns === 2 ? 'grid-cols-2' : columns === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {options.map((option, i) => {
          const checked = option.value === value
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.label}
              title={option.title ?? option.label}
              disabled={option.disabled}
              tabIndex={option.value === focusable ? 0 : -1}
              onClick={() => onChange(option.value)}
              onPointerEnter={() => setActive(option.value)}
              onPointerLeave={() => setActive((a) => (a === option.value ? null : a))}
              onFocus={() => setActive(option.value)}
              onBlur={() => setActive((a) => (a === option.value ? null : a))}
              className={cn(
                'flex min-w-0 flex-col items-center gap-1 rounded-md border p-1.5 text-[11px] leading-tight text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40',
                checked && 'border-primary bg-primary/10 text-foreground',
              )}
            >
              {renderTile(option, { checked, active: active === option.value })}
              <span className={cn('w-full truncate text-center', checked && 'font-medium')}>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Previews
 * -------------------------------------------------------------------------------------------- */

const canAnimate = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function'

/**
 * Replays `play` (one run) every `gap` ms while `on`; cancels everything when it stops. A new
 * `key` (what is played) starts over; a re-render alone doesn't.
 */
function useLoop(ref: RefObject<HTMLElement | null>, on: boolean, play: (el: HTMLElement) => Animation | null, gap: number, key: string) {
  const playRef = useRef(play)
  useEffect(() => {
    playRef.current = play
  })
  useEffect(() => {
    const el = ref.current
    if (!on || !canAnimate(el) || prefersReducedMotion()) return
    let stopped = false
    let current: Animation | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      if (stopped) return
      try {
        current = playRef.current(el)
      } catch {
        current = null
      }
      if (!current) return
      current.onfinish = () => {
        timer = setTimeout(run, gap)
      }
    }
    run()
    return () => {
      stopped = true
      clearTimeout(timer)
      current?.cancel()
    }
  }, [ref, on, gap, key])
}

function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span aria-hidden className={cn('relative flex h-8 w-full items-center justify-center overflow-hidden rounded-sm bg-muted/60 [perspective:120px]', className)}>
      {children}
    </span>
  )
}

const BLOCK = 'block size-4 rounded-[3px] bg-primary'

/** An entrance: plays while pointed at / focused, and once when it becomes the chosen one. */
export function EntrancePreview({ entrance, easing, duration, active, checked }: { entrance: MotionEntrance; easing: MotionEasing; duration: number; active: boolean; checked: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const wasChecked = useRef(checked)
  const keyframes = entrance === 'none' ? null : ENTRANCE_PREVIEW[entrance]
  const play = (el: HTMLElement) => (keyframes ? el.animate(keyframes, { duration, easing: cssEasing(easing), fill: 'backwards' }) : null)
  useLoop(ref, active && keyframes !== null, play, 700, `${entrance}:${easing}:${duration}`)
  // Picked: it plays once, so the owner sees what they chose.
  useEffect(() => {
    const was = wasChecked.current
    wasChecked.current = checked
    if (!checked || was) return
    const el = ref.current
    if (!keyframes || !canAnimate(el) || prefersReducedMotion()) return
    try {
      el.animate(keyframes, { duration, easing: cssEasing(easing), fill: 'backwards' })
    } catch {
      /* a browser without one of the properties shows the still picture */
    }
  }, [checked, keyframes, duration, easing])
  return (
    <Stage>
      {entrance === 'none' ? <span className="block size-4 rounded-[3px] border border-dashed border-muted-foreground/60" /> : <span ref={ref} className={BLOCK} />}
    </Stage>
  )
}

export function LoopPreview({ loop, active }: { loop: MotionLoop; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const spec = loop === 'none' ? null : LOOP_PREVIEW[loop]
  const play = (el: HTMLElement) => (spec ? el.animate(spec.keyframes, { duration: spec.duration, easing: 'ease-in-out' }) : null)
  useLoop(ref, active && spec !== null, play, 0, loop)
  if (loop === 'none') return <Stage><span className="block size-4 rounded-[3px] border border-dashed border-muted-foreground/60" /></Stage>
  if (loop === 'shine') {
    return (
      <Stage>
        <span className={cn(BLOCK, 'relative h-4 w-8 overflow-hidden')}>
          <span ref={ref} className="absolute inset-y-0 left-0 w-2 -translate-x-[120%] bg-white/70" />
        </span>
      </Stage>
    )
  }
  return (
    <Stage>
      <span ref={ref} className={cn(BLOCK, 'text-primary')} />
    </Stage>
  )
}

/** The hovered state of each effect (played forwards on enter, backwards on leave). */
const HOVER_TO: Partial<Record<HoverEffect, Keyframe>> = {
  lift: { transform: 'translateY(-25%)' },
  grow: { transform: 'scale(1.18)' },
  shrink: { transform: 'scale(0.82)' },
  tilt: { transform: 'rotate(-6deg)' },
  glow: { filter: 'drop-shadow(0 0 4px currentColor)' },
  pop: { transform: 'scale(1.15)' },
  'lift-shadow': { transform: 'translateY(-20%)', boxShadow: '0 6px 8px -3px rgb(0 0 0 / 0.35)' },
}

export function HoverPreview({ effect, active }: { effect: HoverEffect; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const extra = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!active || !canAnimate(el) || prefersReducedMotion()) return
    const runs: Animation[] = []
    const add = (target: HTMLElement | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      if (!canAnimate(target)) return
      try {
        runs.push(target.animate(keyframes, options))
      } catch {
        /* still picture */
      }
    }
    const to = HOVER_TO[effect]
    if (effect === 'pop') add(el, [{ transform: 'none' }, { transform: 'scale(1.22)', offset: 0.5 }, { transform: 'scale(1.1)' }], { duration: 320, easing: 'ease-out', fill: 'forwards' })
    else if (to) add(el, [{}, to], { duration: 250, easing: 'ease-out', fill: 'forwards' })
    if (effect === 'zoom-image') add(extra.current, [{ transform: 'none' }, { transform: 'scale(1.3)' }], { duration: 300, easing: 'ease-out', fill: 'forwards' })
    if (effect === 'underline') add(extra.current, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 250, easing: 'ease-out', fill: 'forwards' })
    if (effect === 'shine' || effect === 'glare') add(extra.current, [{ transform: 'translateX(-150%) skewX(-20deg)' }, { transform: 'translateX(250%) skewX(-20deg)' }], { duration: effect === 'shine' ? 700 : 1200, easing: 'ease-in-out', fill: 'forwards' })
    return () => {
      for (const run of runs) run.cancel()
    }
  }, [active, effect])

  // 3D tilt: the square leans towards the pointer while it is over the tile.
  const onMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (effect !== 'tilt-3d' || prefersReducedMotion()) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    if (ref.current) ref.current.style.transform = `perspective(80px) rotateX(${(-y * 16).toFixed(1)}deg) rotateY(${(x * 16).toFixed(1)}deg)`
  }
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = ''
  }

  if (effect === 'none') return <Stage><span className="block size-4 rounded-[3px] border border-dashed border-muted-foreground/60" /></Stage>
  return (
    <span aria-hidden className="block w-full" onPointerMove={onMove} onPointerLeave={onLeave}>
      <Stage>
        {effect === 'zoom-image' ? (
          <span ref={ref} className="relative block size-5 overflow-hidden rounded-[3px] bg-primary/30">
            <span ref={extra} className="absolute inset-0.5 rounded-full bg-primary" />
          </span>
        ) : effect === 'underline' ? (
          <span ref={ref} className="relative block text-xs font-semibold text-foreground">
            Aa
            <span ref={extra} className="absolute inset-x-0 -bottom-0.5 h-0.5 origin-left scale-x-0 bg-primary" />
          </span>
        ) : effect === 'shine' || effect === 'glare' ? (
          <span ref={ref} className={cn(BLOCK, 'relative h-4 w-8 overflow-hidden')}>
            <span ref={extra} className={cn('absolute inset-y-0 left-0 -translate-x-[150%]', effect === 'glare' ? 'w-4 rounded-full bg-white/50 blur-[2px]' : 'w-2 bg-white/70')} />
          </span>
        ) : (
          <span ref={ref} className={cn(BLOCK, 'text-primary')} />
        )}
      </Stage>
    </span>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Easing chips
 * -------------------------------------------------------------------------------------------- */

/** A drawing of the curve (time to the right, movement up; spring and bounce go past the top). */
export function EasingCurve({ easing, className }: { easing: MotionEasing; className?: string }) {
  return (
    <svg viewBox="0 0 40 24" aria-hidden focusable="false" className={cn('h-4 w-7 shrink-0 overflow-visible', className)}>
      <line x1="0" y1="4.8" x2="40" y2="4.8" className="stroke-current opacity-25" strokeWidth="0.75" strokeDasharray="2 2" />
      <path d={easingPath(easing)} fill="none" className="stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function EasingChips({ value, options, onChange, disabled }: { value: MotionEasing; options: readonly MotionEasing[]; onChange: (value: MotionEasing) => void; disabled?: boolean }) {
  return (
    <TileGroup
      label="Movement style"
      tooltip="How the movement speeds up and slows down. The drawing shows it: time to the right, movement up."
      value={value}
      options={options.map((e) => ({ value: e, label: EASING_LABELS[e], title: `${EASING_LABELS[e]}: ${EASING_HINTS[e]}`, disabled }))}
      onChange={onChange}
      testId="easing-chips"
      renderTile={(option) => <EasingCurve easing={option.value} className="h-5 w-9" />}
    />
  )
}

export { HOVER_HINTS }
