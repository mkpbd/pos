import { cloneSample } from '@/storefront/builder/test-payload'
import type { Section } from '@/storefront/builder/types'
import { columnGuides, keyboardColumnLeft, snapColumnLeft, snapSpacingValue, spacingDrag, spacingGuides } from './snapping'
import { setSpacing } from './spacing-drag'

describe('spacing snapping (B12 §3)', () => {
  it('snaps to a neighbour value within 6 px, then to steps, else to the 4 px grid; Alt is free', () => {
    const guides = [{ value: 50, label: 'Same as the section above' }]
    expect(snapSpacingValue(53, guides)).toEqual({ value: 50, guide: guides[0] })
    // 48 px step and the 50 px neighbour are both near: the nearest wins.
    expect(snapSpacingValue(48.5, guides).value).toBe(48)
    expect(snapSpacingValue(49.5, guides).value).toBe(50)
    expect(snapSpacingValue(21, []).guide?.label).toBe('24 px step')
    expect(snapSpacingValue(101, [])).toEqual({ value: 100, guide: null })
    expect(snapSpacingValue(101, [], true)).toEqual({ value: 101, guide: null })
    expect(snapSpacingValue(-30, [], true).value).toBe(0)
    expect(snapSpacingValue(9999, []).value).toBe(400)
    // The grid can land on a neighbour value: its guide shows.
    expect(snapSpacingValue(120, [{ value: 120, label: 'Same as the top' }]).guide?.label).toBe('Same as the top')
  })

  it('drags in the right direction', () => {
    expect(spacingDrag(48, 8, 'padding', 'bottom', []).value).toBe(56)
    expect(spacingDrag(0, -21, 'margin', 'top', []).value).toBe(24)
    expect(spacingDrag(8, -30, 'padding', 'top', []).value).toBe(0)
  })

  it('reads the neighbours: the section above and below and the other side', () => {
    let content = cloneSample()
    content = setSpacing(content, 's_story', 'base', 'padding', 'top', 72)
    content = setSpacing(content, 's_products', 'base', 'padding', 'top', 40)
    const guides = spacingGuides(content, 's_features', 'base').filter((g) => g.box === 'padding' && g.side === 'top')
    expect(guides).toEqual([
      { box: 'padding', side: 'top', value: 72, label: 'Same as the section above' },
      { box: 'padding', side: 'top', value: 40, label: 'Same as the section below' },
      { box: 'padding', side: 'top', value: 48, label: 'Same as the bottom' },
    ])
    // Per device: the phone value of the section above.
    const phone = setSpacing(content, 's_story', 'mobile', 'padding', 'top', 16)
    expect(spacingGuides(phone, 's_features', 'mobile').find((g) => g.box === 'padding' && g.side === 'top')?.value).toBe(16)
    // Columns: the column on the left / right.
    const columns = spacingGuides(content, 'c_feat_b', 'base').filter((g) => g.box === 'padding' && g.side === 'top')
    expect(columns[0]).toEqual({ box: 'padding', side: 'top', value: 24, label: 'Same as the column on the left' })
    expect(spacingGuides(content, 'nope', 'base')).toEqual([])
  })

  it('skips values that can’t be dragged (%) and repeats', () => {
    const content = cloneSample()
    const story = content.sections[1] as Section
    story.style = { base: { spacing: { padding: { top: '10%' } } } }
    const guides = spacingGuides(content, 's_features', 'base').filter((g) => g.box === 'padding' && g.side === 'top')
    // Above: % (skipped); below: unset = 0; the other side: 48.
    expect(guides.map((g) => g.value)).toEqual([0, 48])
  })
})

describe('column snapping (B12 §3)', () => {
  it('snaps to shares of the row and the other columns’ widths', () => {
    expect(snapColumnLeft([50, 50], 0, 34)).toEqual({ value: 33.33, guide: { value: 33.33, label: '1/3 of the row' } })
    expect(snapColumnLeft([50, 50], 0, 66)).toEqual({ value: 66.67, guide: { value: 66.67, label: '2/3 of the row' } })
    expect(snapColumnLeft([50, 50], 0, 51).guide?.label).toBe('1/2 of the row')
    // Away from guides: 5 % steps.
    expect(snapColumnLeft([50, 50], 0, 56.9)).toEqual({ value: 55, guide: null })
    // Alt: 1 % steps.
    expect(snapColumnLeft([50, 50], 0, 33.6, true)).toEqual({ value: 34, guide: null })
    // Kept inside the pair.
    expect(snapColumnLeft([30, 30, 40], 0, 70).value).toBe(55)
    expect(snapColumnLeft([30, 30, 40], 0, 39.2)).toEqual({ value: 40, guide: { value: 40, label: 'Same as column 3' } })
    expect(columnGuides([25, 25, 50], 0)[0]).toEqual({ value: 50, label: 'Same as column 3' })
  })

  it('keyboard steps go to the next 5 % mark', () => {
    expect(keyboardColumnLeft([33.33, 66.67], 0, 1)).toBe(35)
    expect(keyboardColumnLeft([33.33, 66.67], 0, -1)).toBe(30)
    expect(keyboardColumnLeft([50, 50], 0, 1)).toBe(55)
    expect(keyboardColumnLeft([50, 50], 0, -1)).toBe(45)
    expect(keyboardColumnLeft([5, 95], 0, -1)).toBe(5)
  })
})
