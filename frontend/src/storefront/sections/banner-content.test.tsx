import { render, screen } from '@testing-library/react'
import type { StoreBanner } from '../types'
import { contrastRatio, isLightColor, legibleOn } from '../color'
import { BannerScrim } from './banner-content'

const banner = (overrides: Partial<StoreBanner> = {}) => ({ title: 'Fresh', text_color: '#ffffff', text_position: 'left', ...overrides }) as StoreBanner

describe('isLightColor', () => {
  it.each([
    ['#ffffff', true],
    ['#fff', true],
    ['#fbf8ef', true],
    ['#000000', false],
    ['#1b3a1f', false],
    ['#3a2c00', false],
    ['not-a-colour', true],
    [null, true],
  ])('%s → %s', (color, light) => {
    expect(isLightColor(color)).toBe(light)
  })
})

describe('contrastRatio / legibleOn', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#111111', '#111111')).toBe(1)
    expect(contrastRatio('#111', '#000000')).toBeLessThan(1.5)
    expect(contrastRatio('nope', '#000000')).toBeNull()
  })

  it('picks the first candidate that stands out, else the best one', () => {
    expect(legibleOn('#111111', ['#111111', '#ffffff'])).toBe('#ffffff')
    expect(legibleOn('#1e3a24', ['#f6c445', '#ffffff'])).toBe('#f6c445')
    expect(legibleOn('#ffffff', ['#eeeeee', '#dddddd'])).toBe('#dddddd')
    expect(legibleOn('#000000', ['bogus', '#222222'])).toBe('#222222')
  })
})

describe('BannerScrim', () => {
  it('darkens behind light text, from the text side', () => {
    render(<BannerScrim banner={banner()} from="left" />)
    const scrim = screen.getByTestId('banner-scrim')
    expect(scrim).toHaveAttribute('aria-hidden', 'true')
    expect(scrim.style.background).toContain('to right')
    expect(scrim.style.background).toContain('rgba(0, 0, 0, 0.7)')
  })

  it('lightens behind dark text and centres on centred text', () => {
    render(<BannerScrim banner={banner({ text_color: '#1b3a1f' })} from="center" />)
    const { background } = screen.getByTestId('banner-scrim').style
    expect(background).toContain('radial-gradient')
    expect(background).toContain('rgba(255, 255, 255, 0.55)')
  })

  it('renders nothing for an image-only banner', () => {
    render(<BannerScrim banner={banner({ title: null })} from="bottom" />)
    expect(screen.queryByTestId('banner-scrim')).toBeNull()
  })
})
