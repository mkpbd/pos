import { textWidth } from './format'
import type { ChartLayout, Stop } from './layout'

/* Where the tooltip sits: above its mark, inside the chart's width (never causing horizontal scroll). */

const PAD = 12
const ROW = 20

export function tooltipBox(stop: Stop, layout: ChartLayout): { left: number; top: number; width: number } {
  const contentW = Math.max(
    textWidth(stop.title, 12),
    ...stop.rows.map((r) => 20 + textWidth(r.value, 14) + 8 + textWidth(r.name, 12) + (r.share ? 8 + textWidth(r.share, 12) : 0)),
  )
  const width = Math.min(Math.max(120, Math.ceil(contentW) + PAD * 2), Math.max(120, layout.width - 8), 280)
  const height = PAD * 2 + 16 + stop.rows.length * ROW
  const left = Math.max(0, Math.min(layout.width - width, stop.anchor.x - width / 2))
  const above = stop.anchor.y - height - 10
  const top = above >= 0 ? above : Math.min(stop.anchor.y + 16, Math.max(0, layout.height - height))
  return { left, top, width }
}
