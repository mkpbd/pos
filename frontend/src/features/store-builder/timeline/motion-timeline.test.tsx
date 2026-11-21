import { createRef, type ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Motion } from '@/storefront/builder/types'
import type { CanvasHandle } from '../canvas-frame'
import { EditorUiContext, type EditorUi } from '../commands'
import { createEditorStore, EditorStoreContext, type EditorStore } from '../store'
import { detail } from '../test-helpers'
import { findNode } from '../tree'
import { MotionTimelinePanel } from './motion-timeline'

/* B18 §4: the Motion timeline panel — rows, keyboard, dragging, easing, Play section, undo. */

function withMotion(content: BuilderContent, id: string, motion: Motion): BuilderContent {
  const node = findNode(content, id)!.node as unknown as { style: { base?: Record<string, unknown> } }
  node.style.base = { ...(node.style.base ?? {}), motion }
  return content
}
const motionOf = (store: EditorStore, id: string) => (findNode(store.getState().content, id)!.node as unknown as { style: { base?: { motion?: Motion } } }).style.base?.motion

function setup(content: BuilderContent = storyWithMotion(), nodeId = 's_story') {
  const store = createEditorStore(detail(content))
  const canvas = createRef<CanvasHandle | null>() as { current: CanvasHandle | null }
  const handle = { scrollTo: vi.fn(), playMotion: vi.fn() }
  canvas.current = handle as unknown as CanvasHandle
  const ui = { registry: { types: ELEMENT_REGISTRY, limits: {}, enums: {} }, canvas, requestDelete: vi.fn() } as unknown as EditorUi
  const onClose = vi.fn()
  const wrap = (children: ReactNode) => (
    <EditorStoreContext value={store}>
      <EditorUiContext value={ui}>{children}</EditorUiContext>
    </EditorStoreContext>
  )
  const result = render(wrap(<MotionTimelinePanel nodeId={nodeId} onClose={onClose} />))
  return { store, handle, onClose, rerender: (id: string | null) => result.rerender(wrap(<MotionTimelinePanel nodeId={id} onClose={onClose} />)) }
}

function storyWithMotion(): BuilderContent {
  let content = withMotion(cloneSample(), 's_story', { entrance: 'none', stagger_children: 100 })
  content = withMotion(content, 'e_heading', { entrance: 'slide-up', duration: 600, delay: 200 })
  content = withMotion(content, 'e_image', { entrance: 'zoom', duration: 800, delay: 0 })
  return content
}

const bar = (name: RegExp) => screen.getByRole('slider', { name })

describe('Motion timeline panel (B18 §4)', () => {
  it('shows one row per part of the section with screen-reader timing on each bar', () => {
    setup()
    const rows = screen.getAllByTestId('timeline-row')
    expect(rows.map((r) => r.dataset.nodeId)).toEqual(['s_story', 'e_heading', 'e_text', 'e_button', 'e_image'])
    expect(bar(/Heading timing/)).toHaveAttribute('aria-valuetext', 'Heading: starts 0.20 s, lasts 0.60 s, slide up')
    expect(bar(/Image timing/)).toHaveAttribute('aria-valuetext', 'Image: starts 0.10 s (waits 0.10 s for the parts before it), lasts 0.80 s, zoom in')
    expect(within(rows[2]!).getByText('No entrance')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Motion timeline/ })).toBeInTheDocument()
    expect(screen.getByTestId('timeline-ruler')).toHaveTextContent('0 s')
  })

  it('←/→ move the start by 50 ms, Shift+←/→ the length; repeated presses are one undo step', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    bar(/Heading timing/).focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 300, duration: 600 })
    expect(bar(/Heading timing/)).toHaveAttribute('aria-valuenow', '300')
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 300, duration: 550 })
    expect(bar(/Heading timing/)).toHaveFocus()
    store.getState().undo()
    store.getState().undo()
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 200, duration: 600 })
  })

  it('↑/↓ move between rows; Delete does not delete; Escape closes', async () => {
    const { store, onClose } = setup()
    const user = userEvent.setup()
    bar(/Heading timing/).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Add a fade-in to Text' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(bar(/Heading timing/)).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('button', { name: 'Add a fade-in to Section' })).toHaveFocus()
    bar(/Heading timing/).focus()
    const before = store.getState().content
    fireEvent.keyDown(bar(/Heading timing/), { key: 'Delete' })
    expect(store.getState().content).toBe(before)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('dragging the bar moves the start, its right edge the length (snapped, one undo step per drag)', () => {
    const { store } = setup()
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 20, width: 300, height: 20, toJSON: () => ({}) })
    const heading = bar(/Heading timing/)
    fireEvent.pointerDown(heading, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(heading, { clientX: 110, pointerId: 1 })
    fireEvent.pointerMove(heading, { clientX: 133, pointerId: 1 })
    fireEvent.pointerUp(heading, { clientX: 133, pointerId: 1 })
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 550, duration: 600 })

    const edge = within(heading).getByTestId('timeline-resize')
    fireEvent.pointerDown(edge, { button: 0, clientX: 200, pointerId: 2 })
    fireEvent.pointerMove(edge, { clientX: 241, pointerId: 2 })
    fireEvent.pointerUp(edge, { clientX: 241, pointerId: 2 })
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 550, duration: 1000 })

    store.getState().undo()
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 550, duration: 600 })
    store.getState().undo()
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 200, duration: 600 })
    rect.mockRestore()
  })

  it('changes the easing per row, adds a fade-in, and plays the section on the canvas', async () => {
    const { store, handle } = setup()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Heading easing' }), 'bounce')
    expect(motionOf(store, 'e_heading')).toMatchObject({ easing: 'bounce' })
    expect(screen.getByRole('combobox', { name: 'Text easing' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add a fade-in to Text' }))
    expect(motionOf(store, 'e_text')).toMatchObject({ entrance: 'fade' })
    await user.click(screen.getByRole('button', { name: /Play section/ }))
    expect(handle.playMotion).toHaveBeenCalledWith('s_story', 'section')
    expect(handle.scrollTo).toHaveBeenCalledWith('s_story')
  })

  it('follows the selection to its section and selects a part from its row', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Button/ }))
    expect(store.getState().selection).toBe('e_button')
    store.getState().select('e_feat_a')
    expect(await screen.findByRole('button', { name: /^Inner row/ })).toBeInTheDocument()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('is read-only while someone else edits', async () => {
    const { store } = setup()
    store.getState().setReadOnly(true)
    const user = userEvent.setup()
    bar(/Heading timing/).focus()
    await user.keyboard('{ArrowRight}')
    expect(motionOf(store, 'e_heading')).toMatchObject({ delay: 200 })
    expect(await screen.findByRole('combobox', { name: 'Heading easing' })).toBeDisabled()
  })

  it('renders nothing when closed', () => {
    const { rerender } = setup()
    rerender(null)
    expect(screen.queryByTestId('motion-timeline')).toBeNull()
  })
})
