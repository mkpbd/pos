import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../color'
import { productZonePayload } from '../builder/payload'
import type { BuilderPage } from '../builder/types'
import { createTranslator } from '../i18n/translate'
import { bn } from '../i18n/bn'
import { tEn } from '../test-fixtures'
import { badgeColors, customBadgesOf } from './badge-colors'
import { deliveryDays, deliveryFee, deliveryFreeOver, deliveryOptionsOf } from './delivery'
import { DEFAULT_PRODUCT_LAYOUT, resolveProductLayout } from './product-layout'
import { galleryVideoOf } from './product-video'
import { clampView, IDENTITY, MAX_ZOOM, panView, pinchView, toggleZoom, wheelFactor, zoomAt, zoomCentre, type ZoomBox } from './zoom'

const page = (id: string): BuilderPage => ({ document: { id, key: id, title: id, version: 1, source: 'published' }, sections: [], media: {}, data: {} })

describe('product layout (P1b)', () => {
  it('fills missing or unknown keys with today’s page', () => {
    expect(resolveProductLayout(undefined)).toEqual(DEFAULT_PRODUCT_LAYOUT)
    expect(resolveProductLayout({ gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' })).toEqual({ gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' })
    expect(resolveProductLayout({ gallery: 'top', thumbnails: 7, sticky_summary: 'yes', details: 'stacked' })).toEqual({ ...DEFAULT_PRODUCT_LAYOUT, details: 'stacked' })
  })
})

describe('product zones (P1b)', () => {
  const bootstrap = { builder: { home: false, zones: { 'product.after': page('store-wide') } } }

  it('reads only the product’s resolved zones when it has them', () => {
    const product = { zones: { 'product.below_price': page('below'), 'product.after': null, 'product.bottom': page('bottom') } }
    expect(productZonePayload(product, bootstrap, 'product.below_price')?.document.id).toBe('below')
    // Resolved to nothing for this product: the bootstrap's store-wide document does not come back.
    expect(productZonePayload(product, bootstrap, 'product.after')).toBeNull()
    expect(productZonePayload(product, bootstrap, 'product.bottom')?.document.id).toBe('bottom')
    expect(productZonePayload({ zones: { 'product.after': { sections: 'nope' } as unknown as BuilderPage } }, bootstrap, 'product.after')).toBeNull()
  })

  it('keeps the bootstrap’s product.after for payloads from before P1b', () => {
    expect(productZonePayload({}, bootstrap, 'product.after')?.document.id).toBe('store-wide')
    expect(productZonePayload({}, bootstrap, 'product.bottom')).toBeNull()
  })
})

describe('delivery note texts (P1b)', () => {
  const option = (extra: Record<string, unknown>) => ({ zone: 'Inside Dhaka', method: null, min_days: 1, max_days: 2, fee: '60.00', free_over: null, ...extra })

  it('keeps only well-formed options', () => {
    const options = deliveryOptionsOf({
      cod_available: true,
      options: [option({}), option({ zone: '' }), option({ min_days: 1.5 }), option({ fee: '6O' }), option({ fee: null, free_over: '2000.00' })] as never,
    })
    expect(options).toHaveLength(2)
    expect(deliveryOptionsOf(null)).toEqual([])
  })

  it('words days, fees and free-delivery thresholds', () => {
    expect(deliveryDays({ min_days: 1, max_days: 2 }, tEn)).toBe('1–2 days')
    expect(deliveryDays({ min_days: 3, max_days: 3 }, tEn)).toBe('3 days')
    expect(deliveryDays({ min_days: 1, max_days: 1 }, tEn)).toBe('1 day')
    expect(deliveryDays({ min_days: 0, max_days: 2 }, tEn)).toBe('within 2 days')
    expect(deliveryDays({ min_days: 0, max_days: 0 }, tEn)).toBe('same day')
    expect(deliveryFee({ fee: '60.00' }, 'BDT', tEn)).toBe('৳60')
    expect(deliveryFee({ fee: '0.00' }, 'BDT', tEn)).toBe('free')
    expect(deliveryFee({ fee: null }, 'BDT', tEn)).toBe('charge depends on the method')
    expect(deliveryFreeOver({ fee: '60.00', free_over: '2000.00' }, 'BDT', tEn)).toBe('free over ৳2,000')
    expect(deliveryFreeOver({ fee: '0.00', free_over: '2000.00' }, 'BDT', tEn)).toBeNull()
    expect(deliveryFreeOver({ fee: '60.00', free_over: null }, 'BDT', tEn)).toBeNull()
  })

  it('uses Bengali digits when the store asks for them', () => {
    const t = createTranslator(bn, { locale: 'bn', banglaDigits: true })
    expect(deliveryDays({ min_days: 3, max_days: 5 }, t)).toBe('৩–৫ দিন')
  })
})

describe('owner badges (P1b)', () => {
  it('keeps at most two well-formed badges', () => {
    expect(customBadgesOf([{ text: ' Best seller ', tone: 'new' }, { text: 'x', tone: 'loud' }, { text: '', tone: 'sale' }, { text: 'Eid offer', tone: 'sale' }, { text: 'Third', tone: 'dark' }])).toEqual([
      { text: 'Best seller', tone: 'new' },
      { text: 'Eid offer', tone: 'sale' },
    ])
    expect(customBadgesOf(null)).toEqual([])
  })

  it('picks a text colour with AA contrast on every tone, whatever the theme', () => {
    const light = { primary: '#fde68a', primary_foreground: '#3b2500', accent: '#fef3c7', accent_foreground: '#78350f', highlight: '#a7f3d0', sale: '#fecaca', heading: '#f9fafb', text: '#5f6368', canvas: '#fff', surface: '#fff', border: '#eee' }
    const dark = { ...light, accent: '#312e81', accent_foreground: '#ffffff', highlight: '#065f46', sale: '#7f1d1d', heading: '#111827' }
    for (const colors of [light, dark, null]) {
      for (const tone of ['sale', 'new', 'info', 'dark'] as const) {
        const { backgroundColor, color } = badgeColors(colors, tone)
        expect(contrastRatio(color, backgroundColor), `${tone} on ${backgroundColor}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    // Tone → theme colour: sale → Sale, new → Highlight, info → Secondary (accent), dark → Heading.
    expect(badgeColors(dark, 'info')).toEqual({ backgroundColor: '#312e81', color: '#ffffff' })
    expect(badgeColors(dark, 'dark').backgroundColor).toBe('#111827')
  })
})

describe('product video (P1b)', () => {
  it('builds the privacy-enhanced player from provider and id only', () => {
    const images = [{ id: 'i1', url: '/a.png', alt: 'A' }]
    expect(galleryVideoOf({ images, video: { provider: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' } })).toEqual({
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' },
      poster: images[0],
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1',
    })
    expect(galleryVideoOf({ images, video: { provider: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871' } })?.src).toBe('https://player.vimeo.com/video/76979871?dnt=1&autoplay=1')
    expect(galleryVideoOf({ images, video: { provider: 'youtube', id: 'bad id!', url: '' } })).toBeNull()
    expect(galleryVideoOf({ images, video: null })).toBeNull()
  })
})

describe('lightbox zoom maths (P1b)', () => {
  // A 400 × 300 photo centred in an 800 × 600 stage.
  const box: ZoomBox = { left: 200, top: 150, width: 400, height: 300, stageWidth: 800, stageHeight: 600 }

  it('keeps the point under the cursor in place and the photo over the stage', () => {
    const view = zoomAt(IDENTITY, 2, 400, 300, box)
    // 800 × 600 now: exactly the stage, so it cannot move.
    expect(view).toEqual({ scale: 2, x: -200, y: -150 })
    const deeper = zoomAt(view, 2, 400, 300, box)
    expect(deeper.scale).toBe(MAX_ZOOM)
    // The stage point (400, 300) still shows the photo's centre: left + x + scale × 200 = 400.
    expect(box.left + deeper.x + deeper.scale * 200).toBeCloseTo(400)
    expect(box.top + deeper.y + deeper.scale * 150).toBeCloseTo(300)
  })

  it('clamps pans and scale, centres a photo smaller than the stage', () => {
    const view = zoomAt(IDENTITY, 4, 400, 300, box)
    expect(panView(view, 10_000, 10_000, box)).toMatchObject({ x: -box.left, y: -box.top })
    expect(panView(view, -10_000, -10_000, box)).toMatchObject({ x: 800 - 200 - 1600, y: 600 - 150 - 1200 })
    // 1.5× = 600 × 450, still inside the 800 × 600 stage: centred.
    expect(zoomAt(IDENTITY, 1.5, 0, 0, box)).toEqual({ scale: 1.5, x: (800 - 600) / 2 - 200, y: (600 - 450) / 2 - 150 })
    expect(clampView({ scale: 0.2, x: 50, y: 50 }, box)).toEqual(IDENTITY)
    expect(clampView({ scale: 99, x: 0, y: 0 }, box).scale).toBe(MAX_ZOOM)
  })

  it('pinches, toggles on double tap and zooms around the centre', () => {
    const pinched = pinchView(IDENTITY, { x: 400, y: 300 }, 100, { x: 400, y: 300 }, 300, box)
    expect(pinched.scale).toBe(3)
    expect(box.left + pinched.x + pinched.scale * 200).toBeCloseTo(400)
    expect(toggleZoom(pinched, 400, 300, box)).toEqual(IDENTITY)
    expect(toggleZoom(IDENTITY, 400, 300, box).scale).toBe(2.5)
    expect(zoomCentre(IDENTITY, 2, box)).toEqual(zoomAt(IDENTITY, 2, 400, 300, box))
  })

  it('turns wheel notches into gentle zoom steps', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48))
  })
})
