/*
 * The chart element's props, read defensively (the renderer never trusts the payload's shape — the
 * server's normalize is the source of truth, contract §3) into the model the renderer draws.
 */

import type { ChartKind, ChartShowValues } from '../../types'
import { MAX_PIE_SLICES, MAX_SERIES } from './palette'

export type ChartKindName = ChartKind
export type ShowValues = ChartShowValues

export type ChartSeriesModel = { id: string; name: string; values: (number | null)[]; slot: number }

export type ChartModel = {
  /** What the owner picked. */
  requestedKind: ChartKindName
  /** What is drawn: a pie/donut with more than MAX_PIE_SLICES parts is drawn as bars (dataviz: > 6 parts → bars). */
  kind: ChartKindName
  title: string
  description: string
  labels: string[]
  series: ChartSeriesModel[]
  unit: string
  unitPosition: 'before' | 'after'
  /** Bars, columns and areas always start at zero (the length/area encodes the value). */
  yStartsAtZero: boolean
  showValues: ShowValues
  showLegend: boolean
  showTable: boolean
  height: number
}

export const KINDS: readonly ChartKindName[] = ['bar', 'column', 'line', 'area', 'pie', 'donut']
const SHOW_VALUES: readonly ShowValues[] = ['none', 'last', 'all-small']

export const LIMITS = { labels: 24, labelLength: 40, series: MAX_SERIES, nameLength: 40, pieLabels: 8, unitLength: 8, titleLength: 120, descriptionLength: 300, heightMin: 200, heightMax: 600 } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

export function isPieKind(kind: ChartKindName): boolean {
  return kind === 'pie' || kind === 'donut'
}

/** The chart model of an element's props, or null when there is nothing to draw. */
export function chartModel(props: unknown): ChartModel | null {
  const p = isRecord(props) ? props : {}
  const requestedKind = KINDS.includes(p.kind as ChartKindName) ? (p.kind as ChartKindName) : 'column'
  const labels = (Array.isArray(p.labels) ? p.labels : []).slice(0, LIMITS.labels).map((label) => text(label, LIMITS.labelLength))
  if (labels.length === 0) return null

  const pie = isPieKind(requestedKind)
  const rawSeries = (Array.isArray(p.series) ? p.series : []).filter(isRecord).slice(0, pie ? 1 : LIMITS.series)
  // Colour follows the entity: slot = position in the document's series list (never re-ranked).
  const series: ChartSeriesModel[] = rawSeries.map((s, i) => {
    const values = Array.isArray(s.values) ? s.values : []
    return {
      id: typeof s.id === 'string' && s.id ? s.id : `s${i}`,
      name: text(s.name, LIMITS.nameLength),
      values: labels.map((_, j) => finite(values[j])),
      slot: i,
    }
  })
  if (series.length === 0) return null

  let kind = requestedKind
  const first = series[0]
  if (pie && first) {
    labels.splice(LIMITS.pieLabels)
    first.values.splice(LIMITS.pieLabels)
    const parts = first.values.filter((v) => v !== null && v > 0).length
    // Part-to-whole with more than 6 parts reads better as bars (choosing-a-form.md), and a 7-slice ring
    // puts slot 7 (violet) beside slot 1 (blue), which fails the validator. Negative parts cannot be a pie.
    if (labels.length > MAX_PIE_SLICES || parts === 0 || first.values.some((v) => v !== null && v < 0)) kind = 'bar'
  }

  const height = finite(p.height)
  return {
    requestedKind,
    kind,
    title: text(p.title, LIMITS.titleLength),
    description: text(p.description, LIMITS.descriptionLength),
    labels,
    series,
    unit: text(p.unit, LIMITS.unitLength),
    unitPosition: p.unit_position === 'before' ? 'before' : 'after',
    yStartsAtZero: kind === 'bar' || kind === 'column' || kind === 'area' ? true : p.y_starts_at_zero !== false,
    showValues: SHOW_VALUES.includes(p.show_values as ShowValues) ? (p.show_values as ShowValues) : 'none',
    showLegend: p.show_legend !== false,
    showTable: p.show_table === true,
    height: height === null ? 320 : Math.min(LIMITS.heightMax, Math.max(LIMITS.heightMin, Math.round(height))),
  }
}

/** Every finite value of the model. */
export function allValues(model: ChartModel): number[] {
  return model.series.flatMap((s) => s.values.filter((v): v is number => v !== null))
}

/** Pie/donut parts: label, value and share (only positive values form slices). */
export function pieParts(model: ChartModel): { index: number; label: string; value: number; share: number }[] {
  const values = model.series[0]?.values ?? []
  const total = values.reduce<number>((sum, v) => sum + (v !== null && v > 0 ? v : 0), 0)
  return model.labels
    .map((label, index) => ({ index, label, value: values[index] ?? 0 }))
    .filter((part) => part.value > 0)
    .map((part) => ({ ...part, share: total > 0 ? part.value / total : 0 }))
}

/** The total of a pie/donut's positive parts. */
export function pieTotal(model: ChartModel): number {
  return pieParts(model).reduce((sum, part) => sum + part.value, 0)
}
