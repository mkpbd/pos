import type { CSSProperties } from 'react'

/** B11: a media item's focal point in percent (`focal` in every media payload); null = centre. */
export type Focal = { x: number; y: number }

const pct = (v: number) => `${Math.min(100, Math.max(0, Math.round(v)))}%`

/**
 * `object-position` that keeps the picture's focal point in view wherever CSS crops it
 * (`object-fit: cover`). Undefined without a focal point, so the browser's centre default applies.
 */
export function focalPosition(media: { focal?: Focal | null } | null | undefined): string | undefined {
  const focal = media?.focal
  if (!focal || !Number.isFinite(focal.x) || !Number.isFinite(focal.y)) return undefined
  return `${pct(focal.x)} ${pct(focal.y)}`
}

/**
 * For a responsive `<picture>` whose mobile `<source>` (below 768 px) is another media item: each
 * picture keeps its own focal point (the mobile one centred when it has none). Undefined when
 * neither has one.
 */
export function pictureFocal(
  image: { focal?: Focal | null },
  mobile: { focal?: Focal | null } | null | undefined,
): { className: string; style: CSSProperties } | undefined {
  const desktop = focalPosition(image)
  const small = mobile ? (focalPosition(mobile) ?? '50% 50%') : undefined
  if (desktop === undefined && (small === undefined || small === '50% 50%')) return undefined
  return {
    className: 'object-(--sf-focal,50%_50%) max-md:object-(--sf-focal-m,var(--sf-focal,50%_50%))',
    style: { '--sf-focal': desktop, '--sf-focal-m': small } as CSSProperties,
  }
}

/** `style` with the focal point's `object-position` added; a position already in `style` wins. */
export function withFocal(media: { focal?: Focal | null } | null | undefined, style?: CSSProperties): CSSProperties | undefined {
  const position = focalPosition(media)
  if (!position) return style
  return { objectPosition: position, ...style }
}
