import { ApiError } from '@/lib/api/client'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import type { DocumentDetail } from './api'
import { Autosave, AUTOSAVE_DELAY, problemsByNode } from './autosave'
import { createEditorStore } from './store'
import { detail } from './test-helpers'
import { setProps } from './tree'

function setup(save: (id: string, revision: number, content: BuilderContent) => Promise<DocumentDetail>, fetchDocument?: () => Promise<DocumentDetail>) {
  const store = createEditorStore(detail())
  const saveMock = vi.fn(save)
  const fetchMock = vi.fn(fetchDocument ?? (async () => detail(cloneSample(), 7)))
  const autosave = new Autosave(store, { save: saveMock, fetchDocument: fetchMock })
  autosave.start()
  const edit = (text: string) => store.getState().apply((c) => setProps(c, 'e_heading', { text }))
  return { store, autosave, save: saveMock, fetchDocument: fetchMock, edit }
}

const okSave = async (_id: string, revision: number, content: BuilderContent) => ({ ...detail(content, revision + 1) })

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves 1.5 s after the last change, with the revision, and tracks the new one', async () => {
    const { store, save, edit, autosave } = setup(okSave)
    edit('a')
    await vi.advanceTimersByTimeAsync(1000)
    edit('ab')
    expect(store.getState().saveState.status).toBe('dirty')
    expect(autosave.pending).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![1]).toBe(3)
    expect(store.getState().revision).toBe(4)
    expect(store.getState().saveState.status).toBe('saved')
    expect(autosave.pending).toBe(false)

    edit('abc')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(save.mock.calls[1]![1]).toBe(4)
  })

  it('flush saves at once and reports success; nothing to save is success', async () => {
    const { save, edit, autosave } = setup(okSave)
    expect(await autosave.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
    edit('now')
    expect(await autosave.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a change during a save is saved afterwards', async () => {
    let release: () => void = () => {}
    const { store, save, edit } = setup(
      (id, revision, content) =>
        new Promise((resolve) => {
          release = () => void okSave(id, revision, content).then(resolve)
        }),
    )
    edit('first')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(store.getState().saveState.status).toBe('saving')
    edit('second')
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().saveState.status).toBe('dirty')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(store.getState().saveState.status).toBe('saved')
  })

  it('409: conflict until the user chooses; "keep mine" re-fetches the revision and saves mine', async () => {
    let calls = 0
    const { store, save, fetchDocument, edit, autosave } = setup(async (id, revision, content) => {
      calls += 1
      if (calls === 1) throw new ApiError(409, 'DRAFT_CONFLICT', 'Stale', { revision: 7 })
      return okSave(id, revision, content)
    })
    edit('mine')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(store.getState().saveState.status).toBe('conflict')
    edit('more')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 3)
    expect(save).toHaveBeenCalledTimes(1)
    expect(await autosave.flush()).toBe(false)

    await autosave.resolveConflict('mine')
    expect(fetchDocument).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![1]).toBe(7)
    expect((store.getState().content.sections[1]!.columns[0]!.elements[0]!.props as { text: string }).text).toBe('more')
    expect(store.getState().saveState.status).toBe('saved')
  })

  it('409: "load their version" replaces the draft and clears history', async () => {
    const theirs = cloneSample()
    theirs.sections = theirs.sections.slice(0, 1)
    const { store, edit, autosave } = setup(
      async () => {
        throw new ApiError(409, 'DRAFT_CONFLICT', 'Stale')
      },
      async () => detail(theirs, 8),
    )
    edit('mine')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    await autosave.resolveConflict('theirs')
    expect(store.getState().content.sections).toHaveLength(1)
    expect(store.getState().revision).toBe(8)
    expect(store.getState().history.past).toHaveLength(0)
    expect(store.getState().saveState.status).toBe('saved')
  })

  it('422: problems mapped by node, no retry until the content changes', async () => {
    const error = new ApiError(422, 'DOCUMENT_INVALID', 'Invalid', {
      errors: [
        { path: 'sections.1.columns.0.elements.0.props.text', node_id: 'e_heading', message: 'Too long.' },
        { path: 'sections.1.columns.0.elements.2.props.link', node_id: 'e_button', message: 'A link is required.', code: 'required' },
        { path: 'sections', node_id: null, message: 'Too many nodes.' },
      ],
    })
    let fail = true
    const { store, save, edit } = setup(async (id, revision, content) => {
      if (fail) throw error
      return okSave(id, revision, content)
    })
    edit('x'.repeat(300))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(store.getState().saveState.status).toBe('invalid')
    expect(store.getState().errors).toEqual({
      e_heading: [{ path: 'sections.1.columns.0.elements.0.props.text', message: 'Too long.' }],
      e_button: [{ path: 'sections.1.columns.0.elements.2.props.link', message: 'A link is required.', code: 'required' }],
      '': [{ path: 'sections', message: 'Too many nodes.' }],
    })
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 5)
    expect(save).toHaveBeenCalledTimes(1)

    fail = false
    edit('short')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(save).toHaveBeenCalledTimes(2)
    expect(store.getState().errors).toEqual({})
    expect(store.getState().saveState.status).toBe('saved')
  })

  it('network errors: offline with exponential retry', async () => {
    let failures = 2
    const { store, save, edit } = setup(async (id, revision, content) => {
      if (failures > 0) {
        failures -= 1
        throw new ApiError(0, 'NETWORK_ERROR', 'Offline')
      }
      return okSave(id, revision, content)
    })
    edit('a')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(store.getState().saveState.status).toBe('offline')
    await vi.advanceTimersByTimeAsync(1999)
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3999)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(3)
    expect(store.getState().saveState.status).toBe('saved')
  })

  it('undoing back to the saved content is clean again (nothing to guard)', async () => {
    const { store, save, edit, autosave } = setup(okSave)
    edit('a')
    expect(autosave.pending).toBe(true)
    store.getState().undo()
    expect(autosave.pending).toBe(false)
    expect(store.getState().saveState.status).toBe('saved')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2)
    expect(save).not.toHaveBeenCalled()
  })

  it('groups problems without a node under the page', () => {
    expect(problemsByNode(new ApiError(422, 'DOCUMENT_EMPTY', 'Empty page'))).toEqual({ '': [{ path: '', message: 'Empty page' }] })
  })
})
