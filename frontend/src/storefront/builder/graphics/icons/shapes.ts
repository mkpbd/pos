/*
 * Path builders for the B20 animated icon set: every part of an icon is one SVG path (`d`), so the
 * `draw` animation can run `stroke-dashoffset` 1 → 0 on each (with `pathLength="1"`). Drawn on a
 * 48 × 48 grid, 2-unit strokes with round caps and joins, shapes kept inside 4–44.
 */

/** One icon: its paths in drawing order (`draw` traces them one after another). */
export type IconDrawing = readonly string[]

function n(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** A circle as two arcs, starting at its left point. */
export function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`
}

/** A rectangle with rounded corners (`r` 0 = square corners), clockwise from the top-left. */
export function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`
  const a = (dx: number, dy: number) => `a${n(r)} ${n(r)} 0 0 1 ${n(dx)} ${n(dy)}`
  return `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}${a(r, r)}v${n(h - 2 * r)}${a(-r, r)}h${n(-(w - 2 * r))}${a(-r, -r)}v${n(-(h - 2 * r))}${a(r, -r)}z`
}

/** A regular star: `points` tips at radius `outer`, notches at `inner`, the first tip straight up. */
export function star(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const parts: string[] = []
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (Math.PI * i) / points - Math.PI / 2
    parts.push(`${i === 0 ? 'M' : 'L'}${n(cx + radius * Math.cos(angle))} ${n(cy + radius * Math.sin(angle))}`)
  }
  return `${parts.join('')}z`
}
