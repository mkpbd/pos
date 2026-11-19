import { describe, expect, it } from 'vitest'
import type { BuilderContent } from '@/storefront/builder/types'
import { runPageCheck, type CheckMedia, type PageCheckInput, type PageCheckIssue } from './page-check'
import { applyPageCheckFix } from './page-check-fix'
import { estimateBytes, fontsInUse, formatOf, parseSrcset, runSpeedCheck, servedPicture, size, speedRating, speedScore, speedSummary, SPEED_LIMITS } from './page-check-speed'

const KB = 1024
const MB = 1024 * 1024
const VIS = { desktop: true, tablet: true, mobile: true }

let n = 0
function el(type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `e${n}x`, type, props, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, ...extra }
}

function section(elements: unknown[], extra: Record<string, unknown> = {}) {
  n += 1
  return {
    id: `s${n}x`,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: {},
    visibility: { ...VIS },
    hidden: false,
    schedule: null,
    translations: {},
    columns: [{ id: `c${n}x`, type: 'column', width: { base: 100 }, style: {}, elements }],
    ...extra,
  }
}

const h1 = () => el('heading', { text: 'Fresh sweets', level: 1, link: null })
const image = (media_id: string) => el('image', { media_id, alt: 'A picture', link: null, aspect: 'auto', fit: 'cover' })
const SEO = { title: 'Sweets', description: 'Fresh handmade sweets delivered across Dhaka.', image: null, noindex: false, translations: {} }
const THEME = { colors: {}, container_width: 1200 }

function input(sections: unknown[], options: { media?: Record<string, CheckMedia>; fonts?: NonNullable<PageCheckInput['theme']>['fonts']; document?: PageCheckInput['document'] } = {}): PageCheckInput {
  return {
    content: { schema_version: 1, seo: SEO, sections } as unknown as BuilderContent,
    document: options.document ?? { kind: 'page', key: 'home' },
    theme: { ...THEME, fonts: options.fonts },
    media: options.media ?? {},
  }
}

const speed = (sections: unknown[], options: Parameters<typeof input>[1] = {}) => runSpeedCheck(input(sections, options))
const codes = (issues: PageCheckIssue[]) => issues.map((i) => i.code)
const points = (issue: PageCheckIssue | undefined) => issue?.details?.penalty

/** A library picture with WebP copies (320 / 640 / 1280 and the full-width one). */
const withCopies = (name: string, width = 2400, height = 1600, bytes = 2 * MB): CheckMedia => ({
  url: `/storage/media/o/${name}.jpg`,
  srcset: `/storage/media/o/${name}-320.webp 320w, /storage/media/o/${name}-640.webp 640w, /storage/media/o/${name}-1280.webp 1280w, /storage/media/o/${name}-${width}.webp ${width}w`,
  width,
  height,
  size: bytes,
  alt: null,
})
/** A picture served as uploaded (no copies). */
const original = (name: string, width: number, height: number, bytes?: number, ext = 'jpg'): CheckMedia => ({ url: `/storage/media/o/${name}.${ext}`, srcset: `/storage/media/o/${name}.${ext} ${width}w`, width, height, size: bytes, alt: null })

describe('served pictures', () => {
  it('reads srcset and file types; picks the smallest WebP copy wide enough (at least a phone’s 780 px)', () => {
    expect(parseSrcset('/b-640.webp 640w, /a-320.webp 320w, broken')).toEqual([{ url: '/a-320.webp', width: 320 }, { url: '/b-640.webp', width: 640 }])
    expect(parseSrcset(undefined)).toEqual([])
    expect([formatOf('/a.JPG'), formatOf('/a.webp?v=2'), formatOf('/a.png'), formatOf('/a.gif'), formatOf('/a')]).toEqual(['jpg', 'webp', 'png', 'gif', 'other'])

    const media = withCopies('hero')
    const wide = servedPicture(media, 1200)!
    expect(wide).toMatchObject({ url: '/storage/media/o/hero-1280.webp', width: 1280, isOriginal: false, smallerCopies: true, original: 2 * MB })
    expect(wide.bytes).toBe(estimateBytes(1280, 853, 'webp'))
    // A small slot still gets a phone-sized copy.
    expect(servedPicture(media, 300)!.width).toBe(1280)
    expect(servedPicture(media, 1900)!.url).toBe('/storage/media/o/hero-2400.webp')
    // Backgrounds use the original.
    expect(servedPicture(media, 1920, true)).toMatchObject({ isOriginal: true, bytes: 2 * MB })
    // No copies: the original; unknown bytes are worked out from the pixels.
    expect(servedPicture(original('raw', 1000, 800), 1200)).toMatchObject({ isOriginal: true, smallerCopies: false, bytes: estimateBytes(1000, 800, 'jpg') })
    // A copy never counts as heavier than the original.
    expect(servedPicture({ ...withCopies('tiny'), size: 20 * KB }, 1200)!.bytes).toBe(20 * KB)
    expect(servedPicture({ alt: 'x' }, 1200)).toBeNull()
  })

  it('size words and ratings', () => {
    expect(size(820 * KB)).toBe('820 KB')
    expect(size(1.44 * MB)).toBe('1.4 MB')
    expect([speedRating(90), speedRating(89), speedRating(50), speedRating(49)]).toEqual(['fast', 'average', 'average', 'slow'])
  })
})

describe('runSpeedCheck', () => {
  it('a light page scores 100 with no Speed issues', () => {
    const report = speed([section([h1(), image('m1')]), section([image('m1')])], { media: { m1: withCopies('m1', 1600, 900, 300 * KB) } })
    expect(report.issues).toEqual([])
    expect(report).toMatchObject({ score: 100, rating: 'fast', label: 'Fast' })
    // The same picture twice is downloaded once.
    expect(report.weight.served).toBe(servedPicture(withCopies('m1', 1600, 900, 300 * KB), 1200)!.bytes)
    expect(report.weight.original).toBe(300 * KB)
    expect(report.counts).toMatchObject({ sections: 2, images: 2 })
    expect(speedSummary(report)).toMatch(/^About \d+ KB to download\.$/)
  })

  it('a heavy first picture without smaller copies: first screen, no copies and page weight, each with points and "Use a smaller picture"', () => {
    const hero = image('hero')
    const report = speed([section([h1(), hero])], { media: { hero: original('hero', 2400, 1600, 3 * MB) } })
    expect(codes(report.issues)).toEqual(['speed_page_heavy', 'speed_first_screen_heavy', 'speed_no_smaller_copies'])
    const [page, first, copies] = report.issues
    expect(page).toMatchObject({ severity: 'warning', group: 'speed', node_id: hero.id, fix: { kind: 'focus', label: 'Use a smaller picture', node_id: hero.id, field: 'media_id', tab: 'content' } })
    expect(page!.message).toMatch(/about 3\.0 MB/)
    expect(first).toMatchObject({ severity: 'error', fix: { label: 'Use a smaller picture', field: 'media_id' } })
    expect(first!.message).toMatch(/first picture shoppers see weighs about 3\.0 MB/)
    expect(copies).toMatchObject({ severity: 'warning' })
    expect([points(page), points(first), points(copies)]).toEqual([12, 20, 2])
    expect(report.score).toBe(66)
    expect(report.rating).toBe('average')
    expect(report.weight.first_screen).toBe(3 * MB)
  })

  it('WebP copies make the same picture light', () => {
    const report = speed([section([h1(), image('hero')])], { media: { hero: withCopies('hero', 2400, 1600, 3 * MB) } })
    expect(report.issues).toEqual([])
    expect(report.weight.original).toBe(3 * MB)
    expect(report.weight.served).toBeLessThan(200 * KB)
  })

  it('a slim first section lets the next one count as the first screen', () => {
    const bar = section([el('text', { html: '<p>Free delivery today</p>' })])
    const hero = image('big')
    const report = speed([bar, section([h1(), hero])], { media: { big: original('big', 1600, 1000, 700 * KB) } })
    expect(report.issues.find((i) => i.code === 'speed_first_screen_heavy')).toMatchObject({ node_id: hero.id, severity: 'warning' })
  })

  it('background pictures are sent at full size: first screen points at the Style tab; later heavy ones are tips', () => {
    const background = (media_id: string) => ({ style: { base: { background: { type: 'image', image: { media_id, position: 'center', size: 'cover', repeat: false } } } } })
    const top = section([h1()], background('bg1'))
    const later = section([el('text', { html: '<p>x</p>' })], background('bg2'))
    const report = speed([top, later], { media: { bg1: withCopies('bg1', 1920, 1080, 900 * KB), bg2: withCopies('bg2', 1920, 1080, 800 * KB) } })
    const first = report.issues.find((i) => i.code === 'speed_first_screen_heavy')!
    expect(first).toMatchObject({ node_id: top.id, field: 'background', fix: { kind: 'focus', tab: 'style', field: 'background', label: 'Use a smaller picture' } })
    expect(first.message).toMatch(/background picture/)
    expect(report.issues.find((i) => i.code === 'speed_background_heavy')).toMatchObject({ node_id: later.id, severity: 'tip', details: { penalty: 3 } })
  })

  it('an animated GIF has no smaller copies', () => {
    const gif = el('gallery', { images: [{ id: 'g1', media_id: 'gif', alt: 'Dancing', caption: '' }], columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' })
    const report = speed([section([h1()]), section([gif])], { media: { gif: original('gif', 800, 800, 600 * KB, 'gif') } })
    const issue = report.issues.find((i) => i.code === 'speed_no_smaller_copies')!
    expect(issue).toMatchObject({ field: 'images.g1.media_id', severity: 'tip' })
    expect(issue.message).toMatch(/animated GIF of about 600 KB/)
  })

  it('a background video at the top: "Move the video lower" moves the section; elsewhere a tip', () => {
    const video = { style: { base: { background: { type: 'none', video: { url: 'https://youtu.be/abc', provider: 'youtube', video_id: 'abc' } } } } }
    const top = section([h1()], video)
    const next = section([el('text', { html: '<p>x</p>' })])
    const report = speed([top, next])
    const issue = report.issues.find((i) => i.code === 'speed_video_first_screen')!
    expect(issue).toMatchObject({ severity: 'warning', node_id: top.id, details: { penalty: 15 }, fix: { kind: 'apply', label: 'Move the video lower', node_id: top.id, action: { type: 'move-down' } } })
    expect(report.score).toBe(85)
    expect(report.counts.background_videos).toBe(1)
    const content = input([top, next]).content
    const moved = applyPageCheckFix(content, issue.fix!)
    expect(moved.sections.map((s) => s.id)).toEqual([next.id, top.id])
    // Moving the last section changes nothing.
    expect(applyPageCheckFix(moved, issue.fix!).sections.map((s) => s.id)).toEqual([next.id, top.id])

    // The only section: nowhere lower to go.
    expect(speed([top]).issues[0]!.fix).toMatchObject({ kind: 'focus', label: 'Use a picture instead', tab: 'style', field: 'background' })
    // Further down: a tip.
    const lower = speed([next, section([el('text', { html: '<p>y</p>' })]), top])
    expect(lower.issues[0]).toMatchObject({ code: 'speed_background_video', severity: 'tip', details: { penalty: 4 } })
  })

  it('more than two carousels and more than four videos and maps', () => {
    const carousel = () => el('image_carousel', { images: [], autoplay: 0, show_dots: true, show_arrows: true, aspect: '16:9' })
    const third = carousel()
    const map = () => el('map', { query: 'Dhaka', title: '', height: 360, zoom: 15 })
    const video = () => el('video', { url: 'https://youtu.be/x', provider: 'youtube', video_id: 'x', title: '', aspect: '16:9', autoplay: false, start: 0 })
    const fifth = map()
    const report = speed([section([h1(), carousel(), carousel(), third, el('product_carousel', { title: null, subtitle: null, config: { limit: 12 }, items: [] })]), section([video(), video(), map(), map(), fifth])])
    expect(report.issues.find((i) => i.code === 'speed_many_carousels')).toMatchObject({ node_id: third.id, details: { count: 4, penalty: 6 }, fix: { kind: 'focus', label: 'Select it', node_id: third.id } })
    expect(report.issues.find((i) => i.code === 'speed_many_embeds')).toMatchObject({ node_id: fifth.id, details: { videos: 2, maps: 3, penalty: 2 } })
    expect(report.counts).toMatchObject({ carousels: 4, videos: 2, maps: 3, product_cards: 12 })
    expect(report.weight.estimated).toBe(12 * 40 * KB)
  })

  it('custom HTML with a script and pictures inside text', () => {
    const html = el('custom_html', { html: '<div>Widget</div><script src="https://x.example/w.js"></script>' })
    const text = el('text', { html: '<p><img src="https://cdn.example/a.jpg"> <img src="/b.png"></p>' })
    const report = speed([section([h1(), html, text])])
    expect(report.issues.find((i) => i.code === 'speed_custom_html_script')).toMatchObject({ node_id: html.id, severity: 'warning', field: 'html', details: { penalty: 5 }, fix: { kind: 'focus', label: 'Edit the HTML', field: 'html' } })
    expect(report.issues.find((i) => i.code === 'speed_text_pictures')).toMatchObject({ node_id: text.id, severity: 'tip', details: { pictures: 2, penalty: 4 } })
    expect(report.counts).toMatchObject({ custom_html: 1, images: 2 })
  })

  it('fonts: heading + body, plus the Bangla fonts when the page has Bangla text; "Use fewer fonts" opens Site styles', () => {
    const fonts = { heading: 'playfair', body: 'poppins', bangla_heading: null, bangla_body: null }
    expect(speed([section([h1()])], { fonts }).issues).toEqual([])
    const bangla = speed([section([h1(), el('text', { html: '<p>তাজা মিষ্টি</p>' })])], { fonts })
    const issue = bangla.issues.find((i) => i.code === 'speed_many_fonts')!
    expect(issue).toMatchObject({ severity: 'warning', node_id: null, fix: { kind: 'site-styles', label: 'Use fewer fonts' }, details: { penalty: 10 } })
    expect(issue.message).toMatch(/4 fonts \(Playfair Display, Poppins, Baloo Da 2, Hind Siliguri\)/)
    expect(bangla.counts.fonts).toBe(4)
    // A Bangla main font draws Bangla too; the system font is no file.
    expect(fontsInUse({ heading: 'hind-siliguri', body: 'system' }, true).map((f) => f.key)).toEqual(['hind-siliguri'])
    // Not on headers, footers and zones (the whole store's fonts are checked on pages).
    expect(speed([section([el('text', { html: '<p>তাজা</p>' })])], { fonts, document: { kind: 'footer', key: 'footer' } }).issues).toEqual([])
  })

  it('a heavy uploaded font (size known) is a tip; a deleted one is not downloaded', () => {
    const custom = [{ key: 'custom:11111111-2222', name: 'Brand Sans', size: 320 * KB }]
    const report = speed([section([h1()])], { fonts: { heading: 'custom:11111111-2222', body: 'system', custom } })
    expect(report.issues.map((i) => [i.code, i.fix])).toEqual([['speed_font_heavy', { kind: 'site-styles', label: 'Choose another font' }]])
    expect(report.issues[0]!.message).toMatch(/“Brand Sans” is 320 KB/)
    expect(report.weight.fonts).toBe(320 * KB)
    expect(fontsInUse({ heading: 'custom:33333333-4444', body: 'poppins', custom: [] }, false).map((f) => f.key)).toEqual(['poppins'])
  })

  it('very long pages and very many pictures', () => {
    const many = Array.from({ length: SPEED_LIMITS.sections + 3 }, () => section([el('text', { html: '<p>x</p>' })]))
    expect(speed(many).issues.find((i) => i.code === 'speed_long_page')).toMatchObject({ details: { sections: 23, penalty: 3 }, fix: null })
    const gallery = el('gallery', { images: Array.from({ length: 46 }, (_, i) => ({ id: `g${i}`, media_id: `m${i}`, alt: 'x', caption: '' })), columns: { base: 4 }, aspect: 'square', lightbox: true, gap: 'md' })
    expect(speed([section([h1(), gallery])]).issues.find((i) => i.code === 'speed_many_pictures')).toMatchObject({ details: { pictures: 46, penalty: 2 } })
  })

  it('issues inside a drawn global section point at the reference; popups have no speed check', () => {
    const inner = image('big')
    const global = { ...section([inner]), id: 'ref-1', global: { id: 'g', title: 'Promo strip', section_id: 's', version: null } }
    const report = speed([global], { media: { big: original('big', 2400, 1600, 2 * MB) } })
    expect(report.issues.length).toBeGreaterThan(0)
    expect(report.issues.every((i) => i.node_id === 'ref-1' && i.fix?.kind === 'focus' && i.fix.label === 'Select the global section')).toBe(true)
    expect(runSpeedCheck(input([section([inner])], { media: { big: original('big', 2400, 1600, 2 * MB) }, document: { kind: 'popup', key: 'popup:x' } })).issues).toEqual([])
  })

  it('hidden sections and elements are left out', () => {
    const hidden = section([image('big')], { hidden: true })
    const nowhere = section([image('big')], { visibility: { desktop: false, tablet: false, mobile: false } })
    const report = speed([hidden, nowhere], { media: { big: original('big', 2400, 1600, 3 * MB) } })
    expect(report.counts.images).toBe(0)
    expect(report.score).toBe(100)
  })
})

describe('in the page check', () => {
  it('runPageCheck includes the Speed issues; speedScore adds up their points', () => {
    const issues = runPageCheck(input([section([h1(), image('hero')])], { media: { hero: original('hero', 2400, 1600, 3 * MB) } }))
    const score = speedScore(issues)
    expect(score).toMatchObject({ score: 66, rating: 'average', label: 'Could be faster' })
    expect(score.issues.every((i) => i.group === 'speed')).toBe(true)
    // The B10 issues keep no group.
    expect(issues.filter((i) => i.group === undefined)).toEqual([])
    expect(speedScore([])).toMatchObject({ score: 100, rating: 'fast' })
  })
})
