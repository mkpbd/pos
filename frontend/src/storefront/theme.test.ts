import { describe, expect, it } from 'vitest'
import { readInlineBootstrap } from './api'
import { bootstrapFixture } from './test-fixtures'
import { applyCssVars, isInternalLink, themeToCssVars } from './theme'

describe('themeToCssVars', () => {
  it('maps colours, fonts, radii and container width to --sf-* variables', () => {
    const theme = bootstrapFixture().theme
    const vars = themeToCssVars(theme)

    expect(vars['--sf-primary']).toBe('#f59e0b')
    expect(vars['--sf-primary-foreground']).toBe('#3b2500')
    expect(vars['--sf-accent-foreground']).toBe('#ffffff')
    expect(vars['--sf-font-heading']).toMatch(/^'Baloo 2 Variable'/)
    expect(vars['--sf-font-body']).toMatch(/^'Poppins'/)
    expect(vars['--sf-radius-button']).toBe('9999px')
    expect(vars['--sf-radius-card']).toBe('12px')
    expect(vars['--sf-container']).toBe('1170px')
  })

  it('supports every button style and the system font choices', () => {
    const base = bootstrapFixture().theme
    const square = themeToCssVars({ ...base, shape: { button_style: 'square', card_radius: 0 }, typography: { heading_font: 'system', body_font: 'system' } })

    expect(square['--sf-radius-button']).toBe('0px')
    expect(square['--sf-radius-card']).toBe('0px')
    expect(square['--sf-font-heading']).toMatch(/^system-ui/)
    expect(square['--sf-font-body']).toMatch(/^system-ui/)
    expect(themeToCssVars({ ...base, shape: { button_style: 'rounded', card_radius: 8 } })['--sf-radius-button']).toBe('0.5rem')
  })

  it('applies variables to an element and removes them again', () => {
    const element = document.createElement('div')
    const remove = applyCssVars(element, { '--sf-primary': '#123456' })
    expect(element.style.getPropertyValue('--sf-primary')).toBe('#123456')
    remove()
    expect(element.style.getPropertyValue('--sf-primary')).toBe('')
  })
})

describe('isInternalLink', () => {
  it('treats site paths as internal and everything else as external', () => {
    expect(isInternalLink('/boys')).toBe(true)
    expect(isInternalLink('//evil.test')).toBe(false)
    expect(isInternalLink('https://blog.example.com')).toBe(false)
  })
})

describe('readInlineBootstrap', () => {
  it('reads the payload written into the page by the server', () => {
    const doc = document.implementation.createHTMLDocument()
    const script = doc.createElement('script')
    script.id = 'storefront-bootstrap'
    script.type = 'application/json'
    script.textContent = JSON.stringify(bootstrapFixture())
    doc.body.appendChild(script)

    expect(readInlineBootstrap(doc)?.store.name).toBe('Berry Kids')
  })

  it('returns nothing when the payload is absent or broken', () => {
    const doc = document.implementation.createHTMLDocument()
    expect(readInlineBootstrap(doc)).toBeUndefined()

    const script = doc.createElement('script')
    script.id = 'storefront-bootstrap'
    script.textContent = '{not json'
    doc.body.appendChild(script)
    expect(readInlineBootstrap(doc)).toBeUndefined()
  })
})
