/** Relative luminance (WCAG) of a #rgb / #rrggbb colour; null for anything else. */
export function relativeLuminance(color: string | null | undefined): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim() ?? '')?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** True for a light text colour (#rgb / #rrggbb, relative luminance > 0.5); unknown values count as light. */
export function isLightColor(color: string | null | undefined): boolean {
  const luminance = relativeLuminance(color)
  return luminance === null || luminance > 0.5
}

/** WCAG contrast ratio (1–21) of two colours; null when either is not a hex colour. */
export function contrastRatio(a: string | null | undefined, b: string | null | undefined): number | null {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The first candidate that stands out from `background` (contrast ≥ `min`, WCAG's 3:1 for UI parts
 * by default), else the candidate with the most contrast. Unknown colours never win over known ones.
 */
export function legibleOn(background: string, candidates: string[], min = 3): string {
  let best = candidates[0] ?? '#ffffff'
  let bestRatio = -1
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background)
    if (ratio === null) continue
    if (ratio >= min) return candidate
    if (ratio > bestRatio) {
      best = candidate
      bestRatio = ratio
    }
  }
  return best
}
