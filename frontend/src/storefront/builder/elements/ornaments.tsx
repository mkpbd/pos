import { useId, type CSSProperties, type ReactNode } from 'react'
import { FLAG_GREEN, FLAG_RED, ornamentColorCss, REPEATABLE_ORNAMENTS, type OrnamentName } from './ornament-names'

// Re-exported for the editor (one import path for the picker).
export { ORNAMENT_NAMES, ORNAMENTS, REPEATABLE_ORNAMENTS, type OrnamentName } from './ornament-names'

/*
 * B17 ornaments: a built-in set of original, simple decorative drawings (festival and Bangladesh
 * motifs). Every drawing is purely decorative (`aria-hidden`), painted with two colours: `color`
 * (the main one) and `secondary` (null = the drawing's own tone). The flag ribbon always uses the
 * national flag colours. Border drawings can repeat across the width (an SVG pattern).
 *
 * Exported for the editor's picker previews (`OrnamentArt`; names and labels: ./ornament-names).
 */

/* -------------------------------------------------------------------------------------------- */

/** Paint of the main colour (fill / stroke) and of the second colour (with its opacity). */
const F1: CSSProperties = { fill: 'var(--o1)' }
const F2: CSSProperties = { fill: 'var(--o2)', fillOpacity: 'var(--o2a)' }
const s1 = (width: number): CSSProperties => ({ fill: 'none', stroke: 'var(--o1)', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' })
const s2 = (width: number): CSSProperties => ({ fill: 'none', stroke: 'var(--o2)', strokeOpacity: 'var(--o2a)', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' })

const r2 = (value: number) => Math.round(value * 100) / 100

/** A star polygon: `points` tips of radius `outer`, notches of radius `inner`, first tip up. */
function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const out: string[] = []
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (Math.PI / points) * i - Math.PI / 2
    out.push(`${r2(cx + radius * Math.cos(angle))} ${r2(cy + radius * Math.sin(angle))}`)
  }
  return `M${out.join('L')}Z`
}

/** A soft four-point sparkle. */
function sparklePath(cx: number, cy: number, r: number): string {
  const k = r * 0.12
  return `M${cx} ${cy - r}C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy}C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r}C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy}C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}Z`
}

/** `count` copies of a shape turned around (cx, cy). */
function around(count: number, cx: number, cy: number, draw: (key: number) => ReactNode, offset = 0): ReactNode[] {
  return Array.from({ length: count }, (_, i) => (
    <g key={i} transform={`rotate(${r2(offset + (360 / count) * i)} ${cx} ${cy})`}>
      {draw(i)}
    </g>
  ))
}

/** The secondary colour a drawing uses when none is set: a fixed tone, or the main colour, softened. */
type Tone = { color: string; opacity?: number } | 'soft'

type Drawing = { w: number; h: number; tone: Tone; draw: () => ReactNode }

const GOLD = { color: '#d99a00' }

const DRAWINGS: Record<OrnamentName, Drawing> = {
  crescent_star: {
    w: 64,
    h: 64,
    tone: GOLD,
    draw: () => (
      <>
        <path style={F1} d="M42 10A23 23 0 1 0 42 54A20 20 0 1 1 42 10Z" />
        <path style={F2} d={starPath(48, 28, 9, 3.8, 5)} />
      </>
    ),
  },
  lantern: {
    w: 48,
    h: 84,
    tone: { color: '#f6c453' },
    draw: () => (
      <>
        <circle style={s1(2.5)} cx={24} cy={6} r={4} />
        <path style={F1} d="M24 10 13 23h22Z" />
        <rect style={F1} x={11} y={23} width={26} height={4} rx={1} />
        <path style={F2} d="M13 27h22l3 30H10Z" />
        <path style={s1(2.5)} d="M13 27h22l3 30H10Z" />
        <path style={s1(2)} d="M24 27v30M18.5 27l-2 30M29.5 27l2 30" />
        <path style={F1} d="M8 57h32l-5 7H13Z" />
        <path style={F1} d="M19 64h10l-5 8Z" />
        <circle style={F1} cx={24} cy={76} r={2.5} />
      </>
    ),
  },
  mosque_dome: {
    w: 128,
    h: 72,
    tone: 'soft',
    draw: () => (
      <>
        <rect style={F1} x={10} y={24} width={8} height={48} />
        <path style={F1} d="M8 24 14 10l6 14Z" />
        <rect style={F1} x={110} y={24} width={8} height={48} />
        <path style={F1} d="M108 24l6-14 6 14Z" />
        <rect style={F1} x={22} y={50} width={84} height={22} />
        <path style={F1} d="M24 50c0-8 6-12 12-14 6 2 12 6 12 14Z" />
        <path style={F1} d="M80 50c0-8 6-12 12-14 6 2 12 6 12 14Z" />
        <rect style={F1} x={38} y={42} width={52} height={10} />
        <path style={F1} d="M40 42C40 24 54 18 64 8c10 10 24 16 24 34Z" />
        <path style={s1(2)} d="M64 8V2" />
        <circle style={F1} cx={64} cy={2} r={2} />
        <path style={F2} d="M57 72V61a7 7 0 0 1 14 0v11Z" />
        <path style={F2} d="M31 72v-7a5 5 0 0 1 10 0v7ZM87 72v-7a5 5 0 0 1 10 0v7Z" />
      </>
    ),
  },
  alpona_border: {
    w: 48,
    h: 24,
    tone: 'soft',
    draw: () => (
      <>
        <path style={s1(2)} d="M0 12C8 4 16 4 24 12S40 20 48 12" />
        <path style={F1} d="M24 4c3 3 3 5 0 8-3-3-3-5 0-8ZM24 20c3-3 3-5 0-8-3 3-3 5 0 8Z" />
        <path style={F2} d="M16 12c3-3 5-3 8 0-3 3-5 3-8 0ZM32 12c-3-3-5-3-8 0 3 3 5 3 8 0Z" />
        <circle style={F2} cx={6} cy={4} r={1.8} />
        <circle style={F2} cx={42} cy={20} r={1.8} />
        <circle style={F1} cx={6} cy={20} r={1.2} />
        <circle style={F1} cx={42} cy={4} r={1.2} />
      </>
    ),
  },
  alpona_round: {
    w: 96,
    h: 96,
    tone: 'soft',
    draw: () => (
      <>
        <circle style={s1(2)} cx={48} cy={48} r={45} />
        {around(24, 48, 48, () => <circle style={F1} cx={48} cy={8} r={1.6} />)}
        {around(12, 48, 48, () => <path style={s1(2)} d="M48 14c6 7 6 15 0 22-6-7-6-15 0-22Z" />)}
        {around(8, 48, 48, () => <path style={F2} d="M48 28c5 5 5 11 0 16-5-5-5-11 0-16Z" />, 22.5)}
        <circle style={s1(2)} cx={48} cy={48} r={9} />
        <circle style={F1} cx={48} cy={48} r={4} />
      </>
    ),
  },
  kash_flower: {
    w: 72,
    h: 96,
    tone: 'soft',
    draw: () => (
      <>
        <path style={s1(2)} d="M36 96C35 70 30 46 22 22M36 96C37 68 40 44 48 16M36 96c0-24 0-46 0-70M36 96C30 80 18 66 8 56M36 96c6-16 18-28 28-36" />
        <path style={F2} d="M22 22c-6 2-10-6-8-14 4 4 9 8 8 14ZM22 22c6-2 6-10 2-16-3 5-4 10-2 16ZM48 16c-6 0-7-8-4-14 3 4 6 9 4 14ZM48 16c6 2 10-4 9-12-5 3-9 7-9 12ZM36 26c-5-2-6-10-2-16 3 5 4 10 2 16ZM36 26c5-2 7-9 4-15-3 4-5 9-4 15ZM8 56c-4-4-2-11 4-14 0 5-2 9-4 14ZM64 60c4-4 2-11-4-14 0 5 2 9 4 14Z" />
        <path style={F1} d="M8 96c8-6 16-6 28-2 12-4 20-4 28 2Z" />
      </>
    ),
  },
  dhak: {
    w: 80,
    h: 88,
    tone: 'soft',
    draw: () => (
      <>
        {around(7, 40, 30, () => <path style={F2} d="M40 30c-4-8-4-18 0-28 4 10 4 20 0 28Z" />, -54)}
        <path style={F1} d="M14 40c-3 12-3 26 0 38h52c3-12 3-26 0-38Z" />
        <ellipse style={F2} cx={40} cy={40} rx={26} ry={6} />
        <ellipse style={s1(2)} cx={40} cy={40} rx={26} ry={6} />
        <path style={s2(1.6)} d="M16 46l8 28 8-28 8 28 8-28 8 28 8-28" />
        <ellipse style={F1} cx={40} cy={78} rx={26} ry={5} />
        <path style={s1(2.5)} d="M6 86 24 62M74 86 56 62" />
      </>
    ),
  },
  diya: {
    w: 64,
    h: 64,
    tone: { color: '#f59e0b' },
    draw: () => (
      <>
        <path style={F2} d="M32 6c-8 11-8 21 0 26 8-5 8-15 0-26Z" />
        <path style={F1} fillOpacity={0.35} d="M32 18c-3 5-3 9 0 12 3-3 3-7 0-12Z" />
        <path style={F1} d="M4 36c10 2 46 2 56 0 0 12-12 22-28 22S4 48 4 36Z" />
        <path style={F1} d="M58 36c2-3 4-5 6-5-1 4-3 6-6 7Z" />
        <path style={F1} d="M24 58h16l3 6H21Z" />
      </>
    ),
  },
  shapla: {
    w: 80,
    h: 64,
    tone: 'soft',
    draw: () => (
      <>
        {[-64, -42, 42, 64].map((angle) => (
          <path key={angle} style={F2} transform={`rotate(${angle} 40 52)`} d="M40 52C34 40 35 24 40 12c5 12 6 28 0 40Z" />
        ))}
        {[-21, 0, 21].map((angle) => (
          <path key={angle} style={F1} transform={`rotate(${angle} 40 52)`} d="M40 52C34 40 35 24 40 10c5 14 6 30 0 42Z" />
        ))}
        <ellipse style={F1} cx={40} cy={58} rx={36} ry={5} />
      </>
    ),
  },
  flag_ribbon: {
    w: 96,
    h: 48,
    tone: { color: FLAG_RED },
    draw: () => (
      <>
        <path fill={FLAG_GREEN} d="M6 8C30 0 54 16 90 8v34C54 50 30 34 6 42Z" />
        <circle fill={FLAG_RED} cx={42} cy={25} r={12} />
      </>
    ),
  },
  shaheed_minar: {
    w: 128,
    h: 80,
    tone: { color: '#c8102e' },
    draw: () => (
      <>
        <circle style={F2} cx={64} cy={38} r={30} />
        {/* The mother column: a tall frame whose top leans forward. */}
        <path style={s1(3)} d="M50 76V26M57 76V26M64 76V26M71 76V26M78 76V26M50 26h28M50 50h28M50 26l4-14h20l4 14M57 26l1.5-14M64 26V12M71 26l-1.5-14" />
        {/* Two frames on each side, lower and lower. */}
        <path style={s1(3)} d="M30 76V40M36 76V40M42 76V40M30 40h12M86 76V40M92 76V40M98 76V40M86 40h12" />
        <path style={s1(3)} d="M12 76V52M18 76V52M24 76V52M12 52h12M104 76V52M110 76V52M116 76V52M104 52h12" />
        <rect style={F1} x={4} y={76} width={120} height={4} rx={1} />
      </>
    ),
  },
  snowflake: {
    w: 64,
    h: 64,
    tone: 'soft',
    draw: () => (
      <>
        {around(6, 32, 32, () => (
          <path style={s1(2.5)} d="M32 32V4M32 12l-6-6M32 12l6-6M32 21l-7-5M32 21l7-5" />
        ))}
        <circle style={F2} cx={32} cy={32} r={4} />
      </>
    ),
  },
  gift_box: {
    w: 64,
    h: 64,
    tone: GOLD,
    draw: () => (
      <>
        <rect style={F1} x={8} y={30} width={48} height={32} rx={2} />
        <rect style={F1} x={4} y={20} width={56} height={11} rx={2} />
        <rect style={F2} x={28} y={20} width={8} height={42} />
        <path style={s2(4)} d="M32 20c-4-10-16-14-16-6 0 5 10 6 16 6ZM32 20c4-10 16-14 16-6 0 5-10 6-16 6Z" />
      </>
    ),
  },
  confetti: {
    w: 96,
    h: 48,
    tone: GOLD,
    draw: () => (
      <>
        <rect style={F1} x={6} y={8} width={6} height={3} rx={1} transform="rotate(30 9 9.5)" />
        <rect style={F2} x={26} y={30} width={6} height={3} rx={1} transform="rotate(-25 29 31.5)" />
        <rect style={F1} x={50} y={6} width={6} height={3} rx={1} transform="rotate(60 53 7.5)" />
        <rect style={F2} x={74} y={34} width={6} height={3} rx={1} transform="rotate(15 77 35.5)" />
        <circle style={F2} cx={18} cy={38} r={2.5} />
        <circle style={F1} cx={40} cy={18} r={2} />
        <circle style={F2} cx={64} cy={24} r={2.5} />
        <circle style={F1} cx={88} cy={12} r={2} />
        <path style={s1(2)} d="M30 6c2 2 0 4 2 6s0 4 2 6" />
        <path style={s2(2)} d="M82 26c2 2 0 4 2 6s0 4 2 6" />
        <path style={s1(2)} d="M8 26c2 2 0 4 2 6" />
        <path style={F1} d={starPath(56, 40, 4, 1.7, 5)} />
      </>
    ),
  },
  sparkle: {
    w: 64,
    h: 64,
    tone: GOLD,
    draw: () => (
      <>
        <path style={F1} d={sparklePath(28, 34, 26)} />
        <path style={F2} d={sparklePath(52, 12, 10)} />
        <path style={F2} d={sparklePath(54, 52, 6)} />
      </>
    ),
  },
  sale_tag: {
    w: 80,
    h: 48,
    tone: { color: '#ffffff' },
    draw: () => (
      <>
        <path style={F1} d="M22 4h50a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H22L4 24Z" />
        <circle style={F2} cx={18} cy={24} r={4} />
        <circle style={s2(3)} cx={42} cy={16} r={4} />
        <circle style={s2(3)} cx={58} cy={32} r={4} />
        <path style={s2(3)} d="M60 12 40 36" />
      </>
    ),
  },
}

function paintVars(name: OrnamentName, color: unknown, secondary: unknown): CSSProperties {
  const drawing = DRAWINGS[name]
  const main = ornamentColorCss(color) ?? ornamentColorCss('theme:primary')!
  const second = secondary === null || secondary === undefined ? undefined : ornamentColorCss(secondary)
  const tone = drawing.tone
  const vars: Record<string, string> = { '--o1': main }
  if (second) {
    vars['--o2'] = second
    vars['--o2a'] = '1'
  } else if (tone === 'soft') {
    vars['--o2'] = main
    vars['--o2a'] = '0.45'
  } else {
    vars['--o2'] = tone.color
    vars['--o2a'] = String(tone.opacity ?? 1)
  }
  return vars as CSSProperties
}

export type OrnamentArtProps = {
  name: OrnamentName
  /** `#hex` or `theme:<role>` (default the theme's primary). */
  color?: string | null
  /** `#hex`, `theme:<role>` or null (the drawing's own tone). */
  secondary?: string | null
  /** Height in px (default 48); the width follows the drawing. */
  size?: number
  /** Repeat across the width (only border drawings repeat; others ignore it). */
  repeat?: boolean
  className?: string
  style?: CSSProperties
}

/** One ornament as an inline, decorative SVG. */
export function OrnamentArt({ name, color, secondary, size = 48, repeat = false, className, style }: OrnamentArtProps) {
  const rawId = useId()
  const drawing = DRAWINGS[name]
  const vars = paintVars(name, color, secondary)
  const height = Math.max(1, size)
  const common = { 'aria-hidden': true, focusable: false, 'data-ornament': name, className, xmlns: 'http://www.w3.org/2000/svg' } as const

  if (repeat && REPEATABLE_ORNAMENTS.includes(name)) {
    const id = `orn-${rawId.replace(/[^A-Za-z0-9_-]/g, '')}`
    const scale = height / drawing.h
    return (
      <svg {...common} width="100%" height={height} style={{ ...vars, display: 'block', ...style }} data-repeat="true">
        <defs>
          <pattern id={id} patternUnits="userSpaceOnUse" width={r2(drawing.w * scale)} height={height}>
            <g transform={`scale(${r2(scale * 10_000) / 10_000})`}>{drawing.draw()}</g>
          </pattern>
        </defs>
        <rect width="100%" height={height} fill={`url(#${id})`} />
      </svg>
    )
  }

  return (
    <svg {...common} viewBox={`0 0 ${drawing.w} ${drawing.h}`} width={r2((height * drawing.w) / drawing.h)} height={height} style={{ ...vars, display: 'block', maxWidth: '100%', height: 'auto', ...style }}>
      {drawing.draw()}
    </svg>
  )
}
