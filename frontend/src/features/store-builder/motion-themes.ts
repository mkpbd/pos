/*
 * B18 §4 motion themes, pure part. A theme maps the parts of a page (roles) to motion: sections
 * (entrance, easing, the elements inside one after another), headings, texts, buttons (hover, a
 * Festive shine loop), pictures, product listings (card hover) and section dividers. Applying one
 * returns new content (one undo step for the caller) with `motion_theme` set; "Remove all motion"
 * takes every animation off the page.
 *
 * Rules (contract §4 + the server's page check):
 * - LCP: the first section shown (on any device, in its own order) and its pictures / headings
 *   never get an entrance — the top of the page paints at once, without a fade (MOTION_LCP).
 *   A first section that is a global section reference is not this document's to change.
 * - "Keep my own animations" (default on): a node that already moves is left alone. Motion the
 *   last applied theme (`motion_theme`) put there is not "own", so themes can be switched.
 * - Idempotent: applying the same theme twice changes nothing the second time.
 * - Loops stay under the page check's limits: at most 6 looping nodes per section; themes never
 *   loop forever (Festive's button shine plays 3 times).
 * - B19: Lively, Festive and Premium give the sections below the first a subtle scroll effect
 *   (`style.base.scroll`: rise, or a reveal for Premium) — never the first section shown
 *   (SCROLL_EFFECT_TOP). A scroll effect counts as the node's own motion like any other.
 */

import { applyOrder, DEVICE_ORDER_ROOT, deviceOrderList } from '@/storefront/builder/device-order'
import type { BuilderContent, Device, MotionEasing, MotionTheme, ScrollStyle } from '@/storefront/builder/types'

export type MotionThemeId = MotionTheme
/** A theme, or `none` = "Remove all motion". */
export type MotionThemeChoice = MotionThemeId | 'none'

export const MOTION_THEME_IDS: readonly MotionThemeId[] = ['calm', 'lively', 'festive', 'premium', 'minimal']

export const MOTION_THEME_INFO: Record<MotionThemeChoice, { name: string; description: string }> = {
  calm: { name: 'Calm', description: 'Everything fades in softly. Buttons lift a little when pointed at.' },
  lively: { name: 'Lively', description: 'Parts slide up with a light spring, the main heading appears word by word, sections rise as you scroll, dividers flow.' },
  festive: { name: 'Festive', description: 'Bouncy headings, buttons that pop and shine, sections that rise as you scroll, flowing dividers — for sales and holidays.' },
  premium: { name: 'Premium', description: 'Slow, elegant wipes for headings and pictures, sections revealed as you scroll; products zoom gently.' },
  minimal: { name: 'Minimal', description: 'Sections simply fade in. Nothing else moves.' },
  none: { name: 'Remove all motion', description: 'Takes every animation off this page, also the ones you set yourself.' },
}

/** Roles a node plays in a theme. */
type Role = 'section' | 'heading' | 'text' | 'image' | 'button' | 'listing' | 'other'

/** Elements whose picture can be the page's main (LCP) picture (server: image, hero_slider, image_carousel). */
export const LCP_PICTURE_TYPES: ReadonlySet<string> = new Set(['image', 'hero_slider', 'image_carousel', 'gallery', 'video', 'before_after', 'shop_the_look', 'category_card'])
/** Heading-like elements (server: heading, cta). */
export const LCP_HEADING_TYPES: ReadonlySet<string> = new Set(['heading', 'cta'])
/** B18 card hover (`props.card_hover`). */
export const CARD_HOVER_TYPES: ReadonlySet<string> = new Set(['product_grid', 'product_carousel', 'product_tabs', 'product_listing', 'category_card', 'product_spotlight', 'shop_the_look'])
/** B18 text effects (`props.text_effect`). */
export const TEXT_EFFECT_TYPES: ReadonlySet<string> = new Set(['heading', 'text', 'cta'])

/** At most this many looping nodes in one section (page check MOTION_TOO_MUCH). */
export const MAX_LOOPS_PER_SECTION = 6

const ROLE_OF: Record<string, Role> = {
  heading: 'heading',
  cta: 'heading',
  text: 'text',
  rich_text: 'text',
  image: 'image',
  image_carousel: 'image',
  gallery: 'image',
  video: 'image',
  before_after: 'image',
  button: 'button',
}

function roleOf(type: string): Role {
  if (type === 'section') return 'section'
  if (CARD_HOVER_TYPES.has(type)) return 'listing'
  return ROLE_OF[type] ?? 'other'
}

type Entrance = { entrance: string; duration: number; easing?: MotionEasing }
type ThemeSpec = {
  /** B19 `scroll`: the sections below the first (never the lead section). */
  section: { entrance?: Entrance; stagger?: number; easing?: MotionEasing; scroll?: ScrollStyle }
  heading?: Entrance
  text?: Entrance
  image?: Entrance
  button: { hover?: string; loop?: string }
  card_hover?: string
  divider?: 'flow' | 'drift' | 'pulse'
  /** A text effect for the page's first (hero) heading. */
  hero_text?: 'reveal_words'
}

export const THEME_SPECS: Record<MotionThemeId, ThemeSpec> = {
  calm: {
    section: { entrance: { entrance: 'fade', duration: 800, easing: 'gentle' }, stagger: 80, easing: 'gentle' },
    heading: { entrance: 'fade', duration: 800, easing: 'gentle' },
    text: { entrance: 'fade', duration: 800, easing: 'gentle' },
    image: { entrance: 'fade', duration: 900, easing: 'gentle' },
    button: { hover: 'lift-shadow' },
    card_hover: 'lift',
  },
  lively: {
    section: { stagger: 100, easing: 'spring', scroll: { effect: 'rise', intensity: 'subtle' } },
    heading: { entrance: 'slide-up', duration: 600, easing: 'spring' },
    text: { entrance: 'slide-up', duration: 600, easing: 'spring' },
    image: { entrance: 'zoom', duration: 700, easing: 'spring' },
    button: { hover: 'pop' },
    card_hover: 'tilt_3d',
    divider: 'flow',
    hero_text: 'reveal_words',
  },
  festive: {
    section: { stagger: 120, easing: 'bounce', scroll: { effect: 'rise', intensity: 'subtle' } },
    heading: { entrance: 'bounce-in', duration: 800, easing: 'bounce' },
    text: { entrance: 'slide-up', duration: 600, easing: 'spring' },
    image: { entrance: 'zoom', duration: 700, easing: 'spring' },
    button: { hover: 'pop', loop: 'shine' },
    card_hover: 'glare',
    divider: 'flow',
    hero_text: 'reveal_words',
  },
  premium: {
    section: { entrance: { entrance: 'fade', duration: 1000 }, stagger: 120, scroll: { effect: 'reveal_up', intensity: 'subtle' } },
    heading: { entrance: 'mask-up', duration: 900 },
    text: { entrance: 'fade', duration: 900 },
    image: { entrance: 'mask-up', duration: 1000 },
    button: { hover: 'lift-shadow' },
    card_hover: 'zoom_image',
  },
  minimal: {
    section: { entrance: { entrance: 'fade', duration: 500, easing: 'snappy' } },
    button: {},
    card_hover: 'lift',
  },
}

/* ----------------------------------------------------------------------------------------------
 * A node's motion settings ("aspects") and their canonical form
 * -------------------------------------------------------------------------------------------- */

type Obj = Record<string, unknown>

/** Everything that makes a node move. Absent = none. */
export type MotionAspects = {
  motion?: Obj
  hover?: Obj
  /** B19 `style.base.scroll`. */
  scroll?: Obj
  text_effect?: Obj
  card_hover?: string
  shape_top?: string
  shape_bottom?: string
}

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback)

function baseStyle(node: Obj): Obj {
  const style = isObj(node.style) ? node.style : {}
  return isObj(style.base) ? style.base : {}
}

function props(node: Obj): Obj {
  return isObj(node.props) ? node.props : {}
}

export function readAspects(node: Obj): MotionAspects {
  const base = baseStyle(node)
  const p = props(node)
  const out: MotionAspects = {}
  if (isObj(base.motion)) out.motion = base.motion
  if (isObj(base.hover)) out.hover = base.hover
  if (isObj(base.scroll)) out.scroll = base.scroll
  if (isObj(p.text_effect)) out.text_effect = p.text_effect
  if (typeof p.card_hover === 'string') out.card_hover = p.card_hover
  if (node.type === 'section') {
    if (isObj(p.shape_top) && typeof p.shape_top.animate === 'string') out.shape_top = p.shape_top.animate
    if (isObj(p.shape_bottom) && typeof p.shape_bottom.animate === 'string') out.shape_bottom = p.shape_bottom.animate
  }
  return out
}

/** Defaults filled in, "none"s dropped: two aspects that behave the same compare equal. */
function canonicalAspects(a: MotionAspects): Obj {
  const out: Obj = {}
  if (a.motion) {
    const m = a.motion
    const entrance = str(m.entrance, 'none')
    const loop = str(m.loop, 'none')
    const stagger = num(m.stagger_children, 0)
    if (entrance !== 'none' || loop !== 'none' || stagger > 0) {
      const entering = entrance !== 'none'
      out.motion = {
        entrance,
        duration: entering ? num(m.duration, 600) : null,
        delay: entering ? num(m.delay, 0) : null,
        repeat: entering || stagger > 0 ? str(m.repeat, 'once') : null,
        stagger,
        loop,
        loop_forever: loop !== 'none' && m.loop_forever === true,
        easing: entering || stagger > 0 ? str(m.easing, 'smooth') : null,
      }
    }
  }
  if (a.hover && str(a.hover.effect, 'none') !== 'none') out.hover = { effect: a.hover.effect, duration: num(a.hover.duration, 250) }
  if (a.scroll && str(a.scroll.effect, 'none') !== 'none') out.scroll = { effect: a.scroll.effect, intensity: str(a.scroll.intensity, 'medium'), range: str(a.scroll.range, 'enter') }
  if (a.text_effect && str(a.text_effect.type, 'none') !== 'none') {
    const t = a.text_effect
    out.text_effect = {
      type: t.type,
      words: Array.isArray(t.words) ? t.words : null,
      speed: str(t.speed, 'normal'),
      color_role: str(t.color_role, ''),
      cycles: t.cycles === undefined ? 'default' : t.cycles,
    }
  }
  if (a.card_hover && a.card_hover !== 'none') out.card_hover = a.card_hover
  if (a.shape_top && a.shape_top !== 'none') out.shape_top = a.shape_top
  if (a.shape_bottom && a.shape_bottom !== 'none') out.shape_bottom = a.shape_bottom
  return out
}

/** Stable JSON (sorted keys). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObj(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function aspectsKey(a: MotionAspects): string {
  return stable(canonicalAspects(a))
}

/** Whether the node moves at all (entrance, loop, stagger, hover, text effect, card hover, animated divider). */
export function hasMotion(node: Obj): boolean {
  return Object.keys(canonicalAspects(readAspects(node))).length > 0
}

function loops(node: Obj): boolean {
  const motion = baseStyle(node).motion
  return isObj(motion) && str(motion.loop, 'none') !== 'none'
}

/* ----------------------------------------------------------------------------------------------
 * Where a node is: the LCP section, the hero heading
 * -------------------------------------------------------------------------------------------- */

const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile']

function shownOn(node: Obj, device: Device): boolean {
  if (node.hidden === true) return false
  return !isObj(node.visibility) || node.visibility[device] !== false
}

/** The first section shown on each device (in that device's order); global section references count but are not returned. */
export function leadSectionIds(content: BuilderContent): Set<string> {
  const ids = new Set<string>()
  for (const device of DEVICES) {
    const ordered = applyOrder(content.sections as unknown as Obj[], deviceOrderList(content.device_order, device, DEVICE_ORDER_ROOT))
    const first = ordered.find((section) => shownOn(section, device))
    if (first && first.type === 'section' && typeof first.id === 'string') ids.add(first.id)
  }
  return ids
}

type Visit = (node: Obj, sectionId: string) => void

function visitColumns(columns: unknown, sectionId: string, visit: Visit) {
  if (!Array.isArray(columns)) return
  for (const column of columns as Obj[]) {
    if (!isObj(column)) continue
    visit(column, sectionId)
    if (!Array.isArray(column.elements)) continue
    for (const element of column.elements as Obj[]) {
      if (!isObj(element)) continue
      visit(element, sectionId)
      if (element.type === 'inner_row') visitColumns(element.columns, sectionId, visit)
    }
  }
}

/** Every section, column and element in reading (document) order; global section references are skipped. */
function eachNode(content: BuilderContent, visit: Visit) {
  for (const section of content.sections as unknown as Obj[]) {
    if (!isObj(section) || section.type !== 'section' || typeof section.id !== 'string') continue
    visit(section, section.id)
    visitColumns(section.columns, section.id, visit)
  }
}

function sectionHasPicture(section: Obj): boolean {
  const background = baseStyle(section).background
  if (isObj(background) && (isObj(background.image) || isObj(background.video))) return true
  let found = false
  visitColumns(section.columns, '', (node) => {
    if (typeof node.type === 'string' && LCP_PICTURE_TYPES.has(node.type)) found = true
  })
  return found
}

/**
 * The page's first heading (reading order, shown sections) that may get the hero text effect, or
 * null. When it sits in the lead section and nothing there is a picture, it is probably the
 * page's largest paint itself: it is left still.
 */
export function heroHeadingId(content: BuilderContent, lead: ReadonlySet<string> = leadSectionIds(content)): string | null {
  for (const section of content.sections as unknown as Obj[]) {
    if (!isObj(section) || section.type !== 'section' || section.hidden === true) continue
    let heading: Obj | null = null
    visitColumns(section.columns, '', (node) => {
      if (!heading && node.type === 'heading' && node.hidden !== true) heading = node
    })
    if (!heading) continue
    if (lead.has(section.id as string) && !sectionHasPicture(section)) return null
    return (heading as Obj).id as string
  }
  return null
}

/* ----------------------------------------------------------------------------------------------
 * A theme's motion for one node
 * -------------------------------------------------------------------------------------------- */

export type NodeContext = {
  /** In (or is) the first section shown: no entrances on it, its pictures or its headings. */
  lead: boolean
  /** The page's hero heading (gets the theme's text effect). */
  hero: boolean
  /** A loop may be added (the section has room under MAX_LOOPS_PER_SECTION). */
  loopOk: boolean
}

function entranceMotion(entrance: Entrance | undefined): Obj | undefined {
  if (!entrance) return undefined
  const motion: Obj = { entrance: entrance.entrance, duration: entrance.duration, delay: 0 }
  if (entrance.easing && entrance.easing !== 'smooth') motion.easing = entrance.easing
  return motion
}

/** What `theme` gives a node of `type` (empty = no motion). */
export function themeAspects(theme: MotionThemeId, type: string, ctx: NodeContext, node?: Obj): MotionAspects {
  const spec = THEME_SPECS[theme]
  const role = roleOf(type)
  const out: MotionAspects = {}
  // The top of the page paints at once: no entrance on the lead section, its pictures or headings.
  const still = ctx.lead && (role === 'section' || LCP_PICTURE_TYPES.has(type) || LCP_HEADING_TYPES.has(type))
  switch (role) {
    case 'section': {
      const motion: Obj = (!still && entranceMotion(spec.section.entrance)) || { entrance: 'none' }
      const stagger = spec.section.stagger ?? 0
      if (stagger > 0) motion.stagger_children = stagger
      const entering = motion.entrance !== 'none'
      if (!entering && stagger > 0 && spec.section.easing && spec.section.easing !== 'smooth') motion.easing = spec.section.easing
      if (entering || stagger > 0) out.motion = motion
      // B19: a scroll effect on the sections below the first only (the top paints at once).
      if (!still && spec.section.scroll) out.scroll = { ...spec.section.scroll }
      if (spec.divider && node) {
        const p = props(node)
        if (isObj(p.shape_top)) out.shape_top = spec.divider
        if (isObj(p.shape_bottom)) out.shape_bottom = spec.divider
      }
      break
    }
    case 'heading':
    case 'text':
    case 'image': {
      const motion = still ? undefined : entranceMotion(spec[role])
      if (motion) out.motion = motion
      if (role === 'heading' && type === 'heading' && ctx.hero && spec.hero_text) out.text_effect = { type: spec.hero_text }
      break
    }
    case 'button':
      if (spec.button.hover) out.hover = { effect: spec.button.hover }
      if (spec.button.loop && ctx.loopOk) out.motion = { entrance: 'none', loop: spec.button.loop }
      break
    case 'listing':
      if (spec.card_hover) out.card_hover = spec.card_hover
      break
    case 'other':
      break
  }
  return out
}

/** Every motion `theme` could have given this node (wherever it stood), as canonical keys. */
function themeKeys(theme: MotionThemeId, node: Obj): Set<string> {
  const keys = new Set<string>()
  const type = str(node.type, '')
  for (const lead of [false, true]) for (const hero of [false, true]) for (const loopOk of [false, true]) keys.add(aspectsKey(themeAspects(theme, type, { lead, hero, loopOk }, node)))
  return keys
}

/** The node's motion is its own: it moves, and not (exactly) the way the last applied theme made it. */
export function isOwnMotion(node: Obj, previous: MotionThemeId | null): boolean {
  if (!hasMotion(node)) return false
  if (!previous) return true
  return !themeKeys(previous, node).has(aspectsKey(readAspects(node)))
}

/* ----------------------------------------------------------------------------------------------
 * Writing
 * -------------------------------------------------------------------------------------------- */

/**
 * The node with exactly these aspects (keys that don't apply to its type are left as they are).
 * `parallax` ("Remove all motion"): also the B9 background parallax and the B19 background scroll
 * and slow zoom (Ken Burns).
 */
export function withAspects(node: Obj, aspects: MotionAspects, options: { parallax?: boolean } = {}): Obj {
  if (aspectsKey(readAspects(node)) === aspectsKey(aspects) && !(options.parallax && hasParallax(node))) return node
  const type = str(node.type, '')
  const style = isObj(node.style) ? node.style : {}
  const base: Obj = { ...baseStyle(node) }
  if (aspects.motion) base.motion = aspects.motion
  else delete base.motion
  if (aspects.hover) base.hover = aspects.hover
  else delete base.hover
  if (aspects.scroll) base.scroll = aspects.scroll
  else delete base.scroll
  if (options.parallax && isObj(base.background) && 'parallax' in base.background) {
    const background = { ...base.background }
    delete background.parallax
    base.background = background
  }
  let nextProps: Obj | undefined
  const p = props(node)
  const edit = (key: string, value: unknown) => {
    nextProps ??= { ...p }
    if (value === undefined) delete nextProps[key]
    else nextProps[key] = value
  }
  if (TEXT_EFFECT_TYPES.has(type) || 'text_effect' in p) edit('text_effect', aspects.text_effect)
  if (CARD_HOVER_TYPES.has(type) || 'card_hover' in p) edit('card_hover', aspects.card_hover)
  if (options.parallax) {
    for (const key of ['background_scroll', 'ken_burns', 'ken_burns_direction']) if (key in p) edit(key, undefined)
  }
  if (type === 'section') {
    for (const key of ['shape_top', 'shape_bottom'] as const) {
      const shape = p[key]
      if (!isObj(shape)) continue
      const next: Obj = { ...shape }
      if (aspects[key]) next.animate = aspects[key]
      else delete next.animate
      edit(key, next)
    }
  }
  const next: Obj = { ...node, style: { ...style, base } }
  if (nextProps) next.props = nextProps
  return next
}

/** The B9 parallax or a B19 background scroll / slow zoom (removed by "Remove all motion" only). */
function hasParallax(node: Obj): boolean {
  const background = baseStyle(node).background
  const p = props(node)
  return (isObj(background) && 'parallax' in background) || 'background_scroll' in p || 'ken_burns' in p || 'ken_burns_direction' in p
}

/** Content with `edit` applied to every section, column and element (unchanged parts keep their identity). */
function mapNodes(content: BuilderContent, edit: (node: Obj, sectionId: string) => Obj): BuilderContent {
  const mapColumns = (columns: unknown, sectionId: string): unknown => {
    if (!Array.isArray(columns)) return columns
    let changed = false
    const next = (columns as Obj[]).map((column) => {
      if (!isObj(column)) return column
      let out = edit(column, sectionId)
      if (Array.isArray(column.elements)) {
        let elementsChanged = false
        const elements = (column.elements as Obj[]).map((element) => {
          if (!isObj(element)) return element
          let e = edit(element, sectionId)
          if (element.type === 'inner_row') {
            const inner = mapColumns(element.columns, sectionId)
            if (inner !== element.columns) e = { ...e, columns: inner }
          }
          if (e !== element) elementsChanged = true
          return e
        })
        if (elementsChanged) out = { ...out, elements }
      }
      if (out !== column) changed = true
      return out
    })
    return changed ? next : columns
  }
  let changed = false
  const sections = (content.sections as unknown as Obj[]).map((section) => {
    if (!isObj(section) || section.type !== 'section' || typeof section.id !== 'string') return section
    let out = edit(section, section.id)
    const columns = mapColumns(section.columns, section.id)
    if (columns !== section.columns) out = { ...out, columns }
    if (out !== section) changed = true
    return out
  })
  return changed ? ({ ...content, sections } as unknown as BuilderContent) : content
}

export type ApplyResult = {
  content: BuilderContent
  /** Nodes whose motion changed. */
  changed: number
  /** Nodes left alone because their motion is the owner's own ("Keep my own animations"). */
  kept: number
}

/**
 * Applies a motion theme (or `none`: removes all motion, parallax included, and the theme label).
 * `keepOwn` (default true): nodes with motion of their own are left alone.
 */
export function applyMotionTheme(content: BuilderContent, theme: MotionThemeChoice, options: { keepOwn?: boolean } = {}): ApplyResult {
  const keepOwn = options.keepOwn ?? true
  let changed = 0
  let kept = 0

  if (theme === 'none') {
    const next = mapNodes(content, (node) => {
      const out = withAspects(node, {}, { parallax: true })
      if (out !== node) changed += 1
      return out
    })
    return { content: withTheme(next, null), changed, kept }
  }

  const previous = content.motion_theme ?? null
  const lead = leadSectionIds(content)
  const hero = heroHeadingId(content, lead)
  // Own nodes are decided on the content as it is (before anything changes).
  const own = new Set<string>()
  const ownLoops = new Map<string, number>()
  if (keepOwn) {
    eachNode(content, (node, sectionId) => {
      if (typeof node.id !== 'string' || !isOwnMotion(node, previous)) return
      own.add(node.id)
      if (loops(node)) ownLoops.set(sectionId, (ownLoops.get(sectionId) ?? 0) + 1)
    })
  }
  const themeLoops = new Map<string, number>()
  const next = mapNodes(content, (node, sectionId) => {
    const id = node.id as string
    if (own.has(id)) {
      kept += 1
      return node
    }
    const type = str(node.type, '')
    const used = (ownLoops.get(sectionId) ?? 0) + (themeLoops.get(sectionId) ?? 0)
    const aspects = themeAspects(theme, type, { lead: lead.has(sectionId), hero: id === hero, loopOk: used < MAX_LOOPS_PER_SECTION }, node)
    if (aspects.motion && str(aspects.motion.loop, 'none') !== 'none') themeLoops.set(sectionId, (themeLoops.get(sectionId) ?? 0) + 1)
    const out = withAspects(node, aspects)
    if (out !== node) changed += 1
    return out
  })
  return { content: withTheme(next, theme), changed, kept }
}

function withTheme(content: BuilderContent, theme: MotionThemeId | null): BuilderContent {
  if ((content.motion_theme ?? null) === theme) return content
  const next = { ...content }
  if (theme) next.motion_theme = theme
  else delete next.motion_theme
  return next
}

/** How many nodes move on the page (for the panel's summary). */
export function movingCount(content: BuilderContent): number {
  let count = 0
  eachNode(content, (node) => {
    if (hasMotion(node)) count += 1
  })
  return count
}
