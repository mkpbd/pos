/**
 * WCAG 2.x contrast between two #rrggbb colours. AA requires 4.5:1 for body text
 * (3:1 for large text, which the storefront's button labels and nav are not).
 */
export const AA_NORMAL = 4.5

export function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!match) return null
  const [, r = '', g = '', b = ''] = match
  return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)]
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Ratio ≥ 1, or null when either colour is not a valid hex value. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHex(foreground)
  const bg = parseHex(background)
  if (!fg || !bg) return null
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

export function meetsAA(ratio: number | null): boolean {
  return ratio !== null && ratio >= AA_NORMAL
}
