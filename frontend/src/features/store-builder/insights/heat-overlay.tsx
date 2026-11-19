import type { Rect } from '@/storefront/builder/canvas/protocol'
import { formatCount, formatPercent, GRID, HEAT_COLORS, heatLegend, heatStep } from './insights-model'
import type { HeatCell } from './insights-api'

/*
 * B15 heat map on the canvas: for each section with clicks, its 20 × 20 grid drawn over the
 * section's rect (cells with clicks only, one-hue scale light → dark), the scroll reach between
 * sections ("72 % reached here") and the colour legend. Purely visual (aria-hidden, no pointer
 * events, no animation): "Clicks as a list" in the Insights panel carries the same facts.
 */

export type HeatLayer = {
  heat: Record<string, HeatCell[]>
  /** Section id → share of page views that reached it (0–100), in page order. */
  reach: Record<string, number | null>
  max: number
}

export function HeatOverlay({ layer, rects, scale }: { layer: HeatLayer; rects: Record<string, Rect>; scale: number }) {
  const sections = Object.keys(layer.reach)
    .map((id) => ({ id, rect: rects[id] }))
    .filter((s): s is { id: string; rect: Rect } => s.rect !== undefined && s.rect.h > 0)
    .sort((a, b) => a.rect.y - b.rect.y)
  const legend = heatLegend(layer.max)

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="heat-overlay">
      <div className="absolute inset-0 bg-neutral-950/15" />
      {sections.map(({ id, rect }) => {
        const cells = layer.heat[id] ?? []
        if (cells.length === 0) return null
        const w = (rect.w * scale) / GRID
        const h = (rect.h * scale) / GRID
        return (
          <div key={id} className="absolute" style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale }} data-testid={`heat-${id}`}>
            {cells.map(([cx, cy, clicks]) => (
              <span
                key={`${cx}-${cy}`}
                data-step={heatStep(clicks, layer.max)}
                className="absolute rounded-[2px]"
                style={{ left: cx * w + 1, top: cy * h + 1, width: Math.max(2, w - 2), height: Math.max(3, h - 2), background: HEAT_COLORS[heatStep(clicks, layer.max)], opacity: 0.82 }}
              />
            ))}
          </div>
        )
      })}
      {sections.slice(1).map(({ id, rect }) => {
        const reach = layer.reach[id]
        if (reach === null || reach === undefined) return null
        return (
          <div key={`reach-${id}`} className="absolute right-0 left-0 flex -translate-y-1/2 items-center" style={{ top: rect.y * scale }} data-testid={`reach-${id}`}>
            <span className="h-0.5 flex-1 bg-neutral-900/70" />
            <span className="mr-2 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow">
              {formatPercent(reach)} reached here
            </span>
          </div>
        )
      })}
      {legend.length > 0 && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1.5 text-[11px] text-neutral-900 shadow" data-testid="heat-legend">
          <span className="mr-1">Clicks per spot</span>
          <span className="tabular-nums">1</span>
          <span className="flex gap-0.5">
            {legend.map((step) => (
              <span key={step.color} title={step.label} data-range={step.label} className="block h-2.5 w-6 rounded-[2px]" style={{ background: step.color }} />
            ))}
          </span>
          <span className="tabular-nums">{formatCount(layer.max)}</span>
        </div>
      )}
    </div>
  )
}
