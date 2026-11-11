import type { Rect } from '@/storefront/builder/canvas/protocol'
import { cloneSample } from '@/storefront/builder/test-payload'
import { computeDropTarget, layerDropTarget, SECTION_EDGE } from './drop-targets'

/*
 * Rects of the sample document on a 1000 px wide canvas: hero 0–400; story 400–800 with two
 * columns (text 100–500 holding heading / text / button, media 500–900 holding the image);
 * features 800–1000 with an inner row of three columns; products 1000–1400; the hidden section
 * is not drawn (no rect).
 */
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })
const rects: Record<string, Rect> = {
  s_hero: r(0, 0, 1000, 400),
  c_hero: r(0, 0, 1000, 400),
  e_slider: r(0, 0, 1000, 400),
  s_story: r(0, 400, 1000, 400),
  c_story_text: r(100, 450, 400, 300),
  e_heading: r(100, 450, 400, 60),
  e_text: r(100, 520, 400, 100),
  e_button: r(100, 640, 200, 50),
  c_story_media: r(500, 450, 400, 300),
  e_image: r(500, 450, 400, 300),
  s_features: r(0, 800, 1000, 200),
  c_features: r(100, 820, 800, 160),
  e_row: r(100, 820, 800, 160),
  c_feat_a: r(100, 820, 260, 160),
  e_feat_a: r(100, 830, 260, 40),
  c_feat_b: r(370, 820, 260, 160),
  e_spacer: r(370, 830, 260, 48),
  e_divider: r(370, 890, 260, 2),
  c_feat_c: r(640, 820, 260, 160),
  s_products: r(0, 1000, 1000, 400),
  c_products: r(0, 1000, 1000, 400),
  e_grid: r(0, 1000, 1000, 400),
}

const heading = { kind: 'new', type: 'heading' } as const

describe('drop targets from canvas rects', () => {
  const doc = cloneSample()

  it('between two elements, by their midpoints', () => {
    const result = computeDropTarget(doc, rects, { x: 200, y: 540 }, heading, 1000)
    expect(result?.target).toEqual({ kind: 'column', columnId: 'c_story_text', index: 1 })
    expect(result?.indicator).toEqual({ kind: 'line', rect: { x: 100, y: 520, w: 400, h: 0 } })
    expect(computeDropTarget(doc, rects, { x: 200, y: 740 }, heading, 1000)?.target).toEqual({ kind: 'column', columnId: 'c_story_text', index: 3 })
  })

  it('into an empty column (a box indicator) and into inner-row columns', () => {
    const empty = computeDropTarget(doc, rects, { x: 700, y: 900 }, heading, 1000)
    expect(empty?.target).toEqual({ kind: 'column', columnId: 'c_feat_c', index: 0 })
    expect(empty?.indicator.kind).toBe('box')
    expect(computeDropTarget(doc, rects, { x: 400, y: 880 }, heading, 1000)?.target).toEqual({ kind: 'column', columnId: 'c_feat_b', index: 1 })
  })

  it('an inner row never lands in an inner row: it goes into the section column instead', () => {
    const row = { kind: 'new', type: 'inner_row' } as const
    expect(computeDropTarget(doc, rects, { x: 700, y: 900 }, row, 1000)?.target).toEqual({ kind: 'column', columnId: 'c_features', index: 1 })
  })

  it('a new section near a section edge', () => {
    const top = computeDropTarget(doc, rects, { x: 500, y: 800 + SECTION_EDGE - 4 }, heading, 1000)
    expect(top?.target).toEqual({ kind: 'new-section', index: 2 })
    expect(top?.indicator).toEqual({ kind: 'line', rect: { x: 0, y: 800, w: 1000, h: 0 } })
    expect(computeDropTarget(doc, rects, { x: 500, y: 798 }, heading, 1000)?.target).toEqual({ kind: 'new-section', index: 2 })
  })

  it('below the last drawn section: a new section at the end of what is drawn', () => {
    expect(computeDropTarget(doc, rects, { x: 500, y: 1500 }, heading, 1000)?.target).toEqual({ kind: 'new-section', index: 4 })
  })

  it('sections only move between sections', () => {
    const section = { kind: 'node', id: 's_hero', type: 'section' } as const
    expect(computeDropTarget(doc, rects, { x: 300, y: 1300 }, section, 1000)?.target).toEqual({ kind: 'new-section', index: 4 })
    expect(computeDropTarget(doc, rects, { x: 300, y: 450 }, section, 1000)?.target).toEqual({ kind: 'new-section', index: 1 })
  })

  it('an empty page: a first section', () => {
    expect(computeDropTarget({ schema_version: 1, sections: [] }, {}, { x: 10, y: 10 }, heading, 375)?.target).toEqual({ kind: 'new-section', index: 0 })
  })
})

describe('drop targets in the layers tree', () => {
  const doc = cloneSample()
  const button = { kind: 'node', id: 'e_button', type: 'button' } as const

  it('before / after an element row, at the end of a column row', () => {
    expect(layerDropTarget(doc, 'e_heading', 'top', button)).toEqual({ target: { kind: 'column', columnId: 'c_story_text', index: 0 }, position: 'before', rowId: 'e_heading' })
    expect(layerDropTarget(doc, 'e_image', 'bottom', button)?.target).toEqual({ kind: 'column', columnId: 'c_story_media', index: 1 })
    expect(layerDropTarget(doc, 'c_feat_c', 'top', button)).toEqual({ target: { kind: 'column', columnId: 'c_feat_c', index: 0 }, position: 'inside', rowId: 'c_feat_c' })
  })

  it('sections before / after sections; never onto itself or into its own columns', () => {
    const section = { kind: 'node', id: 's_hero', type: 'section' } as const
    expect(layerDropTarget(doc, 's_products', 'bottom', section)?.target).toEqual({ kind: 'new-section', index: 4 })
    expect(layerDropTarget(doc, 's_hero', 'top', section)).toBeNull()
    const row = { kind: 'node', id: 'e_row', type: 'inner_row' } as const
    expect(layerDropTarget(doc, 'c_feat_a', 'top', row)).toBeNull()
    expect(layerDropTarget(doc, 'e_spacer', 'top', row)).toBeNull()
  })
})
