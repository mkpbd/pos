/* B20: shared shapes of the illustration scenes. */

/** A four-point sparkle centred on (x, y). */
export function sparklePath(x: number, y: number, r: number): string {
  const k = r * 0.28
  return `M${x} ${y - r}C${x + k} ${y - k} ${x + k} ${y - k} ${x + r} ${y}C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + r}C${x - k} ${y + k} ${x - k} ${y + k} ${x - r} ${y}C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - r}z`
}

/** A soft backdrop blob behind a scene. */
export const BACKDROP = 'M60 52C96 18 196 10 252 34s58 84 40 128-86 62-150 56S20 186 18 132 24 86 60 52z'
