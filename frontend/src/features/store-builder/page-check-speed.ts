import { documentContext } from '@/storefront/builder/registry'
import type { Column } from '@/storefront/builder/types'
import { DEFAULT_BANGLA_BODY, DEFAULT_BANGLA_HEADING, FONT_INFO, isBuiltInFont, isCustomFontKey } from '@/storefront/fonts'
import type { CheckMedia, PageCheckFix, PageCheckInput, PageCheckIssue, PageCheckSeverity } from './page-check'
import { Collector, focus, isObj, label, list, megabytes, pictures, str, visibleAnywhere, type Obj, type Place, type StyledNode } from './page-check-core'

/*
 * B15 §4: the speed part of the page check — pure and deterministic (no network). It estimates
 * what a shopper downloads from what the editor already knows: each picture's size (the media
 * library's bytes when given, else worked out from its width × height and file type), which copy
 * the storefront serves (the smallest WebP copy in `srcset` wide enough for the slot — at least a
 * phone's 780 px — or the original when there is none; background pictures always use the
 * original), the theme's font files and rough figures for what the page loads by itself (product
 * cards, banners). Each "Speed" issue (group `speed`) costs points (`details.penalty`); the score
 * is 100 minus them (0–100), so the score and the list always agree: `speedScore(issues)`.
 */

export type SpeedRating = 'fast' | 'average' | 'slow'

export type SpeedWeight = {
  /** The pictures as uploaded (bytes). */
  original: number
  /** What a shopper downloads for the whole page: served pictures + fonts + estimates (bytes). */
  served: number
  /** The pictures of the first screen as served. */
  first_screen: number
  /** Font files. */
  fonts: number
  /** The part of `served` that is a rough figure (product cards, banners, pictures inside text). */
  estimated: number
}

export type SpeedCounts = {
  sections: number
  images: number
  videos: number
  background_videos: number
  carousels: number
  maps: number
  custom_html: number
  fonts: number
  product_cards: number
}

export type SpeedReport = { score: number; rating: SpeedRating; label: string; weight: SpeedWeight; counts: SpeedCounts; issues: PageCheckIssue[] }

const KB = 1024
const MB = 1024 * 1024

export const SPEED_LIMITS = {
  /** A phone shows pictures about 390 px wide at 2× density. */
  phoneWidth: 780,
  /** Whole page (served): above this it costs points. */
  pageBytes: 1.5 * MB,
  pageWarning: 3 * MB,
  pageError: 5 * MB,
  /** The first screen's pictures (served). */
  firstScreenBytes: 300 * KB,
  firstScreenWarning: 500 * KB,
  firstScreenError: 1 * MB,
  /** A background picture (always the original) above this is a tip. */
  backgroundBytes: 500 * KB,
  /** A picture without smaller copies wider than this, or bigger than `noCopiesBytes`, is a tip. */
  noCopiesWidth: 1280,
  noCopiesBytes: 400 * KB,
  carousels: 2,
  embeds: 4,
  fonts: 2,
  fontBytes: 150 * KB,
  sections: 20,
  pictures: 40,
} as const

/** Bytes per pixel by file type (typical photos: WebP ≈ 0.9 bits, JPEG ≈ 1.8 bits per pixel). */
const BYTES_PER_PIXEL = { webp: 0.11, jpg: 0.22, png: 1, gif: 0.6, other: 0.22 } as const
type Format = keyof typeof BYTES_PER_PIXEL

/** Rough figures for what the page loads by itself (bytes). */
const ESTIMATES = { productCard: 40 * KB, banner: 150 * KB, textPicture: 200 * KB, latinFont: 40 * KB, banglaFont: 90 * KB, customFont: 100 * KB } as const

export const SPEED_RATING_LABELS: Record<SpeedRating, string> = { fast: 'Fast', average: 'Could be faster', slow: 'Slow' }

export function speedRating(score: number): SpeedRating {
  return score >= 90 ? 'fast' : score >= 50 ? 'average' : 'slow'
}

/** The score the Speed issues add up to (100 minus their points), with its rating. */
export function speedScore(issues: readonly PageCheckIssue[]): { score: number; rating: SpeedRating; label: string; issues: PageCheckIssue[] } {
  const speed = issues.filter((issue) => issue.group === 'speed')
  const points = speed.reduce((sum, issue) => sum + (typeof issue.details?.penalty === 'number' ? issue.details.penalty : 0), 0)
  const score = Math.max(0, Math.min(100, Math.round(100 - points)))
  const rating = speedRating(score)
  return { score, rating, label: SPEED_RATING_LABELS[rating], issues: speed }
}

/* ----------------------------------------------------------------------------------------------
 * Pictures: which copy is served and how heavy it is
 * -------------------------------------------------------------------------------------------- */

export type SrcsetCandidate = { url: string; width: number }

/** `"/a-320.webp 320w, /a.jpg 1600w"` → candidates, narrowest first. */
export function parseSrcset(srcset: string | undefined): SrcsetCandidate[] {
  if (!srcset) return []
  return srcset
    .split(',')
    .map((part) => /^\s*(\S+)\s+(\d+)w\s*$/.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ url: m[1]!, width: Number(m[2]) }))
    .sort((a, b) => a.width - b.width)
}

export function formatOf(url: string | undefined): Format {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url ?? '')?.[1]?.toLowerCase()
  if (ext === 'webp') return 'webp'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg'
  if (ext === 'png') return 'png'
  if (ext === 'gif') return 'gif'
  return 'other'
}

export function estimateBytes(width: number, height: number, format: Format): number {
  return Math.round(width * height * BYTES_PER_PIXEL[format])
}

export type ServedPicture = {
  /** The file downloaded (the original's url when it is served). */
  url: string
  width: number
  bytes: number
  /** As uploaded. */
  original: number
  /** The original is what is served. */
  isOriginal: boolean
  /** The library made narrower copies of it. */
  smallerCopies: boolean
  format: Format
}

/**
 * The copy the storefront serves for a slot `slot` px wide (null when the picture's size is
 * unknown). `background`: CSS backgrounds use the original.
 */
export function servedPicture(media: CheckMedia | undefined, slot: number, background = false): ServedPicture | null {
  if (!media || !media.width || media.width <= 0) return null
  const width = media.width
  const height = media.height && media.height > 0 ? media.height : Math.round(width * 0.75)
  const originalFormat = formatOf(media.url)
  const original = media.size && media.size > 0 ? media.size : estimateBytes(width, height, originalFormat)
  const candidates = parseSrcset(media.srcset)
  const smallerCopies = candidates.some((c) => c.width < width)
  const asOriginal: ServedPicture = { url: media.url ?? '', width, bytes: original, original, isOriginal: true, smallerCopies, format: originalFormat }
  if (background || candidates.length === 0) return asOriginal
  const target = Math.min(width, Math.max(slot, SPEED_LIMITS.phoneWidth))
  const chosen = candidates.find((c) => c.width >= target) ?? candidates[candidates.length - 1]!
  const format = formatOf(chosen.url)
  if (chosen.url === media.url || (format !== 'webp' && chosen.width >= width)) return asOriginal
  const bytes = Math.min(original, estimateBytes(chosen.width, Math.round((chosen.width * height) / width), format))
  return { url: chosen.url, width: chosen.width, bytes, original, isOriginal: false, smallerCopies, format }
}

/* ----------------------------------------------------------------------------------------------
 * Fonts
 * -------------------------------------------------------------------------------------------- */

export type CheckFonts = {
  heading?: string
  body?: string
  /** null: the default (the main font when it is a Bangla font, else Baloo Da 2 / Hind Siliguri). */
  bangla_heading?: string | null
  bangla_body?: string | null
  /** The store's uploaded fonts (`key` = `custom:<uuid>`), with their size in bytes when known. */
  custom?: { key: string; name: string; size?: number }[]
}

type FontUse = { key: string; name: string; bytes: number; custom: boolean; sizeKnown: boolean }

const isBangla = (key: unknown) => isBuiltInFont(key) && FONT_INFO[key].bengali

/** The font files a page downloads: the heading and body fonts, plus the Bangla ones when the page has Bangla text. */
export function fontsInUse(fonts: CheckFonts | undefined, bangla: boolean): FontUse[] {
  if (!fonts) return []
  const keys: string[] = [fonts.heading, fonts.body].filter((k): k is string => typeof k === 'string' && k !== '')
  if (bangla) {
    const pick = (chosen: unknown, main: unknown, fallback: string) => (isBangla(chosen) || isCustomFontKey(chosen) ? (chosen as string) : isBangla(main) ? (main as string) : fallback)
    keys.push(pick(fonts.bangla_heading, fonts.heading, DEFAULT_BANGLA_HEADING), pick(fonts.bangla_body, fonts.body, DEFAULT_BANGLA_BODY))
  }
  const out: FontUse[] = []
  for (const key of new Set(keys)) {
    if (isBuiltInFont(key)) {
      if (FONT_INFO[key].family === null) continue
      out.push({ key, name: FONT_INFO[key].label, bytes: FONT_INFO[key].bengali ? ESTIMATES.banglaFont : ESTIMATES.latinFont, custom: false, sizeKnown: false })
    } else if (isCustomFontKey(key)) {
      const upload = fonts.custom?.find((font) => font.key === key)
      // An uploaded font that is gone falls back to the system font: nothing to download.
      if (fonts.custom && !upload) continue
      const size = upload?.size && upload.size > 0 ? upload.size : null
      out.push({ key, name: upload?.name || 'an uploaded font', bytes: size ?? ESTIMATES.customFont, custom: true, sizeKnown: size !== null })
    }
  }
  return out
}

/* ----------------------------------------------------------------------------------------------
 * The walk
 * -------------------------------------------------------------------------------------------- */

type Picture = {
  node: StyledNode
  place: Place
  field: string
  tab: 'content' | 'style'
  media_id: string
  served: ServedPicture
  background: boolean
  firstScreen: boolean
}

type SectionInfo = { node: StyledNode; place: Place; index: number; hasMedia: boolean; video: boolean }

const CAROUSELS = new Set(['image_carousel', 'logo_carousel', 'hero_slider', 'product_carousel'])
const PRODUCT_LISTS = new Set(['product_carousel', 'product_grid', 'product_tabs', 'hot_deals'])
const BANNERS = new Set(['hero_slider', 'banner_grid'])
const HTML_TYPES = new Set(['text', 'custom_html', 'accordion', 'tabs'])
const UNSAFE_TAGS = /<\s*(script|iframe|embed|object|link|style)\b/i
const BENGALI = /[ঀ-৿]/

function htmlOf(element: StyledNode): { field: string; html: string }[] {
  const p = isObj(element.props) ? element.props : {}
  if (element.type === 'text' || element.type === 'custom_html') return [{ field: 'html', html: str(p.html) }]
  if (element.type === 'accordion' || element.type === 'tabs') return list(p.items).map((item) => ({ field: `items.${str(item.id)}.html`, html: str(item.html) }))
  return []
}

/** The background pictures and video of a node (any breakpoint; the video lives on `base`). */
function backgroundsOf(node: StyledNode): { media_ids: string[]; video: Obj | null } {
  const style = isObj(node.style) ? (node.style as Obj) : {}
  const media_ids: string[] = []
  let video: Obj | null = null
  for (const bp of ['base', 'tablet', 'mobile']) {
    const background = isObj(style[bp]) && isObj((style[bp] as Obj).background) ? ((style[bp] as Obj).background as Obj) : null
    if (!background) continue
    if (background.type === 'image' && isObj(background.image) && typeof background.image.media_id === 'string' && background.image.media_id !== '') media_ids.push(background.image.media_id)
    if (bp === 'base' && isObj(background.video) && str(background.video.video_id) !== '') video = background.video
  }
  return { media_ids: [...new Set(media_ids)], video }
}

type Points = { penalty: number }
const capped = (each: number, count: number, max: number) => Math.min(max, each * count)

/** Runs the speed checks (see the file comment). Popups are left out (they are not a page). */
export function runSpeedCheck(input: PageCheckInput): SpeedReport {
  const out = new Collector()
  const counts: SpeedCounts = { sections: 0, images: 0, videos: 0, background_videos: 0, carousels: 0, maps: 0, custom_html: 0, fonts: 0, product_cards: 0 }
  const weight: SpeedWeight = { original: 0, served: 0, first_screen: 0, fonts: 0, estimated: 0 }
  if (input.document.kind === 'popup') return finish(out, counts, weight)
  const context = documentContext(input.document.key ?? '')
  const container = input.theme?.container_width ?? 1280
  const pics: Picture[] = []
  const carousels: { node: StyledNode; place: Place }[] = []
  const embeds: { node: StyledNode; place: Place }[] = []
  const htmlIssues: { node: StyledNode; place: Place; field: string; unsafe: boolean; pictures: number }[] = []
  const sections: SectionInfo[] = []

  const addPicture = (node: StyledNode, place: Place, field: string, tab: Picture['tab'], media_id: string, slot: number, background: boolean, section: SectionInfo) => {
    counts.images += 1
    section.hasMedia = true
    const served = servedPicture(input.media[media_id], slot, background)
    if (served) pics.push({ node, place, field, tab, media_id, served, background, firstScreen: false })
  }

  const visitElements = (column: Column, place: Place, section: SectionInfo) => {
    for (const element of column.elements as unknown as (StyledNode & { hidden?: boolean; visibility?: Partial<Record<string, boolean>>; columns?: Column[] })[]) {
      if (element.hidden === true || !visibleAnywhere(element)) continue
      if (element.type === 'inner_row') {
        visitBackground(element, place, section)
        for (const child of element.columns ?? []) {
          const width = typeof child.width?.base === 'number' ? child.width.base / 100 : 1
          visitElements(child as Column, { ...place, chain: [child as unknown as StyledNode, element, ...place.chain], fraction: place.fraction * width }, section)
        }
        continue
      }
      const p = isObj(element.props) ? element.props : {}
      const slot = (place.wide ? 1920 : container) * place.fraction
      for (const picture of pictures(element, slot)) addPicture(element, place, picture.field, 'content', picture.media_id, picture.slot, false, section)
      if (CAROUSELS.has(element.type)) {
        counts.carousels += 1
        carousels.push({ node: element, place })
        section.hasMedia = true
      }
      if (element.type === 'video') {
        counts.videos += 1
        embeds.push({ node: element, place })
        section.hasMedia = true
      }
      if (element.type === 'map') {
        counts.maps += 1
        embeds.push({ node: element, place })
      }
      if (element.type === 'custom_html') counts.custom_html += 1
      if (PRODUCT_LISTS.has(element.type)) {
        const config = isObj(p.config) ? p.config : {}
        const limit = typeof config.limit === 'number' && config.limit > 0 ? Math.min(config.limit, 48) : 8
        counts.product_cards += limit
        weight.estimated += limit * ESTIMATES.productCard
      }
      if (BANNERS.has(element.type)) {
        const items = Math.max(1, list(p.items).length)
        weight.estimated += items * ESTIMATES.banner
        section.hasMedia = true
      }
      if (HTML_TYPES.has(element.type)) {
        for (const { field, html } of htmlOf(element)) {
          const unsafe = element.type === 'custom_html' && UNSAFE_TAGS.test(html)
          const inside = (html.match(/<img\b/gi) ?? []).length
          if (inside > 0) {
            counts.images += inside
            weight.estimated += inside * ESTIMATES.textPicture
          }
          if (unsafe || inside > 0) htmlIssues.push({ node: element, place, field, unsafe, pictures: inside })
        }
      }
    }
  }

  const visitBackground = (node: StyledNode, place: Place, section: SectionInfo) => {
    const { media_ids, video } = backgroundsOf(node)
    const slot = place.wide || node.type === 'section' ? 1920 : container * place.fraction
    for (const media_id of media_ids) addPicture(node, place, 'background', 'style', media_id, slot, true, section)
    if (video) {
      counts.background_videos += 1
      section.video = true
      section.hasMedia = true
    }
  }

  for (const raw of input.content.sections as unknown as Obj[]) {
    if (raw.type !== 'section' || raw.hidden === true) continue
    const node = raw as unknown as StyledNode & { visibility?: Partial<Record<string, boolean>>; columns?: Column[] }
    if (!visibleAnywhere(node)) continue
    const global = isObj(raw.global) ? raw.global : null
    const place: Place = { chain: [node], fraction: 1, wide: isObj(node.props) && node.props.layout !== 'boxed', owner: global ? node.id : null, ownerTitle: global ? str(global.title) || null : null }
    const section: SectionInfo = { node, place, index: sections.length, hasMedia: false, video: false }
    sections.push(section)
    counts.sections += 1
    visitBackground(node, place, section)
    for (const column of Array.isArray(node.columns) ? node.columns : []) {
      const width = typeof column.width?.base === 'number' ? column.width.base / 100 : 1
      const columnPlace = { ...place, chain: [column as unknown as StyledNode, node], fraction: width }
      visitBackground(column as unknown as StyledNode, columnPlace, section)
      visitElements(column, columnPlace, section)
    }
  }

  // The first screen: the first section, and the next one too when the first has no pictures or video (a slim bar).
  const firstScreen = new Set<StyledNode>()
  if (sections[0]) {
    firstScreen.add(sections[0].node)
    if (!sections[0].hasMedia && sections[1]) firstScreen.add(sections[1].node)
  }
  const sectionOf = (place: Place) => place.chain[place.chain.length - 1]!
  for (const pic of pics) pic.firstScreen = firstScreen.has(sectionOf(pic.place))

  // Weights: each file once (the browser reuses a picture shown twice).
  const seen = new Set<string>()
  const seenOriginal = new Set<string>()
  for (const pic of pics) {
    if (!seenOriginal.has(pic.media_id)) {
      seenOriginal.add(pic.media_id)
      weight.original += pic.served.original
    }
    const file = `${pic.media_id}|${pic.served.url}|${pic.served.width}`
    if (seen.has(file)) continue
    seen.add(file)
    weight.served += pic.served.bytes
    if (pic.firstScreen) weight.first_screen += pic.served.bytes
  }
  const bangla = BENGALI.test(JSON.stringify(input.content.sections))
  const pageLike = context === 'page' || context === 'cms'
  const fonts = pageLike ? fontsInUse(input.theme?.fonts, bangla) : []
  counts.fonts = fonts.length
  weight.fonts = fonts.reduce((sum, font) => sum + font.bytes, 0)
  // `weight.estimated` so far holds the rough figures of the walk (product cards, banners, pictures inside text).
  weight.served += weight.fonts + weight.estimated
  weight.estimated += fonts.filter((font) => !font.sizeKnown).reduce((sum, font) => sum + font.bytes, 0)

  const add = (issue: Omit<PageCheckIssue, 'key' | 'source' | 'group'> & Points, place: Place | null) => {
    const { penalty, ...rest } = issue
    out.add({ ...rest, group: 'speed', details: { ...(rest.details ?? {}), penalty } }, place)
  }
  const smaller = (pic: Picture): PageCheckFix => focus('Use a smaller picture', pic.node.id, pic.field, pic.tab)
  const where = (pic: Picture) => (pic.background ? `the background of this ${label(pic.node.type)}` : `this ${label(pic.node.type)}`)
  const heaviest = [...pics].sort((a, b) => b.served.bytes - a.served.bytes)[0] ?? null

  // 1. The whole page.
  if (weight.served > SPEED_LIMITS.pageBytes) {
    const severity: PageCheckSeverity = weight.served >= SPEED_LIMITS.pageError ? 'error' : weight.served >= SPEED_LIMITS.pageWarning ? 'warning' : 'tip'
    const biggest = heaviest && heaviest.served.bytes >= 200 * KB ? heaviest : null
    add(
      {
        code: 'speed_page_heavy',
        severity,
        message: `Shoppers download about ${megabytes(weight.served)} of pictures and fonts to see this whole page; pages under ${megabytes(SPEED_LIMITS.pageBytes)} open quickly on phone data.${biggest ? ` The biggest is a picture in ${where(biggest)} (${size(biggest.served.bytes)}).` : ''}`,
        node_id: biggest ? biggest.node.id : null,
        field: biggest ? biggest.field : null,
        fix: biggest ? smaller(biggest) : null,
        details: { served: weight.served, original: weight.original, estimated: weight.estimated },
        penalty: Math.max(1, Math.min(30, Math.round(((weight.served - SPEED_LIMITS.pageBytes) / MB) * 8))),
      },
      biggest?.place ?? null,
    )
  }

  // 2. The first screen.
  const firstPics = pics.filter((pic) => pic.firstScreen).sort((a, b) => b.served.bytes - a.served.bytes)
  const firstBig = firstPics[0]
  if (firstBig && weight.first_screen > SPEED_LIMITS.firstScreenBytes) {
    const bytes = weight.first_screen
    const severity: PageCheckSeverity = bytes >= SPEED_LIMITS.firstScreenError ? 'error' : bytes >= SPEED_LIMITS.firstScreenWarning ? 'warning' : 'tip'
    const several = firstPics.length > 1 ? `The pictures at the top of the page weigh about ${size(bytes)} together` : `The first picture shoppers see weighs about ${size(bytes)}`
    const why = firstBig.background ? ' It is a background picture, and those are always sent at full size.' : ''
    add(
      {
        code: 'speed_first_screen_heavy',
        severity,
        message: `${several}, so the top of the page appears late, especially on phones.${why} Use a picture under ${size(SPEED_LIMITS.firstScreenBytes)} (about 1600 px wide is plenty).`,
        node_id: firstBig.node.id,
        field: firstBig.field,
        fix: smaller(firstBig),
        details: { bytes, media_id: firstBig.media_id, served_width: firstBig.served.width, background: firstBig.background },
        penalty: Math.max(1, Math.min(20, Math.round((bytes - SPEED_LIMITS.firstScreenBytes) / (50 * KB)))),
      },
      firstBig.place,
    )
  }

  // 3. Background pictures (never made smaller) and pictures without smaller copies.
  const backgrounds = pics.filter((pic) => pic.background && !pic.firstScreen && pic.served.bytes > SPEED_LIMITS.backgroundBytes)
  backgrounds.forEach((pic, i) =>
    add(
      {
        code: 'speed_background_heavy',
        severity: 'tip',
        message: `The background picture of this ${label(pic.node.type)} is about ${size(pic.served.bytes)}. Background pictures are always sent at full size; use a smaller picture (under ${size(SPEED_LIMITS.backgroundBytes)}) or an Image element.`,
        node_id: pic.node.id,
        field: pic.field,
        fix: smaller(pic),
        details: { bytes: pic.served.bytes, media_id: pic.media_id },
        penalty: i < 3 ? 3 : 0,
      },
      pic.place,
    ),
  )
  const uncopied = pics.filter((pic) => !pic.background && pic.served.isOriginal && !pic.served.smallerCopies && (pic.served.width > SPEED_LIMITS.noCopiesWidth || pic.served.original > SPEED_LIMITS.noCopiesBytes))
  uncopied.forEach((pic, i) => {
    const gif = pic.served.format === 'gif'
    add(
      {
        code: 'speed_no_smaller_copies',
        severity: pic.served.original >= MB ? 'warning' : 'tip',
        message: gif
          ? `A picture in ${where(pic)} is an animated GIF of about ${size(pic.served.original)}; GIFs are never made smaller. Use a video or a still picture.`
          : `A picture in ${where(pic)} has no smaller copies yet, so every phone downloads the full ${size(pic.served.original)} file. Smaller copies are made a minute after uploading; if this stays, upload the picture again or use a smaller one.`,
        node_id: pic.node.id,
        field: pic.field,
        fix: smaller(pic),
        details: { bytes: pic.served.original, media_id: pic.media_id, width: pic.served.width },
        penalty: i < 4 ? 2 : 0,
      },
      pic.place,
    )
  })

  // 4. Background videos (they play by themselves on computers and tablets).
  sections.filter((s) => s.video).forEach((s, i) => {
    const first = firstScreen.has(s.node)
    const later = sections.slice(s.index + 1).length > 0
    add(
      {
        code: first ? 'speed_video_first_screen' : 'speed_background_video',
        severity: first ? 'warning' : 'tip',
        message: first
          ? 'A video plays behind the top of the page. On computers and tablets a video player loads before shoppers see the rest, so the page feels slow. Move the video lower or use a picture.'
          : 'A video plays behind this section, which loads a video player on computers and tablets. One background video per page is plenty.',
        node_id: s.node.id,
        field: 'background',
        fix: first && later ? { kind: 'apply', label: 'Move the video lower', node_id: s.node.id, action: { type: 'move-down' } } : focus(first ? 'Use a picture instead' : 'Change the background', s.node.id, 'background', 'style'),
        penalty: first ? 15 : i < 3 ? 4 : 0,
      },
      s.place.owner ? s.place : null,
    )
  })

  // 5. Carousels and embeds.
  if (counts.carousels > SPEED_LIMITS.carousels) {
    const extra = carousels[SPEED_LIMITS.carousels]!
    add(
      {
        code: 'speed_many_carousels',
        severity: 'tip',
        message: `This page has ${counts.carousels} slideshows (carousels). Each one loads all its pictures or products and keeps moving; ${SPEED_LIMITS.carousels} are usually enough.`,
        node_id: extra.node.id,
        field: null,
        fix: focus('Select it', extra.node.id, null),
        details: { count: counts.carousels },
        penalty: capped(3, counts.carousels - SPEED_LIMITS.carousels, 9),
      },
      extra.place,
    )
  }
  if (embeds.length > SPEED_LIMITS.embeds) {
    const extra = embeds[SPEED_LIMITS.embeds]!
    add(
      {
        code: 'speed_many_embeds',
        severity: 'tip',
        message: `This page has ${counts.videos} ${counts.videos === 1 ? 'video' : 'videos'} and ${counts.maps} ${counts.maps === 1 ? 'map' : 'maps'}. Each one loads a player from another website when tapped; keep the ones that matter most.`,
        node_id: extra.node.id,
        field: null,
        fix: focus('Select it', extra.node.id, null),
        details: { videos: counts.videos, maps: counts.maps },
        penalty: capped(2, embeds.length - SPEED_LIMITS.embeds, 6),
      },
      extra.place,
    )
  }

  // 6. Custom HTML and pictures inside text.
  let unsafeCount = 0
  let insideCount = 0
  for (const item of htmlIssues) {
    if (item.unsafe) {
      add(
        {
          code: 'speed_custom_html_script',
          severity: 'warning',
          message: 'This custom HTML has a script or an embedded frame. The store takes these out for safety, so it won’t work, and outside scripts slow the page down. Use the Video or Map element instead, or remove it.',
          node_id: item.node.id,
          field: item.field,
          fix: focus('Edit the HTML', item.node.id, item.field),
          penalty: unsafeCount < 3 ? 5 : 0,
        },
        item.place,
      )
      unsafeCount += 1
    }
    if (item.pictures > 0) {
      const points = Math.max(0, Math.min(8 - insideCount * 2, item.pictures * 2))
      insideCount += item.pictures
      add(
        {
          code: 'speed_text_pictures',
          severity: 'tip',
          message: `${item.pictures === 1 ? 'A picture' : `${item.pictures} pictures`} inside this ${label(item.node.type)}’s text ${item.pictures === 1 ? 'is' : 'are'} always sent at full size. Use an Image element instead: it sends a smaller copy to phones.`,
          node_id: item.node.id,
          field: item.field,
          fix: focus('Edit the text', item.node.id, item.field),
          details: { pictures: item.pictures },
          penalty: points,
        },
        item.place,
      )
    }
  }

  // 7. Fonts.
  if (fonts.length > SPEED_LIMITS.fonts) {
    const names = fonts.map((font) => font.name)
    add(
      {
        code: 'speed_many_fonts',
        severity: fonts.length >= 4 ? 'warning' : 'tip',
        message: `The page uses ${fonts.length} fonts (${names.join(', ')}). Each one is another file to download before the text looks right; ${SPEED_LIMITS.fonts} are usually enough.`,
        node_id: null,
        field: 'fonts',
        fix: { kind: 'site-styles', label: 'Use fewer fonts' },
        details: { fonts: fonts.map((font) => font.key), bytes: weight.fonts },
        penalty: capped(5, fonts.length - SPEED_LIMITS.fonts, 15),
      },
      null,
    )
  }
  for (const font of fonts.filter((f) => f.custom && f.sizeKnown && f.bytes > SPEED_LIMITS.fontBytes)) {
    add(
      {
        code: 'speed_font_heavy',
        severity: 'tip',
        message: `The uploaded font “${font.name}” is ${size(font.bytes)}; fonts over ${size(SPEED_LIMITS.fontBytes)} delay the text. A lighter font (or one with fewer weights) helps.`,
        node_id: null,
        field: `fonts.${font.key}`,
        fix: { kind: 'site-styles', label: 'Choose another font' },
        details: { bytes: font.bytes },
        penalty: 3,
      },
      null,
    )
  }

  // 8. Very long pages and many pictures.
  if (pageLike && counts.sections > SPEED_LIMITS.sections) {
    add(
      {
        code: 'speed_long_page',
        severity: 'tip',
        message: `This page has ${counts.sections} sections. Very long pages load more and shoppers rarely reach the end; move some parts to their own page.`,
        node_id: null,
        field: 'sections',
        fix: null,
        details: { sections: counts.sections },
        penalty: Math.min(10, counts.sections - SPEED_LIMITS.sections),
      },
      null,
    )
  }
  if (counts.images > SPEED_LIMITS.pictures) {
    add(
      {
        code: 'speed_many_pictures',
        severity: 'tip',
        message: `This page shows ${counts.images} pictures. Pictures further down load as shoppers scroll, but each one still costs data; keep the best ones.`,
        node_id: null,
        field: 'pictures',
        fix: null,
        details: { pictures: counts.images },
        penalty: Math.min(10, Math.ceil((counts.images - SPEED_LIMITS.pictures) / 5)),
      },
      null,
    )
  }

  return finish(out, counts, weight)
}

function finish(out: Collector, counts: SpeedCounts, weight: SpeedWeight): SpeedReport {
  const { score, rating, label: text } = speedScore(out.issues)
  return { score, rating, label: text, weight, counts, issues: out.issues }
}

/** "820 KB" / "1.4 MB". */
export function size(bytes: number): string {
  return bytes >= MB ? megabytes(bytes) : `${Math.max(1, Math.round(bytes / KB))} KB`
}

/** "about 1.2 MB to download" — the plain summary under the score. */
export function speedSummary(report: Pick<SpeedReport, 'weight'>): string {
  return `About ${size(report.weight.served)} to download${report.weight.estimated > 0 ? ' (partly estimated)' : ''}.`
}

