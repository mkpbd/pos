import { describe, expect, it } from 'vitest'
import { compileStyles, cssUrl } from './compile-styles'
import { BUILDER_LIMITS, elementMeta, NODE_ID } from './registry'
import { cloneSample, IMAGE_MEDIA_ID, sampleDocument, sampleMedia } from './test-payload'
import type { Column, Element, Section } from './types'
import { ENUMS, normalizeColor, normalizeStyle, normalizeWidth, safeLink, safeUrl } from './validate'

type Node = Section | Element

function walk(sections: Section[]): { nodes: Node[]; columns: Column[] } {
  const nodes: Node[] = []
  const columns: Column[] = []
  const visitColumns = (list: Column[]) => {
    for (const column of list) {
      columns.push(column)
      for (const element of column.elements) {
        nodes.push(element)
        if (element.type === 'inner_row') visitColumns(element.columns as Column[])
      }
    }
  }
  for (const section of sections) {
    nodes.push(section)
    visitColumns(section.columns)
  }
  return { nodes, columns }
}

/** A minimal one-section document around the given element style (and optional extras). */
function docWith(style: unknown, extra: Record<string, unknown> = {}) {
  return [
    {
      id: 's_one',
      type: 'section',
      style: {},
      visibility: { desktop: true, tablet: true, mobile: true },
      columns: [{ id: 'c_one', type: 'column', width: { base: 100 }, style: {}, elements: [{ id: 'e_one', type: 'heading', style, ...extra }] }],
    },
  ]
}

describe('the sample document passes the TS mirror of the backend validator unchanged', () => {
  const { nodes, columns } = walk(sampleDocument.sections)

  it('keeps every style value, width and link', () => {
    for (const node of [...nodes, ...columns]) expect(normalizeStyle(node.style), node.id).toEqual(node.style)
    for (const column of columns) expect(normalizeWidth(column.width), column.id).toEqual(column.width)
    for (const node of nodes) {
      if (node.type === 'heading' || node.type === 'image') expect(node.props.link === null || safeLink(node.props.link) !== null, node.id).toBe(true)
      if (node.type === 'button') expect(safeLink(node.props.link), node.id).toBe(node.props.link.url)
      if (node.type === 'divider') {
        expect(normalizeColor(node.props.color)).toBe(node.props.color)
        expect(ENUMS.dividerLine).toContain(node.props.line)
        expect(ENUMS.dividerAlign).toContain(node.props.align)
      }
    }
  })

  it('has valid, unique ids, known types and translations of translatable props only, within the limits', () => {
    const ids = [...nodes, ...columns].map((node) => node.id)
    expect(ids.every((id) => NODE_ID.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(sampleDocument.sections.length).toBeLessThanOrEqual(BUILDER_LIMITS.sections)
    expect(ids.length).toBeLessThanOrEqual(BUILDER_LIMITS.nodes)
    for (const node of nodes) {
      if (node.type === 'section') continue
      const meta = elementMeta(node.type)
      expect(meta, node.type).toBeDefined()
      expect(Object.keys(node.props).sort(), node.id).toEqual(Object.keys(meta!.props).sort())
      for (const texts of Object.values(node.translations)) for (const key of Object.keys(texts)) expect(meta!.translatable, `${node.id}.${key}`).toContain(key)
    }
  })
})

describe('compileStyles', () => {
  it('compiles the sample document (snapshot)', () => {
    expect(compileStyles(sampleDocument.sections, { media: sampleMedia })).toMatchSnapshot()
  })

  it('maps theme colours and fonts to the theme variables', () => {
    const css = compileStyles(
      docWith({ base: { color: 'theme:accent_foreground', typography: { font: 'theme:heading' }, background: { type: 'color', color: 'theme:primary_foreground' } } }),
    )
    expect(css).toContain('[data-b="e_one"]{background-color:var(--sf-primary-foreground);background-image:none;color:var(--sf-accent-foreground);font-family:var(--sf-font-heading)}')
    expect(compileStyles(docWith({ base: { typography: { font: 'theme:body' } } }))).toContain('font-family:var(--sf-font-body)')
  })

  it('writes desktop rules first, then the tablet and mobile overrides in their media queries', () => {
    const css = compileStyles(sampleDocument.sections, { media: sampleMedia })
    const base = css.indexOf('[data-b="e_heading"]{color:var(--sf-heading)')
    const tablet = css.indexOf('@media (max-width: 1023px){')
    const mobile = css.indexOf('@media (max-width: 639px){')
    expect(base).toBeGreaterThanOrEqual(0)
    expect(tablet).toBeGreaterThan(base)
    expect(mobile).toBeGreaterThan(tablet)
    const mobileBlock = css.slice(mobile, css.indexOf('\n}', mobile))
    expect(mobileBlock).toContain('[data-b="e_heading"]{font-size:28px;text-align:center}')
    expect(mobileBlock).toContain('[data-b-row="s_story"]{--b-gap:16px}')
    expect(mobileBlock).toContain('[data-b="e_button"]{width:100%}')
    // Columns: their share of the row minus their share of the gaps, per breakpoint.
    expect(css).toContain('[data-b="c_story_text"]{flex:0 1 calc(50% - var(--b-gap) * 0.5)}')
    expect(mobileBlock).toContain('[data-b="c_story_text"]{flex:0 1 100%}')
    expect(css).toContain('[data-b="c_feat_a"]{flex:0 1 calc(33.33% - var(--b-gap) * 0.6667);')
  })

  it('hides a node per device in exactly that range', () => {
    const css = compileStyles(docWith({}, { visibility: { desktop: false, tablet: false, mobile: false } }))
    expect(css).toContain('@media (max-width: 639px){\n  [data-b="e_one"]{display:none}\n}')
    expect(css).toContain('@media (min-width: 1024px){\n  [data-b="e_one"]{display:none}\n}')
    expect(css).toContain('@media (min-width: 640px) and (max-width: 1023px){\n  [data-b="e_one"]{display:none}\n}')
    const sample = compileStyles(sampleDocument.sections)
    expect(sample.indexOf('  [data-b="e_spacer"]{display:none}\n}')).toBeGreaterThan(sample.indexOf('@media (max-width: 639px){'))
    expect(sample.match(/display:none/g)).toHaveLength(1)
    expect(compileStyles(docWith({}))).not.toContain('display:none')
  })

  it('adds hover and focus rules with a transition that reduced motion turns off', () => {
    const css = compileStyles(sampleDocument.sections)
    expect(css).toContain('[data-b="e_button"]:hover,[data-b="e_button"]:focus-visible{color:var(--sf-accent-foreground);background-color:var(--sf-accent);transform:translateY(-2px)}')
    expect(css).toMatch(/\[data-b="e_button"\]\{[^}]*transition:color 0\.2s ease,background-color 0\.2s ease,box-shadow 0\.2s ease,transform 0\.2s ease/)
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce){\n  [data-b="e_button"]{transition:none}\n  [data-b="e_button"]:hover,[data-b="e_button"]:focus-visible{transform:none}\n}',
    )
    // No hover → no transition.
    expect(compileStyles(docWith({ base: { color: '#112233' } }))).not.toContain('transition')
  })

  it('compiles gradients, shadows and overlays from their structured values', () => {
    const css = compileStyles(
      docWith({
        base: {
          background: {
            type: 'image',
            image: { media_id: IMAGE_MEDIA_ID, position: 'top-left', size: 'cover', repeat: false },
            overlay: { type: 'radial', shape: 'circle', stops: [{ color: '#00000080', position: 0 }, { color: 'theme:canvas', position: 100 }] },
          },
          effects: { shadow: [{ x: 0, y: 4, blur: 8, spread: -2, color: '#00000033', inset: true }], text_shadow: [{ x: 1, y: 1, blur: 2, spread: 0, color: '#000000', inset: false }] },
        },
      }),
      { media: sampleMedia },
    )
    expect(css).toContain(
      'background-image:radial-gradient(circle, #00000080 0%, var(--sf-canvas) 100%), url("/storage/media/o/vegetables.jpg");background-position:left top;background-size:cover;background-repeat:no-repeat',
    )
    expect(css).toContain('box-shadow:inset 0px 4px 8px -2px #00000033;text-shadow:1px 1px 2px #000000')
    expect(compileStyles(docWith({ base: { background: { type: 'color', color: '#ffffff', overlay: '#00000040' } } }))).toContain(
      'background-color:#ffffff;background-image:linear-gradient(#00000040, #00000040)',
    )
  })
})

describe('compileStyles drops what is not valid (defence in depth)', () => {
  it('drops unknown keys, unknown breakpoints and invalid values', () => {
    const css = compileStyles(
      docWith({
        base: {
          color: 'red',
          position: 'fixed',
          typography: { size: '20px', weight: 450, line_height: 9, font: 'Comic Sans', align: 'middle' },
          spacing: { padding: { top: '-4px', left: '12px' }, margin: { top: 'auto', bottom: '3000px' } },
          border: { width: '30px', style: 'groove', color: '#12345', radius: { tl: '8px', tr: 'calc(1px)' } },
          effects: { opacity: 2, shadow: [{ x: 500, y: 0, blur: 0, spread: 0, color: '#000000', inset: false }] },
        },
        wide: { color: '#000000' },
      }),
    )
    expect(css).toBe('[data-b="c_one"]{flex:0 1 100%}\n[data-b="e_one"]{font-size:20px;margin-top:auto;padding-left:12px;border-top-left-radius:8px}')
  })

  it('refuses out-of-range lengths and lengths in the wrong unit', () => {
    const css = compileStyles(
      docWith({ base: { size: { width: '2001px', height: '101vh', max_width: '100rem', min_height: '-1px' }, typography: { letter_spacing: '2rem', size: '12.345px' }, border: { width: '2em' } } }),
    )
    expect(css).toContain('[data-b="e_one"]{max-width:100rem}')
    expect(css).not.toMatch(/2001px|101vh|-1px|2rem|12\.345px|2em/)
  })

  it('never lets a value close the rule or the style element', () => {
    const hostile = [
      '</style><script>alert(1)</script>',
      '#fff;}body{display:none',
      'theme:primary}',
      '10px}</style>',
      'expression(alert(1))',
      'url(javascript:alert(1))',
    ]
    const css = compileStyles(
      docWith({
        base: {
          color: hostile[0],
          background: { type: 'color', color: hostile[1], overlay: hostile[2] },
          spacing: { margin: { top: hostile[3], left: hostile[4] } },
          typography: { size: hostile[5] },
          border: { color: hostile[1], radius: { tl: hostile[3] } },
        },
      }),
    )
    expect(css).not.toMatch(/<|alert|expression|javascript|url\(/i)
    for (const rule of css.split('\n')) expect(rule.match(/[{}]/g)?.length ?? 0, rule).toBeLessThanOrEqual(2)
  })

  it('uses url() only for media from the payload, quoted and escaped', () => {
    const image = { media_id: IMAGE_MEDIA_ID, position: 'center', size: 'cover', repeat: true }
    // Not in the media map: no url() at all.
    expect(compileStyles(docWith({ base: { background: { type: 'image', image } } }))).not.toContain('url(')
    // A hostile URL in the media map is escaped inside the quotes; a javascript: URL is refused.
    const hostile = compileStyles(docWith({ base: { background: { type: 'image', image } } }), { media: { [IMAGE_MEDIA_ID]: { url: '/a")}</style>{(x).jpg' } } })
    expect(hostile).toContain('background-image:url("/a%22%29%7D%3C/style%3E%7B%28x%29.jpg")')
    expect(compileStyles(docWith({ base: { background: { type: 'image', image } } }), { media: { [IMAGE_MEDIA_ID]: { url: 'javascript:alert(1)' } } })).not.toContain('url(')
    expect(cssUrl('//evil.example/x.png')).toBeUndefined()
    expect(cssUrl('https://cdn.example/x y.png')).toBe('url("https://cdn.example/x%20y.png")')
  })

  it('skips nodes whose id is not a valid builder id', () => {
    expect(compileStyles([{ id: 'x"]{}*{color:red', type: 'section', style: { base: { color: '#000000' } }, columns: [] }])).toBe('')
  })
})

describe('links', () => {
  it('accepts site paths and http(s) URLs only', () => {
    expect(safeUrl('/shop?sort=popularity')).toBe('/shop?sort=popularity')
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a')
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', 'shop', ' /shop', 'vbscript:x', '']) expect(safeUrl(bad), bad).toBeNull()
    expect(safeLink({ url: 'javascript:alert(1)' })).toBeNull()
    expect(safeLink(null)).toBeNull()
  })

  it('normalizes colours to lower case and refuses unknown theme roles', () => {
    expect(normalizeColor('#FEF3C7')).toBe('#fef3c7')
    expect(normalizeColor('theme:link')).toBeUndefined()
    expect(normalizeColor('rgb(0,0,0)')).toBeUndefined()
  })

  it('keeps a valid copy of the sample untouched by normalizing it', () => {
    const copy = cloneSample()
    for (const section of copy.sections) section.style = normalizeStyle(section.style)
    expect(copy).toEqual(sampleDocument)
  })
})
