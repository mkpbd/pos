import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { Motion } from '@/storefront/builder/types'
import type { CanvasHandle } from '../canvas-frame'
import { EditorUiContext, type EditorUi } from '../commands'
import { createEditorStore, EditorStoreContext, type EditorStore } from '../store'
import { detail } from '../test-helpers'
import { findNode } from '../tree'
import { MotionThemesDialog } from './motion-themes-dialog'

/* B18 §4: the Motion themes dialog — one undo step, keep own animations, plays the page. */

const motionOf = (store: EditorStore, id: string) => (findNode(store.getState().content, id)!.node as unknown as { style: { base?: { motion?: Motion } } }).style.base?.motion

function setup() {
  const content = cloneSample()
  ;(findNode(content, 'e_text')!.node as unknown as { style: { base: Record<string, unknown> } }).style.base = { motion: { entrance: 'blur-in', duration: 700, delay: 0 } }
  const store = createEditorStore(detail(content))
  const canvas = createRef<CanvasHandle | null>() as { current: CanvasHandle | null }
  const handle = { scrollTo: vi.fn(), playMotion: vi.fn() }
  canvas.current = handle as unknown as CanvasHandle
  const ui = { registry: { types: ELEMENT_REGISTRY, limits: {}, enums: {} }, canvas, requestDelete: vi.fn() } as unknown as EditorUi
  const onOpenChange = vi.fn()
  render(
    <EditorStoreContext value={store}>
      <EditorUiContext value={ui}>
        <MotionThemesDialog open onOpenChange={onOpenChange} />
      </EditorUiContext>
    </EditorStoreContext>,
  )
  return { store, handle, onOpenChange }
}

describe('Motion themes dialog (B18 §4)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('applies a theme as one undo step, keeps own animations and plays the page', async () => {
    const { store, handle, onOpenChange } = setup()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    expect(screen.getByRole('radiogroup', { name: 'Motion style' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Keep my own animations' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Lively/ }))
    await user.click(screen.getByRole('button', { name: 'Apply Lively' }))
    const state = store.getState()
    expect(state.content.motion_theme).toBe('lively')
    expect(motionOf(store, 'e_heading')).toMatchObject({ entrance: 'slide-up' })
    expect(motionOf(store, 'e_text')).toEqual({ entrance: 'blur-in', duration: 700, delay: 0 })
    expect(state.history.past).toHaveLength(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    vi.advanceTimersByTime(400)
    expect(handle.playMotion).toHaveBeenCalledWith('s_hero', 'page')
    state.undo()
    expect(store.getState().content.motion_theme).toBeUndefined()
    expect(motionOf(store, 'e_heading')).toBeUndefined()
  })

  it('"Keep my own animations" off replaces them', async () => {
    const { store } = setup()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('radio', { name: /Premium/ }))
    await user.click(screen.getByRole('switch', { name: 'Keep my own animations' }))
    await user.click(screen.getByRole('button', { name: 'Apply Premium' }))
    expect(motionOf(store, 'e_text')).toMatchObject({ entrance: 'fade', duration: 900 })
  })

  it('Remove all motion takes everything off and plays nothing', async () => {
    const { store, handle } = setup()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('radio', { name: /Remove all motion/ }))
    expect(screen.getByRole('switch', { name: 'Keep my own animations' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove all motion' }))
    expect(motionOf(store, 'e_text')).toBeUndefined()
    vi.advanceTimersByTime(400)
    expect(handle.playMotion).not.toHaveBeenCalled()
  })
})
