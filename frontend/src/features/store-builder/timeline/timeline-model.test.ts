import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Motion } from '@/storefront/builder/types'
import { findNode } from '../tree'
import { addEntrance, barGeometry, clampTiming, dragTiming, keyTiming, rowDescription, setTiming, snap, timelineRows, timelineSpan, type TimelineRow } from './timeline-model'

const label = (node: { type: string }) => node.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function withMotion(content: BuilderContent, id: string, motion: Motion): BuilderContent {
  const node = findNode(content, id)!.node as unknown as { style: { base?: Record<string, unknown> } }
  node.style.base = { ...(node.style.base ?? {}), motion }
  return content
}
const motionOf = (content: BuilderContent, id: string) => ((findNode(content, id)!.node as unknown as { style: { base?: { motion?: Motion } } }).style.base?.motion)

function row(patch: Partial<TimelineRow> = {}): TimelineRow {
  return { id: 'e', type: 'heading', depth: 1, label: 'Heading', entrance: 'slide-up', delay: 200, duration: 600, easing: 'smooth', offset: 0, ...patch }
}

describe('motion timeline model (B18 §4)', () => {
  it('lists the section, inner rows and elements in reading order (no columns)', () => {
    const rows = timelineRows(cloneSample(), 's_features', label)
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['s_features', 0],
      ['e_row', 1],
      ['e_feat_a', 2],
      ['e_spacer', 2],
      ['e_divider', 2],
    ])
    expect(rows.every((r) => r.entrance === 'none')).toBe(true)
    expect(timelineRows(cloneSample(), 'e_heading', label)).toEqual([])
  })

  it('adds a staggering section’s wait to the elements that enter', () => {
    let content = withMotion(cloneSample(), 's_story', { entrance: 'none', stagger_children: 150 })
    content = withMotion(content, 'e_heading', { entrance: 'fade', duration: 600, delay: 0 })
    content = withMotion(content, 'e_text', { entrance: 'slide-up', duration: 800, delay: 100, easing: 'spring' })
    content = withMotion(content, 'e_image', { entrance: 'zoom', duration: 600, delay: 0 })
    const rows = timelineRows(content, 's_story', label)
    expect(rows.map((r) => [r.id, r.offset])).toEqual([
      ['s_story', 0],
      ['e_heading', 0],
      ['e_text', 150],
      ['e_button', 0],
      ['e_image', 300],
    ])
    expect(rows[2]).toMatchObject({ delay: 100, duration: 800, easing: 'spring', entrance: 'slide-up' })
  })

  it('snaps to 50 ms', () => {
    expect(snap(0)).toBe(0)
    expect(snap(74)).toBe(50)
    expect(snap(75)).toBe(100)
    expect(snap(-20)).toBe(-0)
    expect(snap(1234)).toBe(1250)
  })

  it('drag math: pixels → ms on the ruler, snapped and kept within the limits', () => {
    const start = { delay: 200, duration: 600 }
    // 300 px track showing 3000 ms: 10 ms per pixel.
    expect(dragTiming(start, 'move', 32, 300)).toEqual({ delay: 500, duration: 600 })
    expect(dragTiming(start, 'move', 4, 300)).toEqual({ delay: 250, duration: 600 })
    expect(dragTiming(start, 'move', -100, 300)).toEqual({ delay: 0, duration: 600 })
    expect(dragTiming(start, 'move', 1000, 300)).toEqual({ delay: 2000, duration: 600 })
    expect(dragTiming(start, 'resize', 21, 300)).toEqual({ delay: 200, duration: 800 })
    expect(dragTiming(start, 'resize', -100, 300)).toEqual({ delay: 200, duration: 200 })
    expect(dragTiming(start, 'resize', 500, 300)).toEqual({ delay: 200, duration: 2000 })
    // A longer ruler (4 s) moves more ms per pixel.
    expect(dragTiming(start, 'move', 30, 300, 4000)).toEqual({ delay: 600, duration: 600 })
    expect(dragTiming(start, 'move', 30, 0)).toEqual(start)
  })

  it('keyboard: ←/→ move the start, Shift changes the length, Home / End jump', () => {
    const t = { delay: 200, duration: 600 }
    expect(keyTiming(t, 'ArrowRight', false)).toEqual({ delay: 250, duration: 600 })
    expect(keyTiming(t, 'ArrowLeft', false)).toEqual({ delay: 150, duration: 600 })
    expect(keyTiming(t, 'ArrowRight', true)).toEqual({ delay: 200, duration: 650 })
    expect(keyTiming(t, 'ArrowLeft', true)).toEqual({ delay: 200, duration: 550 })
    expect(keyTiming({ delay: 0, duration: 200 }, 'ArrowLeft', false)).toEqual({ delay: 0, duration: 200 })
    expect(keyTiming({ delay: 0, duration: 200 }, 'ArrowLeft', true)).toEqual({ delay: 0, duration: 200 })
    expect(keyTiming(t, 'Home', false)).toEqual({ delay: 0, duration: 600 })
    expect(keyTiming(t, 'End', false)).toEqual({ delay: 2000, duration: 600 })
    expect(keyTiming(t, 'End', true)).toEqual({ delay: 200, duration: 2000 })
    expect(keyTiming(t, 'a', false)).toBeNull()
    expect(keyTiming(t, 'ArrowUp', false)).toBeNull()
    // Off-grid values land on the grid.
    expect(keyTiming({ delay: 130, duration: 610 }, 'ArrowRight', false)).toEqual({ delay: 200, duration: 610 })
    expect(clampTiming({ delay: -5, duration: 5000 })).toEqual({ delay: 0, duration: 2000 })
  })

  it('says each row’s timing for screen readers', () => {
    expect(rowDescription(row())).toBe('Heading: starts 0.20 s, lasts 0.60 s, slide up')
    expect(rowDescription(row({ offset: 150, easing: 'spring', entrance: 'mask-up' }))).toBe('Heading: starts 0.35 s (waits 0.15 s for the parts before it), lasts 0.60 s, wipe up, springy')
    expect(rowDescription(row({ entrance: 'none', label: 'Text' }))).toBe('Text: no entrance')
  })

  it('places bars on the ruler and grows it past 3 s when needed', () => {
    expect(barGeometry(row(), 3000)).toEqual({ left: (200 / 3000) * 100, width: 20, lead: 0 })
    expect(timelineSpan([row()])).toBe(3000)
    expect(timelineSpan([row({ delay: 2000, duration: 1800, offset: 300 })])).toBe(4500)
    expect(timelineSpan([row({ entrance: 'none', delay: 2000, duration: 2000 })])).toBe(3000)
  })

  it('edits keep the other motion settings', () => {
    const content = withMotion(cloneSample(), 'e_heading', { entrance: 'fade', duration: 600, delay: 0, repeat: 'every_time', loop: 'glow' })
    const next = setTiming(content, 'e_heading', { delay: 250, duration: 900 })
    expect(motionOf(next, 'e_heading')).toMatchObject({ entrance: 'fade', duration: 900, delay: 250, repeat: 'every_time', loop: 'glow' })
    const eased = setTiming(next, 'e_heading', { easing: 'bounce' })
    expect(motionOf(eased, 'e_heading')).toMatchObject({ easing: 'bounce', delay: 250 })
    // No entrance: nothing to time.
    expect(setTiming(content, 'e_text', { delay: 100 })).toBe(content)
    expect(setTiming(content, 'missing', { delay: 100 })).toBe(content)
  })

  it('adds a fade-in to a part without an entrance', () => {
    const content = cloneSample()
    const next = addEntrance(content, 'e_text')
    expect(motionOf(next, 'e_text')).toMatchObject({ entrance: 'fade', duration: 600, delay: 0 })
    expect(addEntrance(next, 'e_text')).toBe(next)
  })
})
