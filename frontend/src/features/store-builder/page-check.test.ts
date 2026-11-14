import { describe, expect, it } from 'vitest'
import type { BuilderContent } from '@/storefront/builder/types'
import { blend, checkCounts, countsText, fromServerIssue, groupBySeverity, lengthPx, mergeCheckIssues, plainText, runPageCheck, serverFieldKey, type PageCheckInput, type PageCheckIssue } from './page-check'
import { readServerIssues } from './page-check-api'
import { applyPageCheckFix } from './page-check-fix'
import { findNode } from './tree'

const VIS = { desktop: true, tablet: true, mobile: true }

let n = 0
function el(type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `e${n}x`, type, props, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, ...extra }
}

function section(elements: unknown[], extra: Record<string, unknown> = {}, columnExtra: Record<string, unknown> = {}) {
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
    columns: [{ id: `c${n}x`, type: 'column', width: { base: 100 }, style: {}, elements, ...columnExtra }],
    ...extra,
  }
}

const h1 = () => el('heading', { text: 'Fresh sweets', level: 1, link: null })

function content(sections: unknown[], seo?: unknown): BuilderContent {
  return { schema_version: 1, ...(seo ? { seo } : {}), sections } as unknown as BuilderContent
}

const THEME: PageCheckInput['theme'] = {
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#134e4a', accent_foreground: '#ffffff', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', link: null },
  container_width: 1200,
}

const SEO = { title: 'Sweets', description: 'Fresh handmade sweets delivered across Dhaka.', image: null, noindex: false, translations: {} }

function check(sections: unknown[], options: Partial<PageCheckInput> & { seo?: unknown } = {}): PageCheckIssue[] {
  return runPageCheck({ content: content(sections, options.seo === undefined ? SEO : options.seo), document: options.document ?? { kind: 'page', key: 'home' }, theme: options.theme === undefined ? THEME : options.theme, media: options.media ?? {} })
}

const codes = (issues: PageCheckIssue[]) => issues.map((i) => i.code)

describe('runPageCheck', () => {
  it('finds nothing on a tidy page', () => {
    expect(check([section([h1(), el('text', { html: '<p>Hello <a href="/shop">shop</a></p>' })])])).toEqual([])
  })

  it('missing alt text: a warning with an "Add description" fix; linked pictures are errors; the library description counts for images', () => {
    const image = el('image', { media_id: 'm1', alt: '', link: null, aspect: 'auto', fit: 'cover' })
    const linked = el('image', { media_id: 'm2', alt: ' ', link: { url: '/shop' }, aspect: 'auto', fit: 'cover' })
    const described = el('image', { media_id: 'm3', alt: '', link: null, aspect: 'auto', fit: 'cover' })
    const gallery = el('gallery', { images: [{ id: 'img-a', media_id: 'm4', alt: '', caption: '' }, { id: 'img-b', media_id: 'm5', alt: 'Cake', caption: '' }], columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' })
    const issues = check([section([h1(), image, linked, described, gallery])], { media: { m3: { alt: 'A cake' } } })
    const alts = issues.filter((i) => i.code === 'missing_alt')
    expect(alts.map((i) => [i.node_id, i.severity, i.field])).toEqual([
      [linked.id, 'error', 'alt'],
      [image.id, 'warning', 'alt'],
      [gallery.id, 'warning', 'images.img-a.alt'],
    ])
    expect(alts[1]!.fix).toEqual({ kind: 'focus', label: 'Add description', node_id: image.id, tab: 'content', field: 'alt' })
  })

  it('headings: one h1, no skipped levels; fixes change the level', () => {
    const a = el('heading', { text: 'Intro', level: 2, link: null })
    const b = el('heading', { text: 'Deep', level: 4, link: null })
    const issues = check([section([a, b])])
    expect(codes(issues)).toEqual(['no_h1', 'heading_skipped'])
    const skipped = issues.find((i) => i.code === 'heading_skipped')!
    expect(skipped.fix).toMatchObject({ kind: 'apply', action: { type: 'set-heading-level', level: 3 } })
    const noH1 = issues.find((i) => i.code === 'no_h1')!
    expect(noH1.node_id).toBe(a.id)

    const two = check([section([h1(), el('heading', { text: 'Again', level: 1, link: null })])])
    expect(codes(two)).toEqual(['extra_h1'])
    // Headings inside rich text count too (fix: edit the text).
    const rich = check([section([h1(), el('text', { html: '<h3>Jump</h3>' })])])
    expect(rich[0]).toMatchObject({ code: 'heading_skipped', field: 'html', fix: { kind: 'focus', field: 'html' } })
  })

  it('a header or zone has no main heading of its own', () => {
    const issues = check([section([h1()])], { document: { kind: 'zone', key: 'zone:listing.top' }, seo: null })
    expect(codes(issues)).toEqual(['extra_h1'])
    expect(issues[0]!.message).toMatch(/already have a main heading/)
  })

  it('contrast below 4.5:1 (3:1 for large text) on colours the page chose; fix to a theme colour that reads', () => {
    const pale = el('text', { html: '<p>Hard to read</p>' }, { style: { base: { color: '#cccccc' } } })
    const bigPale = el('heading', { text: 'Big', level: 1, link: null }, { style: { base: { color: '#888888' } } })
    const issues = check([section([bigPale, pale], { style: { base: { background: { type: 'color', color: '#ffffff' } } } })])
    const low = issues.filter((i) => i.code === 'low_contrast')
    // #888888 on white is about 3.5:1 — fine for a large heading; #ccc fails for text.
    expect(low.map((i) => i.node_id)).toEqual([pale.id])
    expect(low[0]!.fix).toEqual({ kind: 'apply', label: 'Use the theme text colour', node_id: pale.id, action: { type: 'set-color', breakpoint: 'base', color: 'theme:text' } })
    expect(low[0]!.message).toMatch(/hard to read/)
  })

  it('contrast follows dark section backgrounds, see-through colours and per-device overrides', () => {
    const text = el('text', { html: '<p>On dark</p>' })
    const dark = section([h1(), text], { style: { base: { background: { type: 'color', color: '#111111' } } } })
    const issues = check([dark])
    // The theme text colour on near-black fails; the fix picks the text-on-primary colour (white).
    const low = issues.find((i) => i.code === 'low_contrast' && i.node_id === text.id)!
    expect(low.fix).toMatchObject({ action: { color: 'theme:primary_foreground' } })

    const phone = el('text', { html: '<p>x</p>' }, { style: { mobile: { color: '#eeeeee' } } })
    const onPhone = check([section([h1(), phone], { style: { base: { background: { type: 'color', color: '#ffffff' } } } })])
    expect(onPhone.find((i) => i.code === 'low_contrast')).toMatchObject({ node_id: phone.id, details: { breakpoint: 'mobile' }, fix: { action: { breakpoint: 'mobile' } } })
    // A picture background can't be measured.
    const photo = section([h1(), el('text', { html: '<p>x</p>' }, { style: { base: { color: '#eeeeee' } } })], { style: { base: { background: { type: 'image', image: { media_id: 'm1', position: 'center', size: 'cover', repeat: false } } } } })
    expect(codes(check([photo]))).not.toContain('low_contrast')
    expect(blend('#00000080', '#ffffff')).toBe('#7f7f7f')
  })

  it('filled buttons are measured against their own colours', () => {
    const button = el('button', { label: 'Buy', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }, { style: { base: { color: '#14857a' } } })
    expect(check([section([h1(), button])]).find((i) => i.code === 'low_contrast')?.node_id).toBe(button.id)
  })

  it('buttons and links: no text, empty or unsafe addresses; dismiss buttons have no link', () => {
    const empty = el('button', { label: '', link: { url: '' }, variant: 'primary', size: 'md', full_width: false })
    const bad = el('button', { label: 'Go', link: { url: 'javascript:alert(1)' }, variant: 'primary', size: 'md', full_width: false })
    const icon = el('icon', { name: 'star', size: 32, color: null, label: '', link: { url: '/sale' } })
    const cta = el('cta', { title: 'T', text: 'x', primary: { label: 'Shop', link: { url: '/shop' } }, secondary: { label: '', link: { url: 'shop' } }, align: 'left' })
    const text = el('text', { html: '<p><a href="">here</a> <a href="mailto:a@b.co">mail</a> <a href="/x"> </a></p>' })
    const dismiss = el('button', { label: 'Close', link: { url: '' }, variant: 'primary', size: 'md', full_width: false, action: 'dismiss' })
    const issues = check([section([h1(), empty, bad, icon, cta, text, dismiss])])
    const of = (id: string) => issues.filter((i) => i.node_id === id).map((i) => `${i.code}:${i.field}`)
    expect(of(empty.id)).toEqual(['button_no_text:label', 'link_empty:link'])
    expect(of(bad.id)).toEqual(['link_invalid:link'])
    expect(of(icon.id)).toEqual(['link_no_text:label'])
    expect(of(cta.id)).toEqual(['button_no_text:secondary.label', 'link_invalid:secondary.link'])
    expect(of(text.id)).toEqual(['text_link_empty:html', 'text_link_no_text:html'])
    expect(of(dismiss.id)).toEqual([])
  })

  it('elements hidden on every device, empty sections and empty text', () => {
    const ghost = el('text', { html: '<p>x</p>' }, { visibility: { desktop: false, tablet: false, mobile: false } })
    const empty = section([])
    const blank = el('text', { html: '<p> </p>' })
    const issues = check([section([h1(), ghost, blank]), empty])
    expect(issues.find((i) => i.code === 'hidden_everywhere')).toMatchObject({ node_id: ghost.id, severity: 'warning', fix: { kind: 'apply', action: { type: 'show-on-all-devices' } } })
    expect(issues.find((i) => i.code === 'empty_section')).toMatchObject({ node_id: empty.id, fix: { kind: 'focus', node_id: empty.id, field: null } })
    expect(issues.find((i) => i.code === 'text_empty')).toMatchObject({ node_id: blank.id, severity: 'tip' })
    // Nodes hidden with the eye are left alone.
    expect(check([section([h1(), el('text', { html: '' }, { hidden: true })])])).toEqual([])
  })

  it('phone text under 14 px', () => {
    const small = el('text', { html: '<p>tiny</p>' }, { style: { base: { typography: { size: '0.75rem' } } } })
    const fine = el('text', { html: '<p>ok</p>' }, { style: { base: { typography: { size: '12px' } }, mobile: { typography: { size: '15px' } } } })
    const issues = check([section([h1(), small, fine])])
    expect(issues.filter((i) => i.code === 'small_phone_text').map((i) => i.node_id)).toEqual([small.id])
    expect(issues.find((i) => i.code === 'small_phone_text')!.fix).toMatchObject({ action: { type: 'set-text-size', breakpoint: 'mobile', size: '14px' } })
  })

  it('big pictures in small slots (width over 2400 px or over 1 MB)', () => {
    const half = el('image', { media_id: 'big', alt: 'A', link: null, aspect: 'auto', fit: 'cover' })
    const heavy = el('gallery', { images: [{ id: 'img-a', media_id: 'heavy', alt: 'B', caption: '' }], columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' })
    const wide = el('image', { media_id: 'big', alt: 'A', link: null, aspect: 'auto', fit: 'cover' })
    const sections = [section([h1(), half, heavy], {}, { width: { base: 50 } }), section([wide], { props: { layout: 'full', anchor: null } })]
    const issues = check(sections, { media: { big: { width: 4000, size: 900_000 }, heavy: { width: 1200, size: 3 * 1024 * 1024 } } })
    const big = issues.filter((i) => i.code === 'image_too_big')
    expect(big.map((i) => [i.node_id, i.field, i.severity])).toEqual([
      [half.id, 'media_id', 'tip'],
      [heavy.id, 'images.img-a.media_id', 'tip'],
    ])
    expect(big[0]!.message).toMatch(/4000 px wide/)
    expect(big[1]!.message).toMatch(/3\.0 MB/)
  })

  it('page SEO: missing description is a warning, missing title a tip; only on pages with SEO', () => {
    const issues = check([section([h1()])], { seo: null })
    expect(issues.map((i) => [i.code, i.severity, i.node_id, i.fix])).toEqual([
      ['seo_description_missing', 'warning', null, { kind: 'focus', label: 'Add description', node_id: null, tab: 'content', field: 'seo.description' }],
      ['seo_title_missing', 'tip', null, { kind: 'focus', label: 'Add title', node_id: null, tab: 'content', field: 'seo.title' }],
    ])
    expect(check([section([el('text', { html: '<p>x</p>' })])], { document: { kind: 'footer', key: 'footer' }, seo: null })).toEqual([])
  })

  it('issues inside a drawn global section point at the reference', () => {
    const inside = el('image', { media_id: 'm1', alt: '', link: null, aspect: 'auto', fit: 'cover' })
    const global = { ...section([inside]), id: 'ref-1', global: { id: 'g-uuid', title: 'Promo strip', section_id: 's-g', version: null } }
    const issues = check([section([h1()]), global])
    expect(issues[0]).toMatchObject({ code: 'missing_alt', node_id: 'ref-1', fix: { kind: 'focus', node_id: 'ref-1', field: null, label: 'Select the global section' } })
    expect(issues[0]!.message).toMatch(/“Promo strip”/)
    const unavailable = { id: 'ref-2', type: 'global_section', ref: 'gone', hidden: false, schedule: null, state: 'unavailable', global: { id: 'gone', title: null, section_id: null, version: null } }
    expect(check([section([h1()]), unavailable])[0]).toMatchObject({ code: 'global_unavailable', severity: 'error', node_id: 'ref-2' })
  })

  it('sorts errors, then warnings, then tips; page-wide first, then page order', () => {
    const late = el('button', { label: '', link: { url: '/x' }, variant: 'primary', size: 'md', full_width: false })
    const early = el('image', { media_id: 'm1', alt: '', link: null, aspect: 'auto', fit: 'cover' })
    const issues = check([section([early]), section([late])], { seo: null })
    expect(issues.map((i) => i.severity)).toEqual(['error', 'warning', 'warning', 'tip'])
    expect(issues[0]!.node_id).toBe(late.id)
    expect(issues[1]!.code).toBe('seo_description_missing')
  })
})

describe('server issues', () => {
  it('reads the response, maps fields to form keys and gives Fix it actions', () => {
    const raw = [
      { code: 'LINK_BROKEN', severity: 'error', node_id: 'e1', message: 'The link goes to a product that doesn’t exist.', details: { path: 'sections.0.columns.0.elements.0.props.link.url', field: 'props.link.url', url: '/product/x' } },
      { code: 'MEDIA_NOT_FOUND', severity: 'error', node_id: null, message: 'The sharing picture is gone.', details: { path: 'seo.image.media_id', field: 'seo.image.media_id' } },
      { code: 'FORM_NO_RECIPIENT', severity: 'tip', node_id: 'e2', message: 'Nobody gets the answers.', details: { field: 'props.notify_email' } },
      { code: 'BAD', severity: 'odd', node_id: '', message: 'x' },
      { severity: 'error' },
    ]
    const issues = readServerIssues(raw)
    expect(issues).toHaveLength(4)
    expect(issues[3]).toMatchObject({ severity: 'warning', node_id: null })
    const mapped = issues.map(fromServerIssue)
    expect(mapped[0]).toMatchObject({ source: 'server', field: 'link', fix: { kind: 'focus', node_id: 'e1', field: 'link' } })
    expect(mapped[1]).toMatchObject({ node_id: null, field: 'seo.image', fix: { kind: 'focus', node_id: null, field: 'seo.image' } })
    expect(mapped[2]).toMatchObject({ field: 'notify_email' })
    expect(mapped[3]!.fix).toBeNull()
    expect(serverFieldKey('props.images.2.alt')).toBe('images.2.alt')
    expect(serverFieldKey('props.primary.link.url')).toBe('primary.link')
  })

  it('merges with the client issues in page order without duplicates', () => {
    const image = el('image', { media_id: 'm1', alt: '', link: null, aspect: 'auto', fit: 'cover' })
    const button = el('button', { label: 'Buy', link: { url: '/product/gone' }, variant: 'primary', size: 'md', full_width: false })
    const c = content([section([h1(), button, image])], SEO)
    const client = runPageCheck({ content: c, document: { kind: 'page', key: 'home' }, theme: THEME, media: {} })
    const server = [
      { code: 'LINK_BROKEN', severity: 'error' as const, node_id: button.id, message: 'Broken', details: { field: 'props.link.url' } },
      { code: 'LINK_BROKEN', severity: 'error' as const, node_id: button.id, message: 'Broken', details: { field: 'props.link.url' } },
      { code: 'MEDIA_NOT_FOUND', severity: 'error' as const, node_id: image.id, message: 'Gone', details: {} },
    ]
    const merged = mergeCheckIssues(client, server, c)
    expect(merged.map((i) => `${i.severity}:${i.code}`)).toEqual(['error:LINK_BROKEN', 'error:MEDIA_NOT_FOUND', 'warning:missing_alt'])
    const counts = checkCounts(merged)
    expect(counts).toEqual({ errors: 2, warnings: 1, tips: 0, total: 3 })
    expect(countsText(counts)).toBe('2 errors, 1 warning')
    expect(countsText(checkCounts([]))).toBe('No problems found')
    expect(groupBySeverity(merged).map((g) => [g.label, g.issues.length])).toEqual([['Errors', 2], ['Warnings', 1]])
  })
})

describe('applyPageCheckFix', () => {
  it('applies each action and leaves unknown nodes alone', () => {
    const text = el('text', { html: '<p>x</p>' }, { style: { base: { color: '#cccccc' } }, visibility: { desktop: false, tablet: false, mobile: false } })
    const heading = el('heading', { text: 'H', level: 4, link: null })
    let c = content([section([heading, text])])
    c = applyPageCheckFix(c, { kind: 'apply', label: '', node_id: text.id, action: { type: 'set-color', breakpoint: 'base', color: 'theme:text' } })
    c = applyPageCheckFix(c, { kind: 'apply', label: '', node_id: text.id, action: { type: 'set-text-size', breakpoint: 'mobile', size: '14px' } })
    c = applyPageCheckFix(c, { kind: 'apply', label: '', node_id: text.id, action: { type: 'show-on-all-devices' } })
    c = applyPageCheckFix(c, { kind: 'apply', label: '', node_id: heading.id, action: { type: 'set-heading-level', level: 2 } })
    const t = findNode(c, text.id)!.node as unknown as { style: unknown; visibility: unknown }
    expect(t.style).toEqual({ base: { color: 'theme:text' }, mobile: { typography: { size: '14px' } } })
    expect(t.visibility).toEqual(VIS)
    expect((findNode(c, heading.id)!.node as unknown as { props: { level: number } }).props.level).toBe(2)
    expect(applyPageCheckFix(c, { kind: 'apply', label: '', node_id: 'nope', action: { type: 'show-on-all-devices' } })).toBe(c)
    expect(applyPageCheckFix(c, { kind: 'apply', label: '', node_id: text.id, action: { type: 'set-heading-level', level: 1 } })).toBe(c)
    expect(applyPageCheckFix(c, { kind: 'site-styles', label: '' })).toBe(c)
  })
})

describe('helpers', () => {
  it('plainText and lengthPx', () => {
    expect(plainText('<p>Hi&nbsp;<b>there</b></p>')).toBe('Hi there')
    expect(lengthPx('0.75rem')).toBe(12)
    expect(lengthPx('13px')).toBe(13)
    expect(lengthPx('auto')).toBeNull()
  })
})
