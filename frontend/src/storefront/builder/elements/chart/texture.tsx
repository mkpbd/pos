import { SERIES_LIGHT } from './palette'
import { TEXTURE_SPACING, textureAngle, textureId } from './texture-ids'

/*
 * The texture fill — identity's backup channel where hue fails (print, forced colours, an explicit
 * accessibility setting). One directional line fill at 45° and its 135° mirror only, inked
 * tone-on-tone (a darker step over the slot's own colour); slots differ by angle and spacing at equal
 * stroke weight. Never shown by default: chart.css switches marks to `var(--viz-tex)` only under
 * `@media print`, `forced-colors: active` or `data-texture="on"`.
 */

export function TexturePatterns({ uid }: { uid: string }) {
  return (
    <defs>
      {SERIES_LIGHT.map((_, slot) => {
        const size = TEXTURE_SPACING[slot] ?? 9
        return (
          <pattern key={slot} id={textureId(uid, slot)} patternUnits="userSpaceOnUse" width={size} height={size} patternTransform={`rotate(${textureAngle(slot)})`} data-angle={textureAngle(slot)}>
            <rect className="viz-tex-bg" width={size} height={size} style={{ fill: `var(--viz-s${slot + 1})` }} />
            <line className="viz-tex-ink" x1={size / 2} y1={0} x2={size / 2} y2={size} strokeWidth={2} style={{ stroke: 'rgba(0, 0, 0, 0.45)' }} />
          </pattern>
        )
      })}
    </defs>
  )
}
