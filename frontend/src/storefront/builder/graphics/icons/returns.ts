import { circle, rect, star, type IconDrawing } from './shapes'

/** A 12-point seal (alternating radii), the first point straight up. */
function seal(cx: number, cy: number, outer: number, inner: number): string {
  const parts: string[] = []
  for (let i = 0; i < 24; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (Math.PI * i) / 12 - Math.PI / 2
    parts.push(`${i === 0 ? 'M' : 'L'}${Math.round((cx + radius * Math.cos(angle)) * 100) / 100} ${Math.round((cy + radius * Math.sin(angle)) * 100) / 100}`)
  }
  return `${parts.join('')}z`
}

/* Returns: easy returns, refunds, exchanges, warranty, quality, done. */
export const RETURNS_ICONS = {
  return_box: [rect(6, 22, 28, 20, 2), 'M6 29h28', 'M20 22v7', 'M42 24v-8a6 6 0 0 0-6-6H16', 'M21 5l-5 5 5 5'],
  refund: ['M40 24a16 16 0 1 1-4.7-11.3', 'M36 5v8h-8', rect(16, 19, 16, 10, 2), circle(24, 24, 2)],
  exchange: ['M8 17h30', 'M32 11l6 6-6 6', 'M40 31H10', 'M16 25l-6 6 6 6'],
  warranty: [circle(24, 18, 12), 'M19 18l4 4 7-7', 'M17 28l-4 14 6-3 4 5 1-6', 'M31 28l4 14-6-3-4 5-1-6'],
  quality_badge: [seal(24, 24, 20, 16.5), star(24, 25, 9, 4)],
  check_circle: [circle(24, 24, 18), 'M16 24l6 6 10-12'],
} satisfies Record<string, IconDrawing>
