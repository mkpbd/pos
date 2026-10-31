import { describe, expect, it } from 'vitest'
import type { ThemeDocument } from '@/features/storefront/api'
import { contrastRatio, meetsAA } from '@/features/storefront/contrast'
import { addNode, countNodes, emptyNode, errorKey, fromApi, isSafeLink, moveNode, nodeAt, removeNode, toApi, updateNode, validateTree, type EditorNode } from '@/features/storefront/menu-tree'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'
import { themeSchema, toDocument, toFormValues } from '@/features/storefront/theme-form'

const node = (label: string, children: EditorNode[] = []): EditorNode => ({ ...emptyNode(), label, url: `/${label.toLowerCase()}`, children })

describe('menu tree operations', () => {
  const tree = () => [node('Boys', [node('Shirts'), node('Pants')]), node('Girls')]

  it('adds items at the top level and as children, up to three levels', () => {
    let t = addNode(tree(), [])
    expect(t.map((n) => n.label)).toEqual(['Boys', 'Girls', ''])
    t = addNode(t, [0, 1])
    expect(nodeAt(t, [0, 1, 0])?.label).toBe('')
    expect(addNode(t, [0, 1, 0])).toBe(t) // a fourth level is refused
    expect(countNodes(t)).toBe(6)
  })

  it('moves among siblings and ignores moves past the edges', () => {
    const t = moveNode(tree(), [0, 1], -1)
    expect(nodeAt(t, [0])?.children.map((n) => n.label)).toEqual(['Pants', 'Shirts'])
    expect(moveNode(t, [0, 0], -1)[0]?.children.map((n) => n.label)).toEqual(['Pants', 'Shirts'])
    expect(moveNode(tree(), [1], 1).map((n) => n.label)).toEqual(['Boys', 'Girls'])
  })

  it('updates and removes without touching the original tree', () => {
    const original = tree()
    const updated = updateNode(original, [0, 0], { label: 'Tees' })
    expect(nodeAt(updated, [0, 0])?.label).toBe('Tees')
    expect(nodeAt(original, [0, 0])?.label).toBe('Shirts')
    expect(removeNode(updated, [0]).map((n) => n.label)).toEqual(['Girls'])
  })

  it('serializes for the API: mega fields only on mega items, keys dropped', () => {
    const t = updateNode(tree(), [0], { is_mega: true, mega_columns: null, image_media_id: 'm-1' })
    const withImageOnPlain = updateNode(t, [1], { image_media_id: 'm-2', mega_columns: 3 })
    const payload = toApi(withImageOnPlain)
    expect(payload[0]).toMatchObject({ label: 'Boys', is_mega: true, mega_columns: 4, image_media_id: 'm-1', type: 'custom' })
    expect(payload[1]).toMatchObject({ is_mega: false, mega_columns: null, image_media_id: null })
    expect(payload[0]).not.toHaveProperty('key')
    expect(fromApi(payload)[0]?.children[1]?.label).toBe('Pants')
  })

  it('validates labels, links and mega placement with API-shaped keys', () => {
    let t = updateNode(tree(), [0, 1], { url: 'javascript:alert(1)' })
    t = updateNode(t, [1], { label: ' ' })
    t = updateNode(t, [0, 0], { is_mega: true })
    expect(validateTree(t, true)).toEqual({
      'items.0.children.1.url': expect.any(String),
      'items.1.label': expect.any(String),
      'items.0.children.0.is_mega': expect.any(String),
    })
    expect(validateTree(updateNode(tree(), [0], { is_mega: true }), false)).toHaveProperty(['items.0.is_mega'])
    expect(errorKey([2, 0, 1])).toBe('items.2.children.0.children.1')
  })

  it('accepts site paths and http(s) links only', () => {
    expect(['/sale', '/boys?size=2', 'https://blog.example.com', 'http://x.test'].every(isSafeLink)).toBe(true)
    expect(['//evil.test', 'javascript:alert(1)', 'mailto:a@b.c', 'boys', '/a b', '', '/\\evil'].some(isSafeLink)).toBe(false)
  })
})

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#3b2500', '#f59e0b')).toBeGreaterThan(6.5)
    expect(meetsAA(contrastRatio('#ffffff', '#ffab05'))).toBe(false) // the reference theme's white on orange
    expect(meetsAA(contrastRatio('#ffffff', '#6f55c2'))).toBe(true)
    expect(contrastRatio('red', '#000000')).toBeNull()
  })
})

describe('announcement schedule', () => {
  it('round-trips datetime-local values through ISO strings with the browser offset', () => {
    const iso = fromLocalInput('2026-11-01T09:30')
    expect(iso).toMatch(/^2026-11-01T09:30:00[+-]\d{2}:\d{2}$/)
    expect(new Date(iso!).getTime()).toBe(new Date('2026-11-01T09:30').getTime())
    expect(toLocalInput(iso)).toBe('2026-11-01T09:30')
    expect(fromLocalInput('')).toBeNull()
    expect(toLocalInput(null)).toBe('')
  })
})

describe('theme form', () => {
  const doc: ThemeDocument = {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo_media_id: 'm-1',
    favicon_media_id: null,
    announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: 'https://facebook.com/x', instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: ['m-2'] },
  }

  it('turns the document into form values and back without loss', () => {
    expect(toDocument(toFormValues(doc))).toEqual(doc)
  })

  it('requires announcement text when enabled and https social links', () => {
    const values = toFormValues(doc)
    values.announcement.enabled = true
    values.footer.social.instagram = 'http://instagram.com/x'
    const result = themeSchema.safeParse(values)
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['announcement.text', 'footer.social.instagram']))
  })
})
