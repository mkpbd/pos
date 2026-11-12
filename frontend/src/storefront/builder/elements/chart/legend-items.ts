import { isPieKind, pieParts, type ChartKindName, type ChartModel } from './model'

/* The legend's entries (./legend.tsx draws them): series, or pie parts, in their fixed slot order. */

export type LegendItem = { key: string; slot: number; name: string; mark: 'line' | 'rect' }

/** Two or more entries, or none (a single series or part needs no legend box: the title names it). */
export function legendItems(model: ChartModel): LegendItem[] {
  const items = entries(model)
  return items.length >= 2 ? items : []
}

function entries(model: ChartModel): LegendItem[] {
  if (isPieKind(model.kind)) {
    return pieParts(model).map((part) => ({ key: `p-${part.index}`, slot: part.index, name: part.label, mark: 'rect' }))
  }
  // A pie drawn as bars is one series (one hue): no legend.
  if (isPieKind(model.requestedKind)) return []
  const mark = swatchFor(model.kind)
  return model.series.map((s) => ({ key: s.id, slot: s.slot, name: s.name, mark }))
}

function swatchFor(kind: ChartKindName): 'line' | 'rect' {
  return kind === 'line' ? 'line' : 'rect'
}
