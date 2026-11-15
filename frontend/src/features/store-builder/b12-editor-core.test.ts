import { cloneSample } from '@/storefront/builder/test-payload'
import { commandSections, matchScore, readRecent, rememberRecent, type CommandItem } from './command-model'
import { deviceView, resolveDeviceDrop } from './device-drop'
import { copyTargets } from './copy-to-pages-api'
import type { DocumentSummary } from './api'
import { createEditorStore } from './store'
import { detail } from './test-helpers'
import { findNode, setProps } from './tree'
import { attachUndoMemory, memoryKey, memoryText, readMemory, RESET_NOTE } from './undo-memory'

const toastInfo = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const item = (id: string, group: CommandItem['group'], label: string, words?: string): CommandItem => ({ id, group, label, words, run: () => undefined })

beforeEach(() => {
  window.localStorage.clear()
  toastInfo.mockClear()
})

describe('B12 command box model', () => {
  it('scores word starts above inner matches above fuzzy letters; every word must match', () => {
    expect(matchScore('head', 'Heading')).toBeGreaterThan(matchScore('ding', 'Heading'))
    expect(matchScore('ding', 'Heading')).toBeGreaterThan(matchScore('hdg', 'Heading'))
    expect(matchScore('hdg', 'Heading')).toBeGreaterThan(0)
    expect(matchScore('zzz', 'Heading')).toBe(0)
    expect(matchScore('product grid', 'Product grid')).toBeGreaterThan(0)
    expect(matchScore('grid xyz', 'Product grid')).toBe(0)
    // Bangla words match too.
    expect(matchScore('ছবি', 'Image ছবি ইমেজ')).toBeGreaterThan(0)
  })

  it('groups results, finds by extra words, puts recent items first without a query', () => {
    const items = [
      item('action:publish', 'action', 'Publish'),
      item('add:image', 'add', 'Image', 'ছবি photo'),
      item('add:heading', 'add', 'Heading', 'শিরোনাম'),
      item('goto:e_1', 'goto', 'Heading: Fresh today'),
      item('page:p1', 'page', 'About us'),
    ]
    const byWord = commandSections(items, 'photo', [])
    expect(byWord.map((s) => s.group)).toEqual(['add'])
    expect(byWord[0]!.items.map((i) => i.id)).toEqual(['add:image'])
    const heading = commandSections(items, 'heading', [])
    expect(heading.map((s) => s.group)).toEqual(['add', 'goto'])
    const idle = commandSections(items, '', ['page:p1', 'gone'])
    expect(idle[0]).toMatchObject({ group: 'recent' })
    expect(idle[0]!.items.map((i) => i.id)).toEqual(['page:p1'])
    expect(idle.flatMap((s) => s.items).filter((i) => i.id === 'page:p1')).toHaveLength(1)
  })

  it('keeps a short recent list', () => {
    rememberRecent('add:image')
    rememberRecent('action:publish')
    rememberRecent('add:image')
    expect(readRecent()).toEqual(['add:image', 'action:publish'])
  })
})

describe('B12 undo history across reloads', () => {
  it('stores the history once saved and restores it at the same revision', () => {
    vi.useFakeTimers()
    try {
      const store = createEditorStore(detail(cloneSample(), 7))
      const stop = attachUndoMemory(store, 'org-1')
      store.getState().apply((c) => setProps(c, 'e_heading', { text: 'One' }))
      store.getState().apply((c) => setProps(c, 'e_heading', { text: 'Two' }))
      vi.advanceTimersByTime(1000)
      // Not saved yet: nothing stored.
      expect(readMemory(memoryKey('org-1', 'doc-1'))).toBeNull()
      store.getState().saved(store.getState().content, 8)
      vi.advanceTimersByTime(1000)
      stop()
      const stored = readMemory(memoryKey('org-1', 'doc-1'))!
      expect(stored.revision).toBe(8)
      expect(stored.past).toHaveLength(2)

      // "Reload": the server's draft at revision 8.
      const again = createEditorStore(detail(store.getState().content, 8))
      const stop2 = attachUndoMemory(again, 'org-1')
      expect(again.getState().history.past).toHaveLength(2)
      again.getState().undo()
      expect((findNode(again.getState().content, 'e_heading')!.node as { props: { text: string } }).props.text).toBe('One')
      stop2()
      expect(toastInfo).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a history built on another revision, with a quiet note', () => {
    window.localStorage.setItem(memoryKey('org-1', 'doc-1'), memoryText(5, [{ content: cloneSample(), selection: null, selectedIds: [] }], [], 1)!)
    const store = createEditorStore(detail(cloneSample(), 6))
    const stop = attachUndoMemory(store, 'org-1')
    expect(store.getState().history.past).toHaveLength(0)
    expect(toastInfo).toHaveBeenCalledWith(RESET_NOTE)
    expect(readMemory(memoryKey('org-1', 'doc-1'))).toBeNull()
    stop()
  })

  it('keeps the newest steps within the size limit; unreadable storage is ignored', () => {
    const snap = { content: cloneSample(), selection: null, selectedIds: [] }
    const one = memoryText(1, [snap], [], 1)!
    const text = memoryText(1, Array.from({ length: 80 }, () => snap), [snap], 1, one.length * 2 * 3)!
    const parsed = JSON.parse(text) as { past: unknown[]; future: unknown[] }
    expect(parsed.future).toHaveLength(0)
    expect(parsed.past.length).toBeLessThanOrEqual(3)
    expect(parsed.past.length).toBeGreaterThan(0)
    window.localStorage.setItem(memoryKey('o', 'd'), '{not json')
    expect(readMemory(memoryKey('o', 'd'))).toBeNull()
  })
})

describe('B12 drag and drop in tablet / phone view', () => {
  const ordered = () => ({ ...cloneSample(), device_order: { mobile: { c_story_text: ['e_button', 'e_heading', 'e_text'], root: ['s_story', 's_hero', 's_features', 's_products', 's_hidden'] } } })

  it('deviceView reorders sections and column elements', () => {
    const view = deviceView(ordered(), 'mobile')
    expect(view.sections.map((s) => s.id).slice(0, 2)).toEqual(['s_story', 's_hero'])
    expect((findNode(view, 'c_story_text')!.node as { elements: { id: string }[] }).elements.map((e) => e.id)).toEqual(['e_button', 'e_heading', 'e_text'])
    const base = cloneSample()
    expect(deviceView(base, 'desktop')).toBe(base)
  })

  it('a move inside its own column changes only the phone order', () => {
    const content = ordered()
    // Drop e_text (phone index 2) before e_button (phone index 0).
    const result = resolveDeviceDrop(content, 'mobile', { kind: 'node', id: 'e_text', type: 'text' }, { kind: 'column', columnId: 'c_story_text', index: 0 })
    expect(result.kind).toBe('device')
    if (result.kind !== 'device') return
    const next = result.edit(content)
    expect(next.device_order?.mobile?.c_story_text).toEqual(['e_text', 'e_button', 'e_heading'])
    expect(next.sections).toBe(content.sections)
  })

  it('into another column: the base structure, before the same neighbour', () => {
    const content = ordered()
    const result = resolveDeviceDrop(content, 'mobile', { kind: 'node', id: 'e_image', type: 'image' }, { kind: 'column', columnId: 'c_story_text', index: 1 })
    // Phone index 1 is e_heading, which is base index 0.
    expect(result).toEqual({ kind: 'base', target: { kind: 'column', columnId: 'c_story_text', index: 0 }, movesEverywhere: true })
    const add = resolveDeviceDrop(content, 'mobile', { kind: 'new', type: 'text' }, { kind: 'new-section', index: 1 })
    // Phone position 1 is before s_hero = base index 0.
    expect(add).toEqual({ kind: 'base', target: { kind: 'new-section', index: 0 }, movesEverywhere: false })
  })
})

describe('B12 copy to other pages', () => {
  it('offers pages and zones other than the open one', () => {
    const doc = (id: string, kind: DocumentSummary['kind'], title: string) => ({ id, kind, title, key: id }) as DocumentSummary
    const list = [doc('a', 'page', 'Home'), doc('b', 'zone', 'Shop top'), doc('c', 'popup', 'Hi'), doc('d', 'global', 'G'), doc('e', 'header', 'Header'), doc('f', 'page', 'About')]
    expect(copyTargets(list, 'a').map((d) => d.id)).toEqual(['f', 'b'])
  })
})
