/*
 * The chart element's props, read defensively (the renderer never trusts the payload's shape — the
 * server's normalize is the source of truth, contract §3) into the model the renderer draws.
 */

import type { ChartDataSource, ChartKind, ChartShowValues, ChartStoreData } from '../../types'
import { MAX_PIE_SLICES, MAX_SERIES } from './palette'

export type ChartKindName = ChartKind
export type ShowValues = ChartShowValues
export type { ChartDataSource, ChartStoreData }

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
  /** A stacked kind is drawn (≥ 2 series, every value ≥ 0); the tooltip and table then carry each stack's total. */
  stacked: boolean
  dataSource: ChartDataSource
}

export const KINDS: readonly ChartKindName[] = ['bar', 'column', 'line', 'area', 'pie', 'donut', 'stacked-column', 'stacked-bar']
export const DATA_SOURCES: readonly ChartDataSource[] = ['manual', 'store.products_per_category', 'store.rating_breakdown']
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

export function isStackedKind(kind: ChartKindName): boolean {
  return kind === 'stacked-column' || kind === 'stacked-bar'
}

/** The element's data source (unknown values read as the owner's own grid). */
export function chartDataSource(props: unknown): ChartDataSource {
  const source = isRecord(props) ? props.data_source : undefined
  return DATA_SOURCES.includes(source as ChartDataSource) ? (source as ChartDataSource) : 'manual'
}

/**
 * The chart model of an element's props, or null when there is nothing to draw. A store-source chart
 * draws `store` (its `data[id]`) instead of the authored labels/series, which the server keeps as they
 * were typed; without store data it has nothing to draw.
 */
export function chartModel(props: unknown, store?: ChartStoreData | null): ChartModel | null {
  const p = isRecord(props) ? props : {}
  const dataSource = chartDataSource(p)
  const source: Record<string, unknown> = dataSource === 'manual' ? p : isRecord(store) ? store : {}
  const requestedKind = KINDS.includes(p.kind as ChartKindName) ? (p.kind as ChartKindName) : 'column'
  const labels = (Array.isArray(source.labels) ? source.labels : []).slice(0, LIMITS.labels).map((label) => text(label, LIMITS.labelLength))
  if (labels.length === 0) return null

  const pie = isPieKind(requestedKind)
  const rawSeries = (Array.isArray(source.series) ? source.series : []).filter(isRecord).slice(0, pie ? 1 : LIMITS.series)
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
  // A stack needs two or more series and no negative parts (a part below zero has no place in a whole):
  // otherwise it is drawn as its plain counterpart — grouped columns / bars on the same one axis.
  if (isStackedKind(requestedKind) && (series.length < 2 || series.some((s) => s.values.some((v) => v !== null && v < 0)))) {
    kind = requestedKind === 'stacked-bar' ? 'bar' : 'column'
  }
  const stacked = isStackedKind(kind)

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
    yStartsAtZero: kind === 'bar' || kind === 'column' || kind === 'area' || stacked ? true : p.y_starts_at_zero !== false,
    showValues: SHOW_VALUES.includes(p.show_values as ShowValues) ? (p.show_values as ShowValues) : 'none',
    showLegend: p.show_legend !== false,
    showTable: p.show_table === true,
    height: height === null ? 320 : Math.min(LIMITS.heightMax, Math.max(LIMITS.heightMin, Math.round(height))),
    stacked,
    dataSource,
  }
}

/** The total of a stack (the sum of its present parts), or null when the category has no value at all. */
export function stackTotal(model: ChartModel, labelIndex: number): number | null {
  let total: number | null = null
  for (const s of model.series) {
    const v = s.values[labelIndex] ?? null
    if (v !== null) total = (total ?? 0) + v
  }
  return total
}

/** Every stack's total (stacked kinds): the value axis spans these, not the single parts. */
export function stackTotals(model: ChartModel): (number | null)[] {
  return model.labels.map((_, i) => stackTotal(model, i))
}

/** Every finite value the value axis must reach (a stacked chart: each stack's total). */
export function allValues(model: ChartModel): number[] {
  if (model.stacked) return stackTotals(model).filter((v): v is number => v !== null)
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
