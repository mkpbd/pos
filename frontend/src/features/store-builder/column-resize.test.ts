import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Column, ResponsiveStyle } from '@/storefront/builder/types'
import { resetColumnWidth, resizeColumns, resizePair, rowWidths, setColumnWidth, sideBySide, snapPercent } from './column-resize'
import { effectiveGroup, resolveStyleValue, styleIsValid, widthAt, writeStyleValue } from './inspector/style-model'
import { findNode } from './tree'

const columnsOf = (content: BuilderContent, sectionId: string) => (findNode(content, sectionId)!.node as { columns: Column[] }).columns

describe('per-device style values', () => {
  const style: ResponsiveStyle = {
    base: { typography: { size: '40px', weight: 800 }, spacing: { padding: { top: '64px', bottom: '64px' } } },
    tablet: { typography: { size: '32px' } },
    mobile: { spacing: { padding: { top: '32px' } } },
  }

  it('resolves the narrowest breakpoint that sets a value and says where it comes from', () => {
    expect(resolveStyleValue(style, 'base', ['typography', 'size'])).toEqual({ value: '40px', origin: { kind: 'here' } })
    expect(resolveStyleValue(style, 'tablet', ['typography', 'size'])).toEqual({ value: '32px', origin: { kind: 'here' } })
    expect(resolveStyleValue(style, 'mobile', ['typography', 'size'])).toEqual({ value: '32px', origin: { kind: 'inherited', from: 'tablet' } })
    expect(resolveStyleValue(style, 'mobile', ['typography', 'weight'])).toEqual({ value: 800, origin: { kind: 'inherited', from: 'base' } })
    expect(resolveStyleValue(style, 'mobile', ['color'])).toEqual({ value: undefined, origin: { kind: 'default' } })
    expect(effectiveGroup(style, 'mobile', ['spacing', 'padding'])).toEqual({ top: '32px', bottom: '64px' })
  })

  it('writes sparse overrides at one breakpoint and prunes empty groups', () => {
    const next = writeStyleValue(style, 'mobile', ['typography', 'size'], '24px')
    expect(next.mobile).toEqual({ spacing: { padding: { top: '32px' } }, typography: { size: '24px' } })
    expect(next.base).toBe(style.base)
    const reset = writeStyleValue(writeStyleValue(next, 'mobile', ['typography', 'size'], undefined), 'mobile', ['spacing', 'padding', 'top'], undefined)
    expect(reset.mobile).toBeUndefined()
    expect(reset.tablet).toEqual(style.tablet)
  })

  it('checks a style against the validator (order of keys does not matter)', () => {
    expect(styleIsValid(style)).toBe(true)
    expect(styleIsValid({ base: { typography: { size: '12parsecs' } } } as unknown as ResponsiveStyle)).toBe(false)
    expect(styleIsValid({ mobile: { color: 'red' } })).toBe(false)
    expect(styleIsValid({ base: { color: '#ffffff', background: { type: 'color', color: '#000000' } } })).toBe(true)
  })

  it('column widths fall back to the wider device', () => {
    expect(widthAt({ base: 50, mobile: 100 }, 'tablet')).toEqual({ value: 50, origin: { kind: 'inherited', from: 'base' } })
    expect(widthAt({ base: 50, mobile: 100 }, 'mobile')).toEqual({ value: 100, origin: { kind: 'here' } })
  })
})

describe('column resize maths', () => {
  it('snaps to 5 % and keeps the pair total, each at least 5 %', () => {
    expect(snapPercent(47.4)).toBe(45)
    expect(snapPercent(47.6)).toBe(50)
    expect(resizePair([50, 50], 0, 61)).toEqual([60, 40])
    expect(resizePair([50, 50], 0, 99)).toEqual([95, 5])
    expect(resizePair([50, 50], 0, -20)).toEqual([5, 95])
    expect(resizePair([33.33, 33.33, 33.34], 1, 40)).toEqual([40, 26.67])
    expect(resizePair([50, 50], 1, 40)).toBeNull()
    expect(resizePair([100, 100], 0, 40)).toBeNull()
    expect(sideBySide([50, 50], 0)).toBe(true)
    expect(sideBySide([100, 100], 0)).toBe(false)
  })

  it('drags a divider at one breakpoint only', () => {
    const content = cloneSample()
    const next = resizeColumns(content, 's_story', 0, 62, 'base')
    expect(rowWidths(columnsOf(next, 's_story'), 'base')).toEqual([60, 40])
    // Tablet and mobile kept their own widths.
    expect(columnsOf(next, 's_story').map((c) => c.width)).toEqual([
      { base: 60, tablet: 50, mobile: 100 },
      { base: 40, tablet: 50, mobile: 100 },
    ])
    const tablet = resizeColumns(content, 's_story', 0, 30, 'tablet')
    expect(columnsOf(tablet, 's_story').map((c) => c.width.tablet)).toEqual([30, 70])
    expect(columnsOf(tablet, 's_story').map((c) => c.width.base)).toEqual([50, 50])
    // Stacked on mobile (100 + 100): no pair to resize.
    expect(resizeColumns(content, 's_story', 0, 40, 'mobile')).toBe(content)
  })

  it('a width typed in the inspector: the neighbour adjusts; 100 % stacks without touching it', () => {
    const content = cloneSample()
    const next = setColumnWidth(content, 'c_story_text', 'tablet', 70)
    expect(columnsOf(next, 's_story').map((c) => c.width.tablet)).toEqual([70, 30])
    const last = setColumnWidth(content, 'c_story_media', 'base', 25)
    expect(columnsOf(last, 's_story').map((c) => c.width.base)).toEqual([75, 25])
    const tooWide = setColumnWidth(content, 'c_story_text', 'base', 98)
    expect(columnsOf(tooWide, 's_story').map((c) => c.width.base)).toEqual([95, 5])
    const full = setColumnWidth(content, 'c_story_text', 'tablet', 100)
    expect(columnsOf(full, 's_story').map((c) => c.width.tablet)).toEqual([100, 50])
    const reset = resetColumnWidth(full, 'c_story_text', 'tablet')
    expect(columnsOf(reset, 's_story')[0]!.width).toEqual({ base: 50, mobile: 100 })
  })
})
