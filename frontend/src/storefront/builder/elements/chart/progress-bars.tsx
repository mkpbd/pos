import { useContext, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { BootstrapContext } from '../../../api'
import { useLocale } from '../../../i18n/locale'
import { motionAllowed } from '../../motion'
import { DraftPlaceholder } from '../../preview-mark'
import { PageCtx } from '../../render-context'
import type { El } from '../shared'
import { progressColors, progressItems } from './progress-model'
import './progress.css'

/*
 * B8a `progress_bars` (contract §1 "Visualization"): a meter list — per item a visible name, its
 * value as text and a thin bar (or a ring) — never a donut per row. One hue for every item: the
 * theme primary when it passes the dataviz single-hue gates against the theme surface, else
 * categorical slot 1 of the validated palette (./single-hue.ts). The unfilled track is a lighter
 * step of the same hue. The drawing is `aria-hidden`: the text carries every value, so screen
 * readers and a visitor without colour read the same thing.
 *
 * `animate`: the fill grows from zero when the list scrolls into view (once). It never runs for a
 * visitor who prefers reduced motion, in the editor canvas, or without IntersectionObserver — the
 * final fill then shows at once — and the value text is always the final value.
 */

const RING = { size: 96, stroke: 8 } as const

export function ProgressBarsElement({ element }: { element: El<'progress_bars'> }) {
  const { formatNumber } = useLocale()
  const page = useContext(PageCtx)
  const bootstrap = useContext(BootstrapContext)
  const p = (element.props ?? {}) as Record<string, unknown>
  const items = progressItems(p)
  const ring = p.style === 'ring'
  const showValue = p.show_value !== false
  const animate = p.animate === true && page?.page.document?.key !== 'canvas'
  const rootRef = useRef<HTMLUListElement>(null)
  // 'final' is also the state without JS effects (server render, no observer, reduced motion).
  const [phase, setPhase] = useState<'final' | 'start' | 'run'>('final')

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!animate || !root || typeof IntersectionObserver === 'undefined' || !motionAllowed()) return
    setPhase('start')
    let frame = 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        // One frame at zero first, so the transition has a start to grow from.
        frame = requestAnimationFrame(() => setPhase('run'))
      },
      { threshold: 0.3 },
    )
    observer.observe(root)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      setPhase('final')
    }
  }, [animate])

  if (items.length === 0) return <DraftPlaceholder element={element} />
  const colors = progressColors(bootstrap?.theme?.colors)
  const style = colors ? ({ '--pb-fill': colors.fill, '--pb-track': colors.track } as CSSProperties) : undefined
  const valueText = (v: number) => `${formatNumber(v, { maximumFractionDigits: 1 })}%`
  const filled = (v: number) => (phase === 'start' ? 0 : v)

  return (
    <ul
      ref={rootRef}
      data-b={element.id}
      data-testid="builder-progress"
      data-style={ring ? 'ring' : 'bar'}
      data-hue={colors ? 'theme' : 'palette'}
      data-phase={phase}
      className={ring ? 'b-progress sf-progress grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-6' : 'b-progress sf-progress flex flex-col gap-4'}
      style={style}
    >
      {items.map((item) => {
        const text = valueText(item.value)
        if (ring) {
          const r = (RING.size - RING.stroke) / 2
          const circumference = 2 * Math.PI * r
          const length = (circumference * filled(item.value)) / 100
          return (
            <li key={item.id} className="flex flex-col items-center gap-2 text-center" data-testid="progress-item">
              <span className="relative inline-flex" style={{ width: RING.size, height: RING.size }}>
                <svg width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`} aria-hidden="true" className="pb-ring" data-testid="progress-figure">
                  <circle cx={RING.size / 2} cy={RING.size / 2} r={r} fill="none" strokeWidth={RING.stroke} className="pb-track" />
                  {length > 0 && (
                    <circle
                      cx={RING.size / 2}
                      cy={RING.size / 2}
                      r={r}
                      fill="none"
                      strokeWidth={RING.stroke}
                      strokeDasharray={`${length} ${circumference}`}
                      // Starts at 12 o'clock and runs clockwise.
                      transform={`rotate(-90 ${RING.size / 2} ${RING.size / 2})`}
                      className="pb-fill"
                      data-value={item.value}
                    />
                  )}
                </svg>
                {showValue && <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-sf-heading">{text}</span>}
              </span>
              <span className="text-sm font-medium text-sf-heading">
                {item.label}
                {!showValue && <span className="sr-only">: {text}</span>}
              </span>
            </li>
          )
        }
        return (
          <li key={item.id} className="flex flex-col gap-1.5" data-testid="progress-item">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 font-medium break-words text-sf-heading">
                {item.label}
                {!showValue && <span className="sr-only">: {text}</span>}
              </span>
              {showValue && <span className="shrink-0 font-semibold text-sf-heading tabular-nums">{text}</span>}
            </span>
            <span aria-hidden="true" className="pb-track block h-2 w-full overflow-hidden rounded-full" data-testid="progress-figure">
              <span className="pb-fill block h-full rounded-full" style={{ width: `${filled(item.value)}%` }} data-value={item.value} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
