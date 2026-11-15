import { cloneSample } from '@/storefront/builder/test-payload'
import type { Element, ResponsiveStyle, Section } from '@/storefront/builder/types'
import { checkDocument } from './check'
import { setNodeStyleValue } from './quick-style'
import { draggedSpacing, hasSpacingHandles, lengthToPx, setSpacing, snapSpacing, spacingAt } from './spacing-drag'
import { findNode } from './tree'

const style = (content: ReturnType<typeof cloneSample>, id: string) => (findNode(content, id)!.node as Section).style as ResponsiveStyle

describe('spacing handles (B10)', () => {
  it('reads px, rem and em; % can’t be dragged; unset is 0', () => {
    expect(lengthToPx(undefined)).toBe(0)
    expect(lengthToPx('24px')).toBe(24)
    expect(lengthToPx('1.5rem')).toBe(24)
    expect(lengthToPx('10%')).toBeNull()
    expect(lengthToPx('auto')).toBeNull()
    expect(snapSpacing(13)).toBe(12)
    expect(snapSpacing(-20)).toBe(0)
    expect(snapSpacing(9999)).toBe(400)
  })

  it('drags: the bottom edge and top padding grow downwards, the top margin grows upwards', () => {
    expect(draggedSpacing(48, 8, 'padding', 'bottom')).toBe(56)
    expect(draggedSpacing(48, 7, 'padding', 'top')).toBe(56)
    expect(draggedSpacing(0, -21, 'margin', 'top')).toBe(20)
    expect(draggedSpacing(8, -30, 'padding', 'top')).toBe(0)
  })

  it('writes the device’s breakpoint only, as px; the document stays valid', () => {
    const content = cloneSample()
    expect(hasSpacingHandles(findNode(content, 's_features')!.node)).toBe(true)
    expect(hasSpacingHandles(findNode(content, 'e_row')!.node)).toBe(true)
    expect(hasSpacingHandles(findNode(content, 'c_features')!.node)).toBe(true)
    expect(hasSpacingHandles(findNode(content, 'e_heading')!.node)).toBe(false)

    expect(spacingAt(style(content, 's_features'), 'mobile', 'padding', 'top')).toBe(48)
    const phone = setSpacing(content, 's_features', 'mobile', 'padding', 'top', 20.4)
    expect(style(phone, 's_features').mobile?.spacing?.padding?.top).toBe('20px')
    expect(style(setSpacing(content, 's_features', 'mobile', 'padding', 'top', 999), 's_features').mobile?.spacing?.padding?.top).toBe('400px')
    expect(style(phone, 's_features').base?.spacing?.padding?.top).toBe('48px')
    expect(spacingAt(style(phone, 's_features'), 'mobile', 'padding', 'top')).toBe(20)
    expect(spacingAt(style(phone, 's_features'), 'base', 'padding', 'top')).toBe(48)
    expect(checkDocument(phone)).toEqual([])

    const margin = setSpacing(content, 'c_features', 'base', 'margin', 'bottom', 32)
    expect(style(margin, 'c_features').base?.spacing?.margin?.bottom).toBe('32px')
    // The same value again changes nothing.
    expect(setSpacing(margin, 'c_features', 'base', 'margin', 'bottom', 32)).toBe(margin)
  })
})

describe('quick bar styles (B10)', () => {
  it('sets alignment and colour on one device; refuses invalid values; undefined resets', () => {
    const content = cloneSample()
    const centred = setNodeStyleValue(content, 'e_heading', 'tablet', ['typography', 'align'], 'center')
    const heading = findNode(centred, 'e_heading')!.node as Element
    expect(heading.style.tablet?.typography?.align).toBe('center')
    expect(heading.style.base?.typography?.align).toBe('left')
    expect(checkDocument(centred)).toEqual([])

    const coloured = setNodeStyleValue(centred, 'e_heading', 'tablet', ['color'], 'theme:primary')
    expect((findNode(coloured, 'e_heading')!.node as Element).style.tablet?.color).toBe('theme:primary')
    expect(setNodeStyleValue(coloured, 'e_heading', 'tablet', ['color'], 'red')).toBe(coloured)

    const reset = setNodeStyleValue(coloured, 'e_heading', 'tablet', ['color'], undefined)
    expect((findNode(reset, 'e_heading')!.node as Element).style.tablet?.color).toBeUndefined()
  })
})
