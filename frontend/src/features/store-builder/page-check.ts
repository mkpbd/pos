import { contrastRatio } from '@/storefront/color'
import { documentContext } from '@/storefront/builder/registry'
import type { Breakpoint, BuilderContent, Column, DocumentContext } from '@/storefront/builder/types'
import { safeUrl } from '@/storefront/builder/validate'
import { hasSeo, readSeo } from './inspector/seo-panel-model'
import { Collector, focus, isObj, label, list, megabytes, pictures, str, visibleAnywhere, type Obj, type Place, type StyledNode } from './page-check-core'
import { runSpeedCheck, type CheckFonts } from './page-check-speed'
import { runMotionCheck } from './page-check-motion'
import { resolveStyleValue } from './inspector/style-model'
import { templateKeyOf } from '@/storefront/builder/templates/types'
import { CORE_NAMES, coreElementOf, elementsOfTypeWithState } from './store-page-core'

/*
 * B10 page check (spec §2), the pure part: what a shop owner should look at before publishing.
 * `runPageCheck` reads the draft as the canvas draws it (global sections expanded), the theme's
 * colours and what is known about the pictures (size, width), and lists issues — each with a
 * severity, a plain message, the node and field it is about and, where possible, a Fix it
 * descriptor. The editor's Check page panel (agent A) shows them and executes the fixes:
 *  - `focus`: select `node_id` (null = the page settings) and focus `field` on `tab` of the inspector;
 *  - `apply`: `store.apply((c) => applyPageCheckFix(c, fix))` (./page-check-fix.ts), one undo step;
 *  - `site-styles`: open the Site styles drawer.
 * `mergeCheckIssues` adds the server's checks (POST …/documents/{id}/check, ./page-check-api.ts).
 * B15: the "Speed" issues (group `speed`, ./page-check-speed.ts) come with them; their points
 * (`details.penalty`) make the speed score (`speedScore(issues)`).
 * Errors don't block publishing: the owner decides.
 */

export type PageCheckSeverity = 'error' | 'warning' | 'tip'
export type PageCheckTab = 'content' | 'style' | 'advanced'

/** What an `apply` fix changes (pure, see applyPageCheckFix). */
export type PageCheckAction =
  /** `style.<breakpoint>.color` of the node. */
  | { type: 'set-color'; breakpoint: Breakpoint; color: string }
  /** `style.<breakpoint>.typography.size` of the node. */
  | { type: 'set-text-size'; breakpoint: Breakpoint; size: string }
  /** visibility desktop, tablet and mobile all on. */
  | { type: 'show-on-all-devices' }
  /** A heading element's level. */
  | { type: 'set-heading-level'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  /** B15: one step down among its siblings (a section below the next one). */
  | { type: 'move-down' }
  /** B18: the node's entrance animation removed (its loop and the rest of its motion stay). */
  | { type: 'remove-entrance' }

export type PageCheckFix =
  /** Select `node_id` (null: the page settings, e.g. `seo.title`) and focus `field` (a form key; null: just select). */
  | { kind: 'focus'; label: string; node_id: string | null; tab: PageCheckTab; field: string | null }
  /** B14: add an element of `type` (a store page's missing main part) as the Add panel would. */
  | { kind: 'insert'; label: string; type: string }
  | { kind: 'apply'; label: string; node_id: string; action: PageCheckAction }
  | { kind: 'site-styles'; label: string }

export type PageCheckIssue = {
  /** Stable within one check: `<code>:<node_id>:<field>`. */
  key: string
  code: string
  severity: PageCheckSeverity
  message: string
  node_id: string | null
  field: string | null
  source: 'client' | 'server'
  fix: PageCheckFix | null
  details?: Record<string, unknown>
  /** B15: `speed` for the Speed group (absent: the B10 checks and the server's). */
  group?: 'speed'
}

/** One issue of POST /storefront/builder/documents/{id}/check. */
export type ServerCheckIssue = { code: string; severity: PageCheckSeverity; node_id: string | null; message: string; details?: Record<string, unknown> }

/**
 * What is known about a picture: the canvas media (width, height, alt; B15: `url` and `srcset` —
 * the original and its WebP copies) and, from the media library, its size in bytes.
 */
export type CheckMedia = { width?: number; height?: number; size?: number; alt?: string | null; url?: string; srcset?: string }

export type PageCheckInput = {
  /** The draft with global sections drawn (editor `expanded.content`); plain content works too. */
  content: BuilderContent
  /** The document (its key decides the context and whether it has page SEO). */
  document: { kind?: string; key?: string }
  /** The draft theme: colour roles (`primary`, `text`, …; B3 roles may be null) and the content width. */
  theme: { colors: Record<string, string | null | undefined>; container_width?: number; /** B15: the fonts in use (speed check). */ fonts?: CheckFonts } | null
  media: Record<string, CheckMedia>
}

/* ----------------------------------------------------------------------------------------------
 * Limits
 * -------------------------------------------------------------------------------------------- */

export const CHECK_LIMITS = {
  /** WCAG AA. */
  contrast: 4.5,
  contrastLarge: 3,
  /** Smallest readable text on phones (px). */
  phoneText: 14,
  /** A picture wider than this, or bigger than `imageBytes`, in a slot narrower than `smallSlot` px. */
  imageWidth: 2400,
  imageBytes: 1024 * 1024,
  smallSlot: 1200,
} as const

const SEVERITY_ORDER: Record<PageCheckSeverity, number> = { error: 0, warning: 1, tip: 2 }
export const SEVERITY_LABELS: Record<PageCheckSeverity, string> = { error: 'Errors', warning: 'Warnings', tip: 'Tips' }

/* ----------------------------------------------------------------------------------------------
 * Small helpers
 * -------------------------------------------------------------------------------------------- */

const BREAKPOINTS: readonly Breakpoint[] = ['base', 'tablet', 'mobile']
const DEVICE_WORDS: Record<Breakpoint, string> = { base: 'on computers', tablet: 'on tablets', mobile: 'on phones' }

/** Visible words of a bit of HTML. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A length in px (px, rem / em at 16 px, % of 16 px); null for anything else. */
export function lengthPx(value: unknown): number | null {
  const m = /^(-?\d+(?:\.\d+)?)(px|rem|em|%)$/.exec(str(value))
  if (!m) return null
  const n = Number(m[1])
  return m[2] === 'px' ? n : m[2] === '%' ? (n / 100) * 16 : n * 16
}

/* ----------------------------------------------------------------------------------------------
 * Colours
 * -------------------------------------------------------------------------------------------- */

type Rgba = { r: number; g: number; b: number; a: number }

function parseHex(color: string): Rgba | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())
  if (!m) return null
  let hex = m[1]!
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 }
}

const toHex = ({ r, g, b }: { r: number; g: number; b: number }) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/** `over` (possibly see-through) laid on the solid `under`; a solid hex. */
export function blend(over: string, under: string): string | null {
  const a = parseHex(over)
  const b = parseHex(under)
  if (!a || !b) return null
  return toHex({ r: a.r * a.a + b.r * (1 - a.a), g: a.g * a.a + b.g * (1 - a.a), b: a.b * a.a + b.b * (1 - a.a) })
}

const ROLE_FALLBACK: Record<string, string> = { button: 'primary', button_foreground: 'primary_foreground', button_hover: 'button', link: 'accent' }

/** A theme role's colour (B3 roles follow their source while unset); null when unknown. */
export function themeRole(colors: PageCheckInput['theme'], role: string): string | null {
  if (!colors) return null
  const value = colors.colors[role]
  if (typeof value === 'string' && value !== '') return value
  const fallback = ROLE_FALLBACK[role]
  return fallback ? themeRole(colors, fallback) : null
}

/** A document colour (`#hex` or `theme:<role>`) as a hex; null when unknown. */
function resolveColor(theme: PageCheckInput['theme'], value: unknown): string | null {
  const color = str(value)
  if (color.startsWith('theme:')) return themeRole(theme, color.slice(6))
  return parseHex(color) ? color : null
}

/** Colour roles in plain words. */
const ROLE_WORDS: Record<string, string> = {
  text: 'text',
  heading: 'heading',
  primary_foreground: 'text-on-primary',
  accent_foreground: 'text-on-secondary',
  canvas: 'background',
  surface: 'surface',
}

/* ----------------------------------------------------------------------------------------------
 * Checks per element
 * -------------------------------------------------------------------------------------------- */

/** Types whose `alt` falls back to the media library's description (the storefront draws it so). */
const ALT_FALLS_BACK = new Set(['image', 'logo_carousel'])

/** The links and labels of an element: `{field, url, text}` (url null: not a link; text null: no text of its own). */
type LinkRef = { field: string; textField: string | null; url: string | null; text: string | null; what: string }

function links(element: StyledNode): LinkRef[] {
  const p = isObj(element.props) ? element.props : {}
  const out: LinkRef[] = []
  const linkOf = (value: unknown) => (isObj(value) ? str(value.url) : null)
  switch (element.type) {
    case 'button':
      if (p.action !== 'dismiss') out.push({ field: 'link', textField: 'label', url: linkOf(p.link) ?? '', text: str(p.label), what: 'button' })
      else out.push({ field: 'link', textField: 'label', url: null, text: str(p.label), what: 'button' })
      break
    case 'heading':
    case 'image':
    case 'icon_box':
    case 'discount':
      if (isObj(p.link)) out.push({ field: 'link', textField: null, url: linkOf(p.link), text: null, what: 'link' })
      break
    case 'icon':
      if (isObj(p.link)) out.push({ field: 'link', textField: 'label', url: linkOf(p.link), text: str(p.label), what: 'icon link' })
      break
    case 'cta':
      for (const key of ['primary', 'secondary'] as const) {
        const button = p[key]
        if (isObj(button)) out.push({ field: `${key}.link`, textField: `${key}.label`, url: linkOf(button.link) ?? '', text: str(button.label), what: 'button' })
      }
      break
    case 'flash_sale_bar':
      if (isObj(p.button)) out.push({ field: 'button.url', textField: 'button.label', url: str(p.button.url), text: str(p.button.label), what: 'button' })
      break
    case 'pricing_table':
      for (const plan of list(p.plans)) {
        const id = str(plan.id)
        if (isObj(plan.button)) out.push({ field: `plans.${id}.button.url`, textField: `plans.${id}.button.label`, url: str(plan.button.url), text: str(plan.button.label), what: 'button' })
      }
      break
    case 'icon_list':
    case 'image_carousel':
    case 'logo_carousel':
    case 'photo_grid': {
      const key = element.type === 'icon_list' ? 'items' : element.type === 'logo_carousel' ? 'logos' : 'images'
      for (const item of list(p[key])) if (isObj(item.link)) out.push({ field: `${key}.${str(item.id)}.link`, textField: null, url: linkOf(item.link), text: null, what: 'link' })
      if (element.type === 'photo_grid' && isObj(p.profile)) out.push({ field: 'profile.url', textField: 'profile.label', url: str(p.profile.url), text: str(p.profile.label), what: 'link' })
      break
    }
  }
  return out
}

/** HTML fields of an element: `{field, html}`. */
function htmlFields(element: StyledNode): { field: string; html: string }[] {
  const p = isObj(element.props) ? element.props : {}
  if (element.type === 'text') return [{ field: 'html', html: str(p.html) }]
  if (element.type === 'accordion' || element.type === 'tabs') return list(p.items).map((item) => ({ field: `items.${str(item.id)}.html`, html: str(item.html) }))
  return []
}

/** A link inside rich text may also be an e-mail, a phone number or a jump to a part of the page. */
function safeTextLink(href: string): boolean {
  return safeUrl(href) !== null || /^(mailto:[^\s]+|tel:\+?[0-9 ()-]{3,}|#[A-Za-z][\w-]*)$/i.test(href)
}

/** Text-bearing element types checked for contrast. */
const TEXT_TYPES = new Set([
  'heading', 'text', 'button', 'icon_box', 'icon_list', 'quote', 'cta', 'counter', 'steps', 'marquee', 'trust_badges', 'copyright', 'countdown', 'accordion', 'tabs', 'store_hours', 'progress_bars', 'newsletter_form', 'contact_block',
])

const HEADING_SIZES: Record<number, number> = { 1: 48, 2: 36, 3: 24, 4: 20, 5: 18, 6: 16 }

/** Whether WCAG calls the text large (≥ 24 px, or ≥ 18.66 px bold) at a breakpoint. */
function isLarge(element: StyledNode, bp: Breakpoint): boolean {
  const size = lengthPx(resolveStyleValue(element.style ?? {}, bp, ['typography', 'size']).value)
  const weight = resolveStyleValue<number>(element.style ?? {}, bp, ['typography', 'weight']).value
  const level = isObj(element.props) && typeof element.props.level === 'number' ? element.props.level : 2
  const heading = element.type === 'heading'
  const px = size ?? (heading ? (HEADING_SIZES[level] ?? 24) : 16)
  const bold = weight !== undefined ? weight >= 700 : heading
  return px >= 24 || (bold && px >= 18.66)
}

type Paint = { color: string | null; chosen: boolean }

/** The background under a node at a breakpoint: the first colour set on it or around it, else the page background. */
function backgroundAt(chain: StyledNode[], bp: Breakpoint, theme: PageCheckInput['theme']): Paint | null {
  const layers: string[] = []
  let chosen = false
  for (const node of chain) {
    const background = resolveStyleValue<Obj>(node.style ?? {}, bp, ['background']).value
    if (!isObj(background) || background.type === 'none' || background.type === undefined) continue
    chosen = true
    // A picture or video behind the text: the contrast can't be measured.
    if (background.type === 'image' || isObj(background.video)) return null
    if (background.type === 'gradient') {
      // Measured against its darkest-to-lightest ends by the caller: take the first stop as a stand-in.
      const stops = isObj(background.gradient) ? list(background.gradient.stops) : []
      const colors = stops.map((s) => resolveColor(theme, s.color)).filter((c): c is string => c !== null)
      if (colors.length === 0) return null
      layers.push(colors[0]!)
      // Gradients are mostly opaque; stop here.
      if ((parseHex(colors[0]!)?.a ?? 1) === 1) break
      continue
    }
    const color = resolveColor(theme, background.color)
    if (!color) return null
    layers.push(color)
    if ((parseHex(color)?.a ?? 1) === 1) break
  }
  let base = layers.length > 0 && (parseHex(layers[layers.length - 1]!)?.a ?? 1) === 1 ? layers.pop()! : themeRole(theme, 'canvas')
  if (!base) return null
  for (const layer of layers.reverse()) base = blend(layer, base) ?? base
  return { color: base, chosen }
}

/** The text colour of a node at a breakpoint: set on it or around it, else the theme's default for it. */
function textColorAt(element: StyledNode, chain: StyledNode[], bp: Breakpoint, theme: PageCheckInput['theme'], fallbackRole: string): Paint | null {
  for (const node of [element, ...chain]) {
    const value = resolveStyleValue(node.style ?? {}, bp, ['color']).value
    if (value !== undefined) return { color: resolveColor(theme, value), chosen: true }
  }
  return { color: themeRole(theme, fallbackRole), chosen: false }
}

const BUTTON_PAINT: Record<string, { fg: string; bg: string | null }> = {
  primary: { fg: 'primary_foreground', bg: 'primary' },
  accent: { fg: 'accent_foreground', bg: 'accent' },
  outline: { fg: 'heading', bg: null },
  link: { fg: 'link', bg: null },
}

function checkContrast(element: StyledNode, place: Place, theme: PageCheckInput['theme'], out: Collector): void {
  if (!theme || !TEXT_TYPES.has(element.type)) return
  const p = isObj(element.props) ? element.props : {}
  const button = element.type === 'button' ? (BUTTON_PAINT[str(p.variant)] ?? BUTTON_PAINT.primary!) : null
  for (const bp of BREAKPOINTS) {
    let bg: Paint | null
    let fg: Paint | null
    if (button?.bg) {
      // A filled button: its own colours unless the style sets others.
      const own = backgroundAt([element], bp, theme)
      bg = own?.chosen ? own : { color: themeRole(theme, button.bg), chosen: false }
      fg = textColorAt(element, [], bp, theme, button.fg)
    } else {
      bg = backgroundAt([element, ...place.chain], bp, theme)
      fg = textColorAt(element, place.chain, bp, theme, button?.fg ?? (element.type === 'heading' ? 'heading' : 'text'))
    }
    if (!bg?.color || !fg?.color) continue
    // Only what this page chose: the theme's own pairs are checked on the Theme page.
    if (!bg.chosen && !fg.chosen) continue
    const ratio = contrastRatio(blend(fg.color, bg.color) ?? fg.color, bg.color)
    if (ratio === null) continue
    const min = isLarge(element, bp) ? CHECK_LIMITS.contrastLarge : CHECK_LIMITS.contrast
    if (ratio >= min) continue
    const background = bg.color
    const roles = element.type === 'heading' ? ['heading', 'text', 'primary_foreground', 'accent_foreground'] : ['text', 'heading', 'primary_foreground', 'accent_foreground']
    const better = roles.find((role) => {
      const candidate = themeRole(theme, role)
      const r = candidate ? contrastRatio(candidate, background) : null
      return r !== null && r >= min
    })
    const where = bp === 'base' ? '' : ` ${DEVICE_WORDS[bp]}`
    out.add(
      {
        code: 'low_contrast',
        severity: 'warning',
        message: `This ${label(element.type)}’s text is hard to read on its background${where} (contrast ${ratio.toFixed(1)}:1, needs at least ${min}:1).`,
        node_id: element.id,
        field: 'color',
        fix: better
          ? { kind: 'apply', label: `Use the theme ${ROLE_WORDS[better] ?? better} colour`, node_id: element.id, action: { type: 'set-color', breakpoint: bp, color: `theme:${better}` } }
          : focus('Change the text colour', element.id, 'color', 'style'),
        details: { ratio: Number(ratio.toFixed(2)), required: min, breakpoint: bp, foreground: fg.color, background },
      },
      place,
    )
    return
  }
}

function checkPhoneText(element: StyledNode, place: Place, out: Collector): void {
  const resolved = resolveStyleValue(element.style ?? {}, 'mobile', ['typography', 'size'])
  const px = lengthPx(resolved.value)
  if (px === null || px >= CHECK_LIMITS.phoneText) return
  out.add(
    {
      code: 'small_phone_text',
      severity: 'warning',
      message: `This ${label(element.type)}’s text is ${Math.round(px * 10) / 10} px on phones; text under ${CHECK_LIMITS.phoneText} px is hard to read on a small screen.`,
      node_id: element.id,
      field: 'typography.size',
      fix: { kind: 'apply', label: `Make it ${CHECK_LIMITS.phoneText} px on phones`, node_id: element.id, action: { type: 'set-text-size', breakpoint: 'mobile', size: `${CHECK_LIMITS.phoneText}px` } },
      details: { size: px },
    },
    place,
  )
}

function checkPictures(element: StyledNode, place: Place, input: PageCheckInput, out: Collector): void {
  const container = input.theme?.container_width ?? 1280
  const slot = (place.wide ? 1920 : container) * place.fraction
  for (const picture of pictures(element, slot)) {
    const media = input.media[picture.media_id]
    const libraryAlt = ALT_FALLS_BACK.has(element.type) ? (media?.alt ?? '') : ''
    if (picture.altField && (picture.alt ?? '').trim() === '' && libraryAlt.trim() === '') {
      out.add(
        {
          code: 'missing_alt',
          severity: picture.linked ? 'error' : 'warning',
          message: picture.linked
            ? `A linked picture in this ${label(element.type)} has no description, so screen readers can’t say where the link goes.`
            : `A picture in this ${label(element.type)} has no description (alt text) for screen readers and search engines.`,
          node_id: element.id,
          field: picture.altField,
          fix: focus('Add description', element.id, picture.altField),
        },
        place,
      )
    }
    if (!media) continue
    const wide = (media.width ?? 0) > CHECK_LIMITS.imageWidth
    const heavy = (media.size ?? 0) > CHECK_LIMITS.imageBytes
    if ((wide || heavy) && picture.slot < CHECK_LIMITS.smallSlot) {
      const facts = [wide ? `${media.width} px wide` : null, heavy && media.size ? megabytes(media.size) : null].filter(Boolean).join(', ')
      out.add(
        {
          code: 'image_too_big',
          severity: 'tip',
          message: `A picture in this ${label(element.type)} is ${facts} but shows at most about ${Math.round(picture.slot)} px wide here. A smaller copy (under ${CHECK_LIMITS.imageWidth} px and 1 MB) makes the page load faster, especially on phones.`,
          node_id: element.id,
          field: picture.field,
          fix: focus('Choose a smaller picture', element.id, picture.field),
          details: { media_id: picture.media_id, width: media.width ?? null, size: media.size ?? null, slot: Math.round(picture.slot) },
        },
        place,
      )
    }
  }
}

function checkLinks(element: StyledNode, place: Place, out: Collector): void {
  for (const link of links(element)) {
    if (link.textField && link.text !== null && link.text.trim() === '') {
      out.add(
        {
          code: link.what === 'button' ? 'button_no_text' : 'link_no_text',
          severity: link.what === 'button' ? 'error' : 'warning',
          message: link.what === 'button' ? `A button in this ${label(element.type)} has no text, so shoppers don’t know what it does.` : `This ${label(element.type)} is a link without words, so screen readers can’t say where it goes.`,
          node_id: element.id,
          field: link.textField,
          fix: focus(link.what === 'button' ? 'Add button text' : 'Add a label', element.id, link.textField),
        },
        place,
      )
    }
    if (link.url === null) continue
    if (link.url.trim() === '' || safeUrl(link.url) === null) {
      const empty = link.url.trim() === ''
      out.add(
        {
          code: empty ? 'link_empty' : 'link_invalid',
          severity: 'error',
          message: empty
            ? `A ${link.what} in this ${label(element.type)} doesn’t lead anywhere yet.`
            : `A ${link.what} in this ${label(element.type)} has an address that won’t work (“${link.url}”). Use a page of the store such as /shop, or a full https:// address.`,
          node_id: element.id,
          field: link.field,
          fix: focus('Choose where it leads', element.id, link.field),
        },
        place,
      )
    }
  }
  for (const { field, html } of htmlFields(element)) {
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1] ?? '')
      const url = (href?.[1] ?? href?.[2] ?? '').trim()
      if (!safeTextLink(url)) {
        out.add(
          {
            code: url === '' ? 'text_link_empty' : 'text_link_invalid',
            severity: 'warning',
            message: url === '' ? `A link in this ${label(element.type)}’s text doesn’t lead anywhere.` : `A link in this ${label(element.type)}’s text has an address that won’t work (“${url}”).`,
            node_id: element.id,
            field,
            fix: focus('Fix the link', element.id, field),
          },
          place,
        )
      } else if (plainText(match[2] ?? '') === '') {
        out.add(
          { code: 'text_link_no_text', severity: 'warning', message: `A link in this ${label(element.type)}’s text has no words to click.`, node_id: element.id, field, fix: focus('Fix the link', element.id, field) },
          place,
        )
      }
    }
  }
}

/* ----------------------------------------------------------------------------------------------
 * Headings
 * -------------------------------------------------------------------------------------------- */

type HeadingRef = { level: number; node: StyledNode; place: Place; field: string; element: boolean }

function headingsOf(element: StyledNode, place: Place): HeadingRef[] {
  const p = isObj(element.props) ? element.props : {}
  if (element.type === 'heading') {
    const level = typeof p.level === 'number' && p.level >= 1 && p.level <= 6 ? p.level : 2
    return [{ level, node: element, place, field: 'level', element: true }]
  }
  if (element.type === 'text') {
    return [...str(p.html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].filter((m) => plainText(m[2] ?? '') !== '').map((m) => ({ level: Number(m[1]), node: element, place, field: 'html', element: false }))
  }
  return []
}

function checkHeadings(headings: HeadingRef[], context: DocumentContext, out: Collector): void {
  const page = context === 'page' || context === 'cms'
  const ones = headings.filter((h) => h.level === 1)
  if (page && headings.length > 0 && ones.length === 0) {
    const first = headings[0]!
    out.add(
      {
        code: 'no_h1',
        severity: 'warning',
        message: 'The page has no main heading (level 1). Search engines and screen readers use it to understand what the page is about.',
        node_id: first.node.id,
        field: first.field,
        fix: first.element ? { kind: 'apply', label: 'Make this the main heading', node_id: first.node.id, action: { type: 'set-heading-level', level: 1 } } : focus('Edit the heading', first.node.id, first.field),
      },
      first.place,
    )
  }
  const extra = page ? ones.slice(1) : ones
  for (const h of extra) {
    out.add(
      {
        code: 'extra_h1',
        severity: 'warning',
        message: page ? 'The page has more than one main heading (level 1). Keep one and make the others level 2.' : 'This part of the store sits on pages that already have a main heading (level 1); use level 2 or lower here.',
        node_id: h.node.id,
        field: h.field,
        fix: h.element ? { kind: 'apply', label: 'Make it level 2', node_id: h.node.id, action: { type: 'set-heading-level', level: 2 } } : focus('Edit the heading', h.node.id, h.field),
      },
      h.place,
    )
  }
  let previous = 1
  for (const h of headings) {
    if (h.level > previous + 1) {
      const level = (previous + 1) as 2 | 3 | 4 | 5 | 6
      out.add(
        {
          code: 'heading_skipped',
          severity: 'warning',
          message: `A level ${h.level} heading follows level ${previous}; levels shouldn’t be skipped, so the page outline stays clear.`,
          node_id: h.node.id,
          field: h.field,
          fix: h.element ? { kind: 'apply', label: `Make it level ${level}`, node_id: h.node.id, action: { type: 'set-heading-level', level } } : focus('Edit the heading', h.node.id, h.field),
          details: { level: h.level, previous },
        },
        h.place,
      )
    }
    previous = h.level
  }
}

/* ----------------------------------------------------------------------------------------------
 * The check
 * -------------------------------------------------------------------------------------------- */

function checkHiddenEverywhere(node: StyledNode & { visibility?: Partial<Record<string, boolean>> }, place: Place | null, out: Collector): void {
  if (visibleAnywhere(node)) return
  out.add(
    {
      code: 'hidden_everywhere',
      severity: 'warning',
      message: `This ${label(node.type)} is hidden on computers, tablets and phones, so nobody sees it. Show it on at least one device, or delete it.`,
      node_id: node.id,
      field: 'visibility',
      fix: { kind: 'apply', label: 'Show it on all devices', node_id: node.id, action: { type: 'show-on-all-devices' } },
    },
    place,
  )
}

function checkEmptyText(element: StyledNode, place: Place, out: Collector): void {
  const p = isObj(element.props) ? element.props : {}
  if (element.type === 'heading' && str(p.text).trim() === '') {
    out.add({ code: 'heading_empty', severity: 'warning', message: 'This heading has no text.', node_id: element.id, field: 'text', fix: focus('Write the heading', element.id, 'text') }, place)
  }
  if (element.type === 'text' && plainText(str(p.html)) === '' && !/<img\b/i.test(str(p.html))) {
    out.add({ code: 'text_empty', severity: 'tip', message: 'This text block is empty. Write something or delete it.', node_id: element.id, field: 'html', fix: focus('Write the text', element.id, 'html') }, place)
  }
}

/** Runs every client check over the draft (see the file comment); issues in page order, page-wide ones first. */
export function runPageCheck(input: PageCheckInput): PageCheckIssue[] {
  const out = new Collector()
  const key = input.document.key ?? ''
  const context = input.document.kind === 'popup' ? 'popup' : documentContext(key)
  const headings: HeadingRef[] = []

  // Page SEO (home, landing and CMS pages).
  if (hasSeo(input.document)) {
    const seo = readSeo(input.content)
    if (seo.description.trim() === '') {
      out.add(
        {
          code: 'seo_description_missing',
          severity: 'warning',
          message: 'The page has no search description. Google shows it under the page title, and Facebook and WhatsApp show it with shared links.',
          node_id: null,
          field: 'seo.description',
          fix: focus('Add description', null, 'seo.description'),
        },
        null,
      )
    }
    if (seo.title.trim() === '') {
      out.add(
        { code: 'seo_title_missing', severity: 'tip', message: 'The page has no search title, so the page name is used. A title that says what you sell helps people find the page.', node_id: null, field: 'seo.title', fix: focus('Add title', null, 'seo.title') },
        null,
      )
    }
  }

  const visitElements = (column: Column, place: Place) => {
    for (const element of column.elements as unknown as (StyledNode & { hidden?: boolean; visibility?: Partial<Record<string, boolean>>; columns?: Column[] })[]) {
      if (element.hidden === true) continue
      checkHiddenEverywhere(element, place, out)
      if (!visibleAnywhere(element)) continue
      if (element.type === 'inner_row') {
        const inner = element.columns ?? []
        for (const child of inner) {
          const width = typeof child.width?.base === 'number' ? child.width.base / 100 : 1
          visitElements(child as Column, { ...place, chain: [child as unknown as StyledNode, element, ...place.chain], fraction: place.fraction * width })
        }
        continue
      }
      checkEmptyText(element, place, out)
      headings.push(...headingsOf(element, place))
      checkPictures(element, place, input, out)
      checkLinks(element, place, out)
      checkContrast(element, place, input.theme, out)
      checkPhoneText(element, place, out)
    }
  }

  for (const raw of input.content.sections as unknown as Obj[]) {
    const id = str(raw.id)
    const global = isObj(raw.global) ? raw.global : null
    if (raw.type === 'global_section') {
      if (raw.state === 'unavailable' && raw.hidden !== true) {
        out.add(
          {
            code: 'global_unavailable',
            severity: 'error',
            message: `The global section${global && global.title ? ` “${str(global.title)}”` : ''} can’t be shown here (it was deleted or is made for another part of the store). Remove it from the page.`,
            node_id: id,
            field: null,
            fix: focus('Select it', id, null),
          },
          null,
        )
      }
      continue
    }
    if (raw.type !== 'section' || raw.hidden === true) continue
    const section = raw as unknown as StyledNode & { visibility?: Partial<Record<string, boolean>>; columns: Column[] }
    const owner = global ? id : null
    const sectionPlace: Place = { chain: [section], fraction: 1, wide: isObj(section.props) && section.props.layout !== 'boxed', owner, ownerTitle: global ? str(global.title) || null : null }
    // A global section's own settings are changed in the global; report on the reference without the ownership note for the section itself.
    checkHiddenEverywhere(section, owner ? null : sectionPlace, out)
    if (!visibleAnywhere(section)) continue
    const columns = Array.isArray(section.columns) ? section.columns : []
    const empty = columns.every((column) => (column.elements ?? []).length === 0)
    if (empty) {
      out.add({ code: 'empty_section', severity: 'warning', message: 'This section is empty. Add something to it, or delete it.', node_id: id, field: null, fix: focus('Select the section', id, null) }, owner ? null : sectionPlace)
    }
    for (const column of columns) {
      const width = typeof column.width?.base === 'number' ? column.width.base / 100 : 1
      visitElements(column, { ...sectionPlace, chain: [column as unknown as StyledNode, section], fraction: width })
    }
  }

  checkHeadings(headings, context, out)
  checkStorePage(input, out)
  return sortIssues([...out.issues, ...runSpeedCheck(input).issues, ...runMotionCheck(input)], nodeOrder(input.content))
}

/**
 * B14: a store page design holds its main part exactly once (the server refuses to publish it
 * without, and to save it twice). Codes as the server's check, so its issues merge with these.
 */
function checkStorePage(input: PageCheckInput, out: Collector): void {
  if ((input.document.kind ?? 'page') !== 'page') return
  const template = templateKeyOf(input.document.key ?? '')
  if (!template) return
  const type = coreElementOf(template)
  const name = CORE_NAMES[type] ?? 'its main part'
  const found = elementsOfTypeWithState(input.content, type)
  const ids = found.map((e) => e.id)
  if (ids.length === 1 && found[0]!.hidden) {
    // Hidden with the eye: shoppers would get a page without it (the server counts it as missing).
    const id = ids[0]!
    out.add(
      {
        code: 'TEMPLATE_CORE_MISSING',
        severity: 'error',
        message: `The main part of this store page, ${name}, is hidden, so shoppers wouldn’t see it. Show it again (the eye in Layers).`,
        node_id: id,
        field: null,
        fix: focus('Select it', id, null),
        details: { element: type, hidden: true },
      },
      null,
    )
    return
  }
  if (ids.length === 0) {
    out.add(
      {
        code: 'TEMPLATE_CORE_MISSING',
        severity: 'error',
        message: `This store page needs its main part: ${name}. Without it the page can’t be published. Add it, then design around it.`,
        node_id: null,
        field: null,
        fix: { kind: 'insert', label: 'Add it', type },
        details: { element: type },
      },
      null,
    )
    return
  }
  for (const id of ids.slice(1)) {
    out.add(
      {
        code: 'TEMPLATE_CORE_DUPLICATE',
        severity: 'error',
        message: `This store page has ${name} more than once. Keep one and delete the others.`,
        node_id: id,
        field: null,
        fix: focus('Select it', id, null),
        details: { element: type },
      },
      null,
    )
  }
}

/* ----------------------------------------------------------------------------------------------
 * Order, merge, counts
 * -------------------------------------------------------------------------------------------- */

/** Every node id of the content in page order (sections, columns, elements, inner rows). */
export function nodeOrder(content: BuilderContent): Map<string, number> {
  const order = new Map<string, number>()
  const add = (id: unknown) => {
    if (typeof id === 'string' && !order.has(id)) order.set(id, order.size)
  }
  const columns = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const column of list as Obj[]) {
      add(column.id)
      for (const element of (Array.isArray(column.elements) ? column.elements : []) as Obj[]) {
        add(element.id)
        columns(element.columns)
      }
    }
  }
  for (const section of content.sections as unknown as Obj[]) {
    add(section.id)
    columns(section.columns)
  }
  return order
}

/** By severity, then page-wide issues, then page order (unknown nodes last); stable. */
export function sortIssues(issues: PageCheckIssue[], order: Map<string, number>): PageCheckIssue[] {
  const position = (issue: PageCheckIssue) => (issue.node_id === null ? -1 : (order.get(issue.node_id) ?? Number.MAX_SAFE_INTEGER))
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || position(a.issue) - position(b.issue) || a.index - b.index)
    .map(({ issue }) => issue)
}

const SEVERITIES = new Set<PageCheckSeverity>(['error', 'warning', 'tip'])

/**
 * A server `details.field` (node-relative: `props.link.url`, `props.images.2.alt`; page-wide:
 * `seo.image.media_id`) as the inspector's form key (`link`, `images.2.alt`, `seo.image`).
 */
export function serverFieldKey(field: string | null): string | null {
  if (!field) return null
  if (field.startsWith('seo.')) return field.split('.').slice(0, 2).join('.')
  const prop = field.startsWith('props.') ? field.slice(6) : field
  if (prop === '') return null
  // B18: the Text effect form is one field.
  if (prop === 'text_effect' || prop.startsWith('text_effect.')) return 'text_effect'
  return prop.replace(/(^|\.)link\.url$/, '$1link').replace(/(^|\.)image\.media_id$/, '$1image')
}

/** A server issue as a check issue: Fix it selects its node and focuses the field (page-wide SEO issues: the SEO field). */
export function fromServerIssue(issue: ServerCheckIssue): PageCheckIssue {
  const severity: PageCheckSeverity = SEVERITIES.has(issue.severity) ? issue.severity : 'warning'
  const details = isObj(issue.details) ? issue.details : {}
  const raw = typeof details.field === 'string' ? details.field : typeof details.path === 'string' && issue.node_id === null ? details.path : null
  const field = serverFieldKey(raw)
  const fix: PageCheckFix | null = issue.node_id && details.fix === 'remove_entrance'
    ? // B18 MOTION_LCP: the entrance can be removed right away.
      { kind: 'apply', label: 'Remove animation', node_id: issue.node_id, action: { type: 'remove-entrance' } }
    : issue.node_id
    ? focus(field ? 'Fix it' : 'Select it', issue.node_id, field)
    : field?.startsWith('seo.')
      ? focus('Fix it', null, field)
      : null
  return {
    key: `server:${issue.code}:${issue.node_id ?? ''}:${field ?? ''}`,
    code: issue.code,
    severity,
    message: issue.message,
    node_id: issue.node_id,
    field,
    source: 'server',
    fix,
    details,
  }
}

/**
 * The client issues plus the server's (same code on the same node once), sorted. `content` gives
 * the page order of the server's nodes (else they follow the client issues of their severity).
 */
export function mergeCheckIssues(client: PageCheckIssue[], server: ServerCheckIssue[], content?: BuilderContent): PageCheckIssue[] {
  const seen = new Set(client.map((issue) => `${issue.code}:${issue.node_id ?? ''}`))
  const extra = server.filter((issue) => !seen.has(`${issue.code}:${issue.node_id ?? ''}`)).map(fromServerIssue)
  const unique = [...new Map([...client, ...extra].map((issue) => [issue.key, issue])).values()]
  return sortIssues(unique, content ? nodeOrder(content) : new Map())
}

export type CheckCounts = { errors: number; warnings: number; tips: number; total: number }

export function checkCounts(issues: readonly PageCheckIssue[]): CheckCounts {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const tips = issues.filter((i) => i.severity === 'tip').length
  return { errors, warnings, tips, total: issues.length }
}

/** "2 errors, 1 warning" (tips left out; "No problems found" when there are none). */
export function countsText(counts: CheckCounts): string {
  const parts: string[] = []
  if (counts.errors) parts.push(`${counts.errors} ${counts.errors === 1 ? 'error' : 'errors'}`)
  if (counts.warnings) parts.push(`${counts.warnings} ${counts.warnings === 1 ? 'warning' : 'warnings'}`)
  if (parts.length === 0) return counts.tips ? `No problems found, ${counts.tips} ${counts.tips === 1 ? 'tip' : 'tips'}` : 'No problems found'
  return parts.join(', ')
}

export function groupBySeverity(issues: readonly PageCheckIssue[]): { severity: PageCheckSeverity; label: string; issues: PageCheckIssue[] }[] {
  return (['error', 'warning', 'tip'] as const).map((severity) => ({ severity, label: SEVERITY_LABELS[severity], issues: issues.filter((i) => i.severity === severity) })).filter((g) => g.issues.length > 0)
}
