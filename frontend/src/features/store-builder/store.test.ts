import { cloneSample } from '@/storefront/builder/test-payload'
import { COALESCE_MS, createEditorStore, HISTORY_LIMIT, isDirty } from './store'
import { detail } from './test-helpers'
import { setHidden, setProps } from './tree'

describe('editor store history', () => {
  it('records each edit as a step and restores content and selection on undo / redo', () => {
    const store = createEditorStore(detail())
    const s = () => store.getState()
    const original = s().content
    s().select('e_heading')
    s().apply((c) => setProps(c, 'e_heading', { text: 'One' }), { select: 'e_text' })
    const afterOne = s().content
    s().apply((c) => setHidden(c, 'e_text', true), { select: 'e_button' })
    expect(s().history.past).toHaveLength(2)
    expect(isDirty(s())).toBe(true)

    s().undo()
    expect(s().content).toBe(afterOne)
    expect(s().selection).toBe('e_text')
    s().undo()
    expect(s().content).toBe(original)
    expect(s().selection).toBe('e_heading')
    expect(isDirty(s())).toBe(false)
    s().undo() // nothing left
    expect(s().content).toBe(original)

    s().redo()
    expect(s().content).toBe(afterOne)
    expect(s().selection).toBe('e_text')
    s().redo()
    expect(s().selection).toBe('e_button')
    expect(s().history.future).toHaveLength(0)
  })

  it('a refused edit records nothing', () => {
    const store = createEditorStore(detail())
    expect(store.getState().apply((c) => c)).toBe(false)
    expect(store.getState().history.past).toHaveLength(0)
  })

  it('coalesces typing in one field within 800 ms into one step', () => {
    let now = 1000
    const store = createEditorStore(detail(), () => now)
    const s = () => store.getState()
    const original = s().content
    for (const text of ['M', 'Ma', 'Mad', 'Made']) {
      s().apply((c) => setProps(c, 'e_heading', { text }), { coalesceKey: 'e_heading:text' })
      now += 300
    }
    expect(s().history.past).toHaveLength(1)
    now += COALESCE_MS
    s().apply((c) => setProps(c, 'e_heading', { text: 'Made!' }), { coalesceKey: 'e_heading:text' })
    expect(s().history.past).toHaveLength(2)
    // Another field is another step, even right away.
    s().apply((c) => setProps(c, 'e_button', { label: 'Go' }), { coalesceKey: 'e_button:label' })
    expect(s().history.past).toHaveLength(3)
    s().undo()
    s().undo()
    s().undo()
    expect(s().content).toBe(original)
  })

  it('keeps at most 100 steps and a new edit clears redo', () => {
    const store = createEditorStore(detail())
    const s = () => store.getState()
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) s().apply((c) => setProps(c, 'e_heading', { text: `T${i}` }))
    expect(s().history.past).toHaveLength(HISTORY_LIMIT)
    s().undo()
    expect(s().history.future).toHaveLength(1)
    s().apply((c) => setProps(c, 'e_heading', { text: 'new' }))
    expect(s().history.future).toHaveLength(0)
  })

  it('loading a document from the server clears history and errors', () => {
    const store = createEditorStore(detail())
    const s = () => store.getState()
    s().apply((c) => setProps(c, 'e_heading', { text: 'x' }), { select: 'e_heading' })
    s().setErrors({ e_heading: [{ path: 'props.text', message: 'Too long' }] })
    const next = detail(cloneSample(), 9)
    s().load(next)
    expect(s().history.past).toHaveLength(0)
    expect(s().errors).toEqual({})
    expect(s().selection).toBeNull()
    expect(s().revision).toBe(9)
    expect(isDirty(s())).toBe(false)
  })

  it('media from the inspector are kept for the canvas', () => {
    const store = createEditorStore(detail())
    store.getState().apply((c) => setProps(c, 'e_image', { media_id: 'm-2' }), { media: { 'm-2': { id: 'm-2', url: '/a.jpg', srcset: '/a.jpg 1w', width: 1, height: 1, alt: null } } })
    expect(store.getState().localMedia['m-2']).toEqual({ url: '/a.jpg', srcset: '/a.jpg 1w', width: 1, height: 1, alt: null })
  })
})
