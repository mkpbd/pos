import { useEffect, useRef, useState } from 'react'

/**
 * Geometry helpers for the hand-rolled SVG charts. Amounts arrive as decimal strings; they are
 * turned into numbers here only to place marks on screen — every value a reader sees is the
 * original string, formatted by the caller.
 */

/** Pixel-only conversion of a decimal string; anything unparsable plots as zero. */
export function plotValue(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value === null || value === undefined || value.trim() === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** "Nice" axis ticks covering [min, max] (always includes 0 when the data does not go below it). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min)
  const hi = max <= lo ? lo + 1 : max
  const rough = (hi - lo) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const residual = rough / magnitude
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude
  const start = Math.floor(lo / step) * step
  const ticks: number[] = []
  for (let v = start; v < hi + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

/** Compact axis label: 1250 → "1.3k", 2400000 → "2.4M". Axis only — tooltips show exact values. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  const fmt = (n: number, suffix: string) => `${sign}${n >= 100 ? Math.round(n) : Number(n.toFixed(1))}${suffix}`
  if (abs >= 1e9) return fmt(abs / 1e9, 'B')
  if (abs >= 1e6) return fmt(abs / 1e6, 'M')
  if (abs >= 1e3) return fmt(abs / 1e3, 'k')
  return `${sign}${Number(abs.toFixed(2))}`
}

/** Which of `count` x positions get a visible label so that they never collide. */
export function labelledIndexes(count: number, width: number, minGap = 64): Set<number> {
  if (count === 0) return new Set()
  const fit = Math.max(1, Math.floor(width / minGap))
  if (count <= fit) return new Set(Array.from({ length: count }, (_, i) => i))
  const every = Math.ceil(count / fit)
  const result = new Set<number>()
  for (let i = count - 1; i >= 0; i -= every) result.add(i)
  return result
}

/**
 * Width of an element, tracked with ResizeObserver. Starts from `fallback` (also used where the
 * browser reports 0, e.g. jsdom), so charts render deterministically in tests.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setWidth(Math.round(w))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

/**
 * Series colours. Validated pairs (CVD and contrast) against the card surface in each theme:
 * the brand purple and a deepened teal (the lighter `--chart-2` teal is too light on dark cards).
 * Text never uses these — values and labels stay in foreground ink.
 */
export const CHART_THEME_CLASS =
  '[--viz-1:var(--primary)] [--viz-2:#0f8f75] [--viz-3:#c77a1e] [--viz-grid:var(--border)] dark:[--viz-2:#16a085] dark:[--viz-3:#c98330]'

export const SERIES_COLORS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)'] as const
