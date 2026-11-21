import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Section } from '@/storefront/builder/types'
import { applyMotionTheme, hasMotion, heroHeadingId, isOwnMotion, leadSectionIds, MAX_LOOPS_PER_SECTION, MOTION_THEME_IDS, movingCount, themeAspects } from './motion-themes'
import { findNode } from './tree'

type Obj = Record<string, unknown>

const base = (content: BuilderContent, id: string): Obj => ((findNode(content, id)!.node as unknown as { style: { base?: Obj } }).style.base ?? {}) as Obj
const motion = (content: BuilderContent, id: string) => base(content, id).motion as Obj | undefined
const props = (content: BuilderContent, id: string) => (findNode(content, id)!.node as unknown as { props: Obj }).props

function withMotion(content: BuilderContent, id: string, value: Obj, key: 'motion' | 'hover' | 'scroll' = 'motion'): BuilderContent {
  const node = findNode(content, id)!.node as unknown as { style: { base?: Obj } }
  node.style.base = { ...(node.style.base ?? {}), [key]: value }
  return content
}

/** A hero section whose first part is a heading and a picture (the LCP section). */
function heroFirst(): BuilderContent {
  const content = cloneSample()
  const hero = content.sections[0]!
  hero.columns[0]!.elements = [
    { id: 'e_hero_h', type: 'heading', props: { text: 'Eid sale', level: 1, link: null }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} },
    { id: 'e_hero_img', type: 'image', props: { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} },
    { id: 'e_hero_cta', type: 'cta', props: { title: 'Shop now', text: '', primary: { label: 'Go', link: { url: '/shop' } }, secondary: null, align: 'left' }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} },
    { id: 'e_hero_text', type: 'text', props: { html: '<p>Up to 50% off</p>' }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} },
  ] as unknown as Section['columns'][number]['elements']
  return content
}

describe('motion themes (B18 §4)', () => {
  it('sets motion by role and labels the document', () => {
    const { content, changed } = applyMotionTheme(cloneSample(), 'lively')
    expect(content.motion_theme).toBe('lively')
    expect(changed).toBeGreaterThan(0)
    expect(motion(content, 'e_heading')).toMatchObject({ entrance: 'slide-up', easing: 'spring' })
    expect(motion(content, 'e_image')).toMatchObject({ entrance: 'zoom' })
    expect(base(content, 'e_button').hover).toEqual({ effect: 'pop' })
    expect(props(content, 'e_grid').card_hover).toBe('tilt_3d')
    expect(motion(content, 's_story')).toMatchObject({ entrance: 'none', stagger_children: 100, easing: 'spring' })
    // The page's first heading (outside the LCP section, which has a slider) appears word by word.
    expect(props(content, 'e_heading').text_effect).toEqual({ type: 'reveal_words' })
    expect(props(content, 'e_feat_a').text_effect).toBeUndefined()
  })

  it.each(MOTION_THEME_IDS)('%s is idempotent: applying it again changes nothing', (theme) => {
    const once = applyMotionTheme(cloneSample(), theme).content
    const twice = applyMotionTheme(once, theme)
    expect(twice.content).toBe(once)
    expect(twice.changed).toBe(0)
  })

  it('keeps my own animations by default, and replaces them when asked', () => {
    const content = withMotion(cloneSample(), 'e_heading', { entrance: 'rotate-in', duration: 1200, delay: 300 })
    const kept = applyMotionTheme(content, 'premium')
    expect(motion(kept.content, 'e_heading')).toEqual({ entrance: 'rotate-in', duration: 1200, delay: 300 })
    expect(kept.kept).toBe(1)
    expect(motion(kept.content, 'e_feat_a')).toMatchObject({ entrance: 'mask-up' })

    const replaced = applyMotionTheme(content, 'premium', { keepOwn: false })
    expect(motion(replaced.content, 'e_heading')).toMatchObject({ entrance: 'mask-up', duration: 900 })
    expect(replaced.kept).toBe(0)
  })

  it('switching themes replaces the last theme’s motion but still keeps own motion', () => {
    const own = withMotion(cloneSample(), 'e_text', { entrance: 'blur-in', duration: 700, delay: 0 })
    const calm = applyMotionTheme(own, 'calm').content
    expect(motion(calm, 'e_heading')).toMatchObject({ entrance: 'fade', easing: 'gentle' })
    const festive = applyMotionTheme(calm, 'festive').content
    expect(festive.motion_theme).toBe('festive')
    expect(motion(festive, 'e_heading')).toMatchObject({ entrance: 'bounce-in', easing: 'bounce' })
    expect(base(festive, 'e_button').hover).toEqual({ effect: 'pop' })
    expect(motion(festive, 'e_button')).toEqual({ entrance: 'none', loop: 'shine' })
    expect(motion(festive, 'e_text')).toEqual({ entrance: 'blur-in', duration: 700, delay: 0 })
    // A part the owner changed after the theme counts as their own.
    const tweaked = withMotion(structuredClone(festive), 'e_heading', { entrance: 'bounce-in', duration: 1500, delay: 0, easing: 'bounce' })
    expect(isOwnMotion(findNode(tweaked, 'e_heading')!.node as unknown as Obj, 'festive')).toBe(true)
    expect(motion(applyMotionTheme(tweaked, 'minimal').content, 'e_heading')).toMatchObject({ duration: 1500 })
  })

  it('never gives the first section, its pictures or headings an entrance (LCP)', () => {
    for (const theme of MOTION_THEME_IDS) {
      const content = applyMotionTheme(heroFirst(), theme).content
      expect(motion(content, 's_hero')?.entrance ?? 'none').toBe('none')
      for (const id of ['e_hero_h', 'e_hero_img', 'e_hero_cta']) expect(motion(content, id)?.entrance ?? 'none').toBe('none')
      // The hero slider is never animated in.
      expect(motion(applyMotionTheme(cloneSample(), theme).content, 'e_slider')).toBeUndefined()
    }
    // Other parts of the first section may move.
    expect(motion(applyMotionTheme(heroFirst(), 'lively').content, 'e_hero_text')).toMatchObject({ entrance: 'slide-up' })
    // The hero heading is the likely LCP only without a picture there; with the picture it may get the text effect.
    expect(props(applyMotionTheme(heroFirst(), 'festive').content, 'e_hero_h').text_effect).toEqual({ type: 'reveal_words' })
  })

  it('a hero heading alone in the first section stays still', () => {
    const content = heroFirst()
    content.sections[0]!.columns[0]!.elements = content.sections[0]!.columns[0]!.elements.filter((e) => e.id !== 'e_hero_img')
    expect(heroHeadingId(content)).toBeNull()
    expect(props(applyMotionTheme(content, 'lively').content, 'e_hero_h').text_effect).toBeUndefined()
  })

  it('the first section is the first one shown on any device (device order, hidden ones skipped)', () => {
    const content = cloneSample()
    expect([...leadSectionIds(content)]).toEqual(['s_hero'])
    content.device_order = { mobile: { root: ['s_story', 's_hero', 's_features', 's_products', 's_hidden'] } }
    expect(leadSectionIds(content)).toEqual(new Set(['s_hero', 's_story']))
    const applied = applyMotionTheme(content, 'premium').content
    expect(motion(applied, 'e_heading')?.entrance ?? 'none').toBe('none')
    expect(motion(applied, 'e_image')?.entrance ?? 'none').toBe('none')
    content.sections[0]!.hidden = true
    content.device_order = undefined
    expect([...leadSectionIds(content)]).toEqual(['s_story'])
  })

  it('a first section that is a global section reference protects nothing here and is not touched', () => {
    const content = cloneSample()
    ;(content.sections as unknown[]).unshift({ id: 'g1', type: 'global_section', ref: 'glob', hidden: false, schedule: null })
    expect(leadSectionIds(content).size).toBe(0)
    const applied = applyMotionTheme(content, 'calm').content
    expect(applied.sections[0]).toBe(content.sections[0])
  })

  it('animates existing dividers for Lively and Festive only', () => {
    const content = cloneSample()
    ;(content.sections[1]!.props as Obj).shape_bottom = { shape: 'wave', color: '#ffffff', height: 60, flip: false }
    const lively = applyMotionTheme(content, 'lively').content
    expect(props(lively, 's_story').shape_bottom).toEqual({ shape: 'wave', color: '#ffffff', height: 60, flip: false, animate: 'flow' })
    expect(props(lively, 's_story').shape_top).toBeUndefined()
    const premium = applyMotionTheme(lively, 'premium').content
    expect(props(premium, 's_story').shape_bottom).toEqual({ shape: 'wave', color: '#ffffff', height: 60, flip: false })
  })

  it('stays under the loop limits: at most 6 looping parts per section, never forever', () => {
    const content = cloneSample()
    const buttons = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, type: 'button', props: { label: 'Buy', link: null }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }))
    content.sections[3]!.columns[0]!.elements.push(...(buttons as unknown as Section['columns'][number]['elements']))
    withMotion(content, 'b0', { entrance: 'none', loop: 'pulse' })
    const applied = applyMotionTheme(content, 'festive').content
    const looping = buttons.filter((b) => (motion(applied, b.id)?.loop ?? 'none') !== 'none')
    expect(looping).toHaveLength(MAX_LOOPS_PER_SECTION)
    expect(motion(applied, 'b0')).toEqual({ entrance: 'none', loop: 'pulse' })
    expect(JSON.stringify(applied)).not.toContain('loop_forever')
    // Still idempotent with the cap.
    expect(applyMotionTheme(applied, 'festive').content).toBe(applied)
  })

  it('Remove all motion takes everything off, own animations and parallax included', () => {
    let content = withMotion(cloneSample(), 'e_text', { entrance: 'blur-in', duration: 700, delay: 0 })
    content = withMotion(content, 'e_heading', { effect: 'grow' }, 'hover')
    ;(content.sections[1]!.style as { base?: Obj }).base = { background: { type: 'image', image: { media_id: 'm', position: 'center', size: 'cover', repeat: false }, parallax: 'slow' } }
    content = applyMotionTheme(content, 'festive').content
    expect(movingCount(content)).toBeGreaterThan(3)
    const removed = applyMotionTheme(content, 'none', { keepOwn: true })
    expect(removed.content.motion_theme).toBeUndefined()
    expect(movingCount(removed.content)).toBe(0)
    expect(JSON.stringify(removed.content)).not.toMatch(/"motion"|"hover":{"effect"|text_effect|card_hover|parallax|animate/)
    expect(base(removed.content, 's_story').background).toMatchObject({ type: 'image' })
    // Nothing left to remove: the same content.
    expect(applyMotionTheme(removed.content, 'none').content).toBe(removed.content)
  })

  it('leaves unrelated content untouched (structural sharing)', () => {
    const content = cloneSample()
    const applied = applyMotionTheme(content, 'minimal').content
    expect(applied.sections[4]).not.toBe(content.sections[4]) // s_hidden fades in too
    expect(findNode(applied, 'e_spacer')!.node).toBe(findNode(content, 'e_spacer')!.node)
    expect(hasMotion(findNode(applied, 'e_heading')!.node as unknown as Obj)).toBe(false)
  })

  it('themeAspects: Minimal only fades sections; Calm hover lifts buttons', () => {
    expect(themeAspects('minimal', 'heading', { lead: false, hero: true, loopOk: true })).toEqual({})
    expect(themeAspects('minimal', 'section', { lead: false, hero: false, loopOk: true })).toEqual({ motion: { entrance: 'fade', duration: 500, delay: 0, easing: 'snappy' } })
    expect(themeAspects('calm', 'button', { lead: true, hero: false, loopOk: true })).toEqual({ hover: { effect: 'lift-shadow' } })
  })
})

describe('motion themes: scroll effects (B19)', () => {
  const scroll = (content: BuilderContent, id: string) => base(content, id).scroll as Obj | undefined

  it('Lively and Festive give the sections below the first a subtle rise, Premium a subtle reveal; never the first section', () => {
    for (const [theme, effect] of [['lively', 'rise'], ['festive', 'rise'], ['premium', 'reveal_up']] as const) {
      const content = applyMotionTheme(cloneSample(), theme).content
      expect(scroll(content, 's_story')).toEqual({ effect, intensity: 'subtle' })
      expect(scroll(content, 's_hero')).toBeUndefined()
      // Only sections get one.
      expect(scroll(content, 'e_heading')).toBeUndefined()
    }
    for (const theme of ['calm', 'minimal'] as const) expect(scroll(applyMotionTheme(cloneSample(), theme).content, 's_story')).toBeUndefined()
    expect(themeAspects('lively', 'section', { lead: true, hero: false, loopOk: true }).scroll).toBeUndefined()
  })

  it('switching themes swaps the theme’s scroll effects; idempotent', () => {
    const lively = applyMotionTheme(cloneSample(), 'lively').content
    expect(applyMotionTheme(lively, 'lively').content).toBe(lively)
    const premium = applyMotionTheme(lively, 'premium').content
    expect(scroll(premium, 's_story')).toEqual({ effect: 'reveal_up', intensity: 'subtle' })
    const calm = applyMotionTheme(premium, 'calm').content
    expect(scroll(calm, 's_story')).toBeUndefined()
  })

  it('a scroll effect the owner set is their own motion: kept, unless they turn Keep my own off', () => {
    const content = withMotion(cloneSample(), 's_story', { effect: 'scale_up', range: 'cover' }, 'scroll')
    expect(isOwnMotion(findNode(content, 's_story')!.node as unknown as Obj, null)).toBe(true)
    const kept = applyMotionTheme(content, 'lively')
    expect(scroll(kept.content, 's_story')).toEqual({ effect: 'scale_up', range: 'cover' })
    expect(motion(kept.content, 's_story')).toBeUndefined()
    const replaced = applyMotionTheme(content, 'lively', { keepOwn: false }).content
    expect(scroll(replaced, 's_story')).toEqual({ effect: 'rise', intensity: 'subtle' })
    // The same effect written out with its defaults is still the theme's (not own).
    const spelled = withMotion(structuredClone(replaced), 's_story', { effect: 'rise', intensity: 'subtle', range: 'enter' }, 'scroll')
    expect(isOwnMotion(findNode(spelled, 's_story')!.node as unknown as Obj, 'lively')).toBe(false)
  })

  it('Remove all motion also takes off scroll effects, the background scroll and the slow zoom', () => {
    const content = applyMotionTheme(cloneSample(), 'festive').content
    ;(content.sections[1]!.props as Obj).background_scroll = 'zoom_in'
    ;(findNode(content, 'e_image')!.node as unknown as { props: Obj }).props.ken_burns = 'slow'
    ;(findNode(content, 'e_image')!.node as unknown as { props: Obj }).props.ken_burns_direction = 'in'
    const removed = applyMotionTheme(content, 'none').content
    expect(JSON.stringify(removed)).not.toMatch(/"scroll"|background_scroll|ken_burns/)
    expect(applyMotionTheme(removed, 'none').content).toBe(removed)
  })
})
