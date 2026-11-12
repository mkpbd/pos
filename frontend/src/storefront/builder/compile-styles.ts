/*
 * Builder styles → one CSS string (STORE_BUILDER_PLAN §7, contract §3). Each node gets rules on
 * `[data-b="<id>"]` (the row layout of a section or inner row on `[data-b-row="<id>"]`): desktop rules first, then
 * `@media (max-width: 1023px)` (tablet) and `@media (max-width: 639px)` (mobile) overrides, then
 * per-device visibility and the reduced-motion rules.
 *
 * Defence in depth: every value is validated again here with the backend's patterns and enums
 * (./validate.ts) and invalid values are dropped. CSS is only ever assembled from validated
 * tokens (hex colours, bounded lengths, enums, finite numbers); the one string from outside —
 * a background image URL — must come from the payload's `media` map and is percent-escaped
 * inside a quoted `url("…")`. A final guard drops any declaration that still contains a
 * character that could end a value, a rule or the style element.
 */

import { NODE_ID } from './registry'
import type { Background, Breakpoint, Gradient, ResponsiveStyle, Shadow, Style } from './types'
import { normalizeColor, normalizeStyle, normalizeWidth, oneOf } from './validate'

export const TABLET_QUERY = '(max-width: 1023px)'
export const MOBILE_QUERY = '(max-width: 639px)'
const DESKTOP_ONLY = '(min-width: 1024px)'
const TABLET_ONLY = '(min-width: 640px) and (max-width: 1023px)'

type ColumnLike = { id?: unknown; width?: unknown; style?: unknown; elements?: unknown }
type NodeLike = { id?: unknown; type?: unknown; style?: unknown; visibility?: unknown; columns?: unknown }

export type CompileOptions = {
  /** The render payload's media map: background images are looked up here (and nowhere else). */
  media?: Readonly<Record<string, { url: string }>>
  /**
   * B4: several documents share a page (header, footer, zones, the page itself) and node ids are
   * unique per document only, so each one's rules are scoped to its wrapper
   * (`[data-b-scope="<scope>"] [data-b="…"]`). `^[a-z][a-z0-9-]{0,31}$`; anything else = unscoped.
   */
  scope?: string
}

const SCOPE = /^[a-z][a-z0-9-]{0,31}$/

/** The scope prefix of a selector (`[data-b-scope="header"] `), or '' when unscoped. */
export function scopePrefix(scope: unknown): string {
  return typeof scope === 'string' && SCOPE.test(scope) ? `[data-b-scope="${scope}"] ` : ''
}

/** `section` = anything holding a row of columns (sections and inner rows): its layout goes to `[data-b-row]`. */
type Kind = 'section' | 'column' | 'element'

type Rule = { selector: string; declarations: string[] }

type Output = Record<Breakpoint, Rule[]> & { hideDesktop: string[]; hideTablet: string[]; hideMobile: string[]; reducedMotion: Rule[] }

/* -------------------------------------------------------------------------------------------- */

/** A number as CSS: finite, at most four decimals, no exponent. */
function num(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** A validated colour as CSS: hex as is, `theme:accent_foreground` → `var(--sf-accent-foreground)`. */
export function colorCss(value: unknown): string | undefined {
  const color = normalizeColor(value)
  if (!color) return undefined
  return color.startsWith('theme:') ? `var(--sf-${color.slice(6).replace(/_/g, '-')})` : color
}

function gradientCss(gradient: Gradient): string {
  const stops = gradient.stops.map((stop) => `${colorCss(stop.color)} ${num(stop.position)}%`).join(', ')
  return gradient.type === 'linear' ? `linear-gradient(${num(gradient.angle ?? 180)}deg, ${stops})` : `radial-gradient(${gradient.shape ?? 'ellipse'}, ${stops})`
}

function shadowCss(shadow: Shadow, text = false): string {
  const color = colorCss(shadow.color)
  if (text) return `${num(shadow.x)}px ${num(shadow.y)}px ${num(shadow.blur)}px ${color}`
  return `${shadow.inset ? 'inset ' : ''}${num(shadow.x)}px ${num(shadow.y)}px ${num(shadow.blur)}px ${num(shadow.spread)}px ${color}`
}

/**
 * A media URL for `url("…")`: site-relative or http(s) only; every character outside a plain URL
 * alphabet (quotes, backslashes, parentheses, braces, angle brackets, whitespace) is percent-encoded.
 */
export function cssUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return undefined
  if (!/^\/(?![/\\])/.test(url) && !/^https?:\/\//i.test(url)) return undefined
  const escaped = Array.from(url, (char) => (/[A-Za-z0-9\-._~:/?#[\]@!$&*+,=%']/.test(char) ? char : percentEncode(char))).join('')
  return `url("${escaped}")`
}

/** encodeURIComponent leaves ( ) unescaped; those are encoded too. */
function percentEncode(char: string): string {
  return encodeURIComponent(char).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const POSITIONS: Record<string, string> = {
  center: 'center',
  top: 'center top',
  bottom: 'center bottom',
  left: 'left center',
  right: 'right center',
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom',
}

const FLEX_ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }
const FLEX_JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' }
const HOVER_TRANSFORMS: Record<string, string> = { none: 'none', lift: 'translateY(-2px)', grow: 'scale(1.03)' }

/** `prop:value`, or nothing when the value is missing or could break out of the declaration. */
function declaration(property: string, value: string | undefined, allowUrl = false): string[] {
  if (value === undefined || value === '') return []
  if (/[<>{};\\\n\r]/.test(value)) return []
  if (!allowUrl && /url\(/i.test(value)) return []
  return [`${property}:${value}`]
}

function backgroundDeclarations(background: Background, options: CompileOptions): string[] {
  if (background.type === 'none') return declaration('background', 'none')
  const overlay = typeof background.overlay === 'string' ? colorCss(background.overlay) : background.overlay ? gradientCss(background.overlay) : undefined
  const overlayLayer = overlay === undefined ? undefined : overlay.includes('gradient(') ? overlay : `linear-gradient(${overlay}, ${overlay})`
  const out: string[] = []

  if (background.type === 'color') {
    out.push(...declaration('background-color', colorCss(background.color)))
    out.push(...declaration('background-image', overlayLayer ?? 'none'))
  } else if (background.type === 'gradient') {
    const gradient = background.gradient ? gradientCss(background.gradient) : undefined
    if (gradient) out.push(...declaration('background-image', overlayLayer ? `${overlayLayer}, ${gradient}` : gradient))
  } else if (background.type === 'image' && background.image) {
    const media = options.media && Object.hasOwn(options.media, background.image.media_id) ? options.media[background.image.media_id] : undefined
    const url = media ? cssUrl(media.url) : undefined
    if (url) {
      out.push(...declaration('background-image', overlayLayer ? `${overlayLayer}, ${url}` : url, true))
      out.push(...declaration('background-position', POSITIONS[background.image.position]))
      out.push(...declaration('background-size', background.image.size))
      out.push(...declaration('background-repeat', background.image.repeat ? 'repeat' : 'no-repeat'))
    } else if (overlayLayer) {
      out.push(...declaration('background-image', overlayLayer))
    }
  }
  return out
}

function layoutDeclarations(layout: NonNullable<Style['layout']>, kind: Kind): string[] {
  const align = layout.align ? FLEX_ALIGN[layout.align] : undefined
  const justify = layout.justify ? FLEX_JUSTIFY[layout.justify] : undefined
  if (kind === 'column') {
    // A column stacks its elements: gap between them, align across, justify along.
    return [...declaration('gap', layout.gap), ...declaration('align-items', align), ...declaration('--b-align', align), ...declaration('justify-content', justify)]
  }
  // A row of columns: --b-gap also feeds the columns' flex basis (see columnWidth).
  return [
    ...declaration('--b-gap', layout.gap),
    ...declaration('row-gap', layout.row_gap),
    ...declaration('align-items', align),
    ...declaration('justify-content', justify),
    ...declaration('flex-wrap', layout.wrap === undefined ? undefined : layout.wrap ? 'wrap' : 'nowrap'),
  ]
}

/** The declarations of one breakpoint's style: for the node itself, for its row (sections) and on hover. */
function styleDeclarations(style: Style, kind: Kind, options: CompileOptions): { self: string[]; row: string[]; hover: string[] } {
  const self: string[] = []
  const row: string[] = []
  const hover: string[] = []

  if (style.background) self.push(...backgroundDeclarations(style.background, options))
  self.push(...declaration('color', colorCss(style.color)))

  const t = style.typography
  if (t) {
    self.push(...declaration('font-family', t.font === 'theme:heading' ? 'var(--sf-font-heading)' : t.font === 'theme:body' ? 'var(--sf-font-body)' : undefined))
    self.push(...declaration('font-size', t.size))
    self.push(...declaration('font-weight', t.weight === undefined ? undefined : num(t.weight)))
    self.push(...declaration('line-height', t.line_height === undefined ? undefined : num(t.line_height)))
    self.push(...declaration('letter-spacing', t.letter_spacing))
    self.push(...declaration('text-align', t.align))
    self.push(...declaration('text-transform', t.transform))
  }

  for (const box of ['margin', 'padding'] as const) {
    const sides = style.spacing?.[box]
    if (!sides) continue
    for (const side of ['top', 'right', 'bottom', 'left'] as const) self.push(...declaration(`${box}-${side}`, sides[side]))
  }

  if (style.size) {
    self.push(...declaration('width', style.size.width))
    self.push(...declaration('height', style.size.height))
    self.push(...declaration('min-height', style.size.min_height))
    self.push(...declaration('max-width', style.size.max_width))
  }

  if (style.layout && kind !== 'element') {
    const target = kind === 'section' ? row : self
    target.push(...layoutDeclarations(style.layout, kind))
  }

  if (style.border) {
    const { width, style: line, color, radius } = style.border
    self.push(...declaration('border-width', width))
    self.push(...declaration('border-style', line))
    self.push(...declaration('border-color', colorCss(color)))
    if (radius) {
      self.push(...declaration('border-top-left-radius', radius.tl))
      self.push(...declaration('border-top-right-radius', radius.tr))
      self.push(...declaration('border-bottom-right-radius', radius.br))
      self.push(...declaration('border-bottom-left-radius', radius.bl))
    }
  }

  const effects = style.effects
  if (effects) {
    if (effects.shadow) self.push(...declaration('box-shadow', effects.shadow.length > 0 ? effects.shadow.map((s) => shadowCss(s)).join(', ') : 'none'))
    if (effects.text_shadow) self.push(...declaration('text-shadow', effects.text_shadow.length > 0 ? effects.text_shadow.map((s) => shadowCss(s, true)).join(', ') : 'none'))
    self.push(...declaration('opacity', effects.opacity === undefined ? undefined : num(effects.opacity)))
    const h = effects.hover
    if (h) {
      hover.push(...declaration('color', colorCss(h.color)))
      hover.push(...declaration('background-color', colorCss(h.background_color)))
      if (h.shadow) hover.push(...declaration('box-shadow', h.shadow.length > 0 ? h.shadow.map((s) => shadowCss(s)).join(', ') : 'none'))
      hover.push(...declaration('transform', h.transform ? HOVER_TRANSFORMS[h.transform] : undefined))
    }
  }

  return { self, row, hover }
}

/** `flex-basis` for a width: the share of the row minus its share of the gaps (`--b-gap`), so 50 % + 50 % fit beside one gap. */
function columnBasis(width: number): string {
  const gapShare = num(1 - width / 100)
  return gapShare === '0' ? '100%' : `calc(${num(width)}% - var(--b-gap) * ${gapShare})`
}

/* -------------------------------------------------------------------------------------------- */

function selectorFor(id: string, options: CompileOptions = {}): string {
  return `${scopePrefix(options.scope)}[data-b="${id}"]`
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && NODE_ID.test(id)
}

function addRule(rules: Rule[], selector: string, declarations: string[]) {
  if (declarations.length > 0) rules.push({ selector, declarations })
}

function compileNodeStyle(out: Output, id: string, kind: Kind, rawStyle: unknown, options: CompileOptions, extra: Partial<Record<Breakpoint, string[]>> = {}) {
  const style: ResponsiveStyle = normalizeStyle(rawStyle)
  const selector = selectorFor(id, options)
  const breakpoints = ['base', 'tablet', 'mobile'] as const
  const compiled = breakpoints.map((breakpoint) => {
    const value = style[breakpoint]
    return value ? styleDeclarations(value, kind, options) : { self: [], row: [], hover: [] }
  })
  // Transitions only when hover changes something; none (and no movement) for reduced motion.
  const hasHover = compiled.some((declarations) => declarations.hover.length > 0)
  const transition = hasHover ? ['transition:color 0.2s ease,background-color 0.2s ease,box-shadow 0.2s ease,transform 0.2s ease'] : []

  breakpoints.forEach((breakpoint, index) => {
    const declarations = compiled[index]!
    addRule(out[breakpoint], selector, [...(extra[breakpoint] ?? []), ...declarations.self, ...(breakpoint === 'base' ? transition : [])])
    addRule(out[breakpoint], `${scopePrefix(options.scope)}[data-b-row="${id}"]`, declarations.row)
    addRule(out[breakpoint], `${selector}:hover,${selector}:focus-visible`, declarations.hover)
  })
  if (hasHover) {
    out.reducedMotion.push({ selector, declarations: ['transition:none'] }, { selector: `${selector}:hover,${selector}:focus-visible`, declarations: ['transform:none'] })
  }
}

function compileVisibility(out: Output, id: string, visibility: unknown, options: CompileOptions) {
  if (typeof visibility !== 'object' || visibility === null) return
  const v = visibility as Record<string, unknown>
  const selector = selectorFor(id, options)
  if (v.desktop === false) out.hideDesktop.push(selector)
  if (v.tablet === false) out.hideTablet.push(selector)
  if (v.mobile === false) out.hideMobile.push(selector)
}

function compileColumns(out: Output, columns: unknown, options: CompileOptions) {
  if (!Array.isArray(columns)) return
  for (const column of columns as ColumnLike[]) {
    if (typeof column !== 'object' || column === null || !validId(column.id)) continue
    const width = normalizeWidth(column.width)
    const widths: Partial<Record<Breakpoint, string[]>> = {
      base: [`flex:0 1 ${columnBasis(width.base)}`],
      tablet: width.tablet === undefined ? [] : [`flex:0 1 ${columnBasis(width.tablet)}`],
      mobile: width.mobile === undefined ? [] : [`flex:0 1 ${columnBasis(width.mobile)}`],
    }
    compileNodeStyle(out, column.id, 'column', column.style, options, widths)
    if (Array.isArray(column.elements)) for (const element of column.elements as NodeLike[]) compileElement(out, element, options)
  }
}

function compileElement(out: Output, element: NodeLike, options: CompileOptions) {
  if (typeof element !== 'object' || element === null || !validId(element.id)) return
  const isRow = element.type === 'inner_row'
  compileNodeStyle(out, element.id, isRow ? 'section' : 'element', element.style, options)
  compileVisibility(out, element.id, element.visibility, options)
  if (isRow) compileColumns(out, element.columns, options)
}

function block(query: string, body: string[]): string[] {
  return body.length > 0 ? [`@media ${query}{`, ...body.map((line) => `  ${line}`), '}'] : []
}

function rulesCss(rules: Rule[]): string[] {
  return rules.map((rule) => `${rule.selector}{${rule.declarations.join(';')}}`)
}

function hideCss(selectors: string[]): string[] {
  return selectors.length > 0 ? [`${selectors.join(',')}{display:none}`] : []
}

/** The CSS for a document or render tree (sections). Invalid nodes and values produce nothing. */
export function compileStyles(sections: readonly unknown[], options: CompileOptions = {}): string {
  const out: Output = { base: [], tablet: [], mobile: [], hideDesktop: [], hideTablet: [], hideMobile: [], reducedMotion: [] }

  for (const section of sections as NodeLike[]) {
    if (typeof section !== 'object' || section === null || !validId(section.id)) continue
    compileNodeStyle(out, section.id, 'section', section.style, options)
    compileVisibility(out, section.id, section.visibility, options)
    compileColumns(out, section.columns, options)
  }

  return [
    ...rulesCss(out.base),
    ...block(TABLET_QUERY, rulesCss(out.tablet)),
    ...block(MOBILE_QUERY, [...rulesCss(out.mobile), ...hideCss(out.hideMobile)]),
    ...block(DESKTOP_ONLY, hideCss(out.hideDesktop)),
    ...block(TABLET_ONLY, hideCss(out.hideTablet)),
    ...block('(prefers-reduced-motion: reduce)', rulesCss(out.reducedMotion)),
  ].join('\n')
}

/** Exposed for the renderer: CSS `aspect-ratio` for an image aspect prop. */
export function aspectRatioCss(aspect: unknown): string | undefined {
  const value = oneOf(aspect, ['1:1', '4:3', '3:2', '16:9', '3:4'] as const)
  return value ? value.replace(':', ' / ') : undefined
}
