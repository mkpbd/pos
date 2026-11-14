import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Section } from '@/storefront/builder/types'
import { checkDocument } from './check'
import { computeDropTarget, layerDropTarget } from './drop-targets'
import { flattenLayers } from './layers'
import { detachGlobal, expandGlobals, globalContextFor, globalFits, globalRefOf, makeGlobal, referencedGlobals, sectionForGlobal, unavailableReason, type GlobalEntry } from './global-sections'
import { collectIds, duplicateNode, findNode, moveBy, setHidden } from './tree'

const GLOBAL_ID = '01a1c9d9-0000-7000-8000-0000000000aa'

function withRef(): BuilderContent {
  return makeGlobal(cloneSample(), 's_story', GLOBAL_ID)
}

function entry(section: Section | null, state: GlobalEntry['state'] = 'ready', context: GlobalEntry['context'] = 'page'): ReadonlyMap<string, GlobalEntry> {
  return new Map([[GLOBAL_ID, { id: GLOBAL_ID, title: 'Our story', context, section, state }]])
}

const story = () => cloneSample().sections.find((s) => s.id === 's_story')!

describe('global sections', () => {
  it('makes a section global: the page keeps a reference with its id, hidden and schedule', () => {
    const content = cloneSample()
    content.sections[1] = { ...content.sections[1]!, hidden: true, schedule: { starts_at: '2026-12-01T00:00:00+06:00', ends_at: null } }
    const next = makeGlobal(content, 's_story', GLOBAL_ID)
    expect(next.sections[1]).toEqual({ id: 's_story', type: 'global_section', ref: GLOBAL_ID, hidden: true, schedule: { starts_at: '2026-12-01T00:00:00+06:00', ends_at: null } })
    expect(referencedGlobals(next)).toEqual([GLOBAL_ID])
    expect(checkDocument(next)).toEqual([])
    // The global is made from the section shown and unscheduled.
    expect(sectionForGlobal(content.sections[1]!)).toMatchObject({ id: 's_story', hidden: false, schedule: null })
    // Not twice.
    expect(makeGlobal(next, 's_story', GLOBAL_ID)).toBe(next)
  })

  it('tree operations work around a reference (it has no columns)', () => {
    const content = withRef()
    expect(findNode(content, 's_story')).toMatchObject({ kind: 'section', index: 1 })
    expect(findNode(content, 'e_heading')).toBeNull()
    const rows = flattenLayers(content).filter((r) => r.node.id === 's_story')
    expect(rows).toHaveLength(1)
    expect(moveBy(content, 's_story', 1).sections.map((s) => s.id)).toEqual(['s_hero', 's_features', 's_story', 's_products', 's_hidden'])
    expect(globalRefOf(setHidden(content, 's_story', true).sections[1])?.hidden).toBe(true)
    const copy = duplicateNode(content, 's_story')
    expect(copy.id).not.toBeNull()
    expect(globalRefOf(findNode(copy.content, copy.id)!.node)?.ref).toBe(GLOBAL_ID)
    expect(checkDocument(copy.content)).toEqual([])
    // Dropping an element over it goes above or below, never into it.
    const rects = { s_hero: { x: 0, y: 0, w: 1000, h: 100 }, s_story: { x: 0, y: 100, w: 1000, h: 300 } }
    const result = computeDropTarget(content, rects, { x: 500, y: 200 }, { kind: 'new', type: 'heading' }, 1000)
    expect(result?.target.kind).toBe('new-section')
    expect(layerDropTarget(content, 's_story', 'bottom', { kind: 'new', type: 'heading' })).toMatchObject({ target: { kind: 'new-section', index: 2 }, position: 'after' })
  })

  it('draws a reference as the global draft section with the marker; clicks inside belong to the reference', () => {
    const content = withRef()
    const section = { ...story(), id: 's_global' }
    const { content: drawn, owners } = expandGlobals(content, entry(section), 'page')
    const drawnSection = drawn.sections[1] as Section & { global?: unknown }
    expect(drawnSection.id).toBe('s_story')
    expect(drawnSection.columns).toEqual(section.columns)
    expect(drawnSection.global).toEqual({ id: GLOBAL_ID, title: 'Our story', section_id: 's_global', version: null })
    expect(owners.get('e_heading')).toBe('s_story')
    expect(owners.has('s_hero')).toBe(false)
    // Without references nothing changes.
    const plain = cloneSample()
    expect(expandGlobals(plain, new Map()).content).toBe(plain)
  })

  it('a missing global or one made for another place is drawn as unavailable; a loading one as a note', () => {
    const content = withRef()
    const missing = expandGlobals(content, entry(null, 'missing'), 'page').content.sections[1] as unknown as Record<string, unknown>
    expect(missing).toMatchObject({ id: 's_story', type: 'global_section', ref: GLOBAL_ID, state: 'unavailable', global: { id: GLOBAL_ID, section_id: null, version: null } })
    expect(missing.columns).toBeUndefined()
    const header = expandGlobals(content, entry(story(), 'ready', 'header'), 'page').content.sections[1] as unknown as Record<string, unknown>
    expect(header.state).toBe('unavailable')
    const loading = expandGlobals(content, entry(null, 'loading'), 'page').content.sections[1] as Section
    expect(loading.columns[0]!.elements[0]).toMatchObject({ type: 'text' })
    expect(unavailableReason(entry(story(), 'ready', 'footer').get(GLOBAL_ID), 'page')).toMatch(/made for the footer/)
    expect(unavailableReason(entry(null, 'missing').get(GLOBAL_ID), 'page')).toMatch(/no longer exists/)
    expect(unavailableReason(entry(story()).get(GLOBAL_ID), 'cms')).toBeNull()
  })

  it('detaches: a copy of the global section with new ids, keeping the reference id and hidden', () => {
    const content = withRef()
    const hidden = setHidden(content, 's_story', true)
    const global = { ...story(), id: 's_global' }
    const next = detachGlobal(hidden, 's_story', global)
    const section = next.sections[1] as Section
    expect(section.type).toBe('section')
    expect(section.id).toBe('s_story')
    expect(section.hidden).toBe(true)
    const all = (s: Section) => s.columns.flatMap((c) => c.elements)
    expect(all(section).map((e) => e.type)).toEqual(all(story()).map((e) => e.type))
    // No id of the global is reused (the global may be on this page twice).
    expect([...collectIds({ schema_version: 1, sections: [section] })].filter((id) => id !== 's_story' && collectIds({ schema_version: 1, sections: [global] }).has(id))).toEqual([])
    expect(section.columns[0]!.elements[0]!.translations).toEqual(story().columns[0]!.elements[0]!.translations)
    expect(checkDocument(next)).toEqual([])
  })

  it('contexts: page globals go on pages, CMS pages and shop areas; header and footer ones only there; none in popups', () => {
    expect(globalContextFor('zone')).toBe('page')
    expect(globalContextFor('popup')).toBeNull()
    expect(globalFits('page', 'cms')).toBe(true)
    expect(globalFits('header', 'header')).toBe(true)
    expect(globalFits('header', 'footer')).toBe(false)
    expect(globalFits('page', 'popup')).toBe(false)
  })
})
