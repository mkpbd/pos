import { createRef } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { envelope, type CanvasMessage, type ParentMessage } from '@/storefront/builder/canvas/protocol'
import { samplePage } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { CanvasFrame, type CanvasHandle } from './canvas-frame'
import { createEditorStore, EditorStoreContext } from './store'
import { detail } from './test-helpers'
import { Toolbar } from './toolbar'

/*
 * B18 editor A: the toolbar's "Preview motion" toggle (store, not saved) and "▶ Play page", and the
 * canvas messages they send (`preview-motion {on}` on change and after each ready; `play-motion`
 * with a scope).
 */

const ORIGIN = window.location.origin

function canvas(previewMotion: boolean) {
  const handle = createRef<CanvasHandle>()
  const page = samplePage({ source: 'draft' })
  const props = {
    bootstrap: bootstrapFixture(),
    locale: 'en',
    sections: page.sections,
    data: page.data,
    media: page.media,
    pending: [],
    selection: null,
    hover: null,
    errorIds: [],
    device: 'desktop' as const,
    dragging: false,
    indicator: null,
    onSelect: vi.fn(),
    onHover: vi.fn(),
    onKey: vi.fn(),
    toolbar: () => null,
    hoverLabel: (id: string) => id,
    handleRef: handle,
  }
  const view = render(<CanvasFrame {...props} previewMotion={previewMotion} />)
  const child = (screen.getByTitle(/Page canvas/) as HTMLIFrameElement).contentWindow!
  const posted: ParentMessage[] = []
  vi.spyOn(child, 'postMessage').mockImplementation((data: unknown) => {
    posted.push(data as ParentMessage)
  })
  const ready = () => act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope({ type: 'ready' } as CanvasMessage), origin: ORIGIN, source: child })))
  const rerender = (on: boolean) => view.rerender(<CanvasFrame {...props} previewMotion={on} />)
  return { handle, posted, ready, rerender }
}

const types = (posted: ParentMessage[]) => posted.map((m) => m.type)

describe('B18 canvas motion messages', () => {
  it('preview-motion: nothing while off (a new canvas starts off), on change, and again after a reload when on', () => {
    const { posted, ready, rerender } = canvas(false)
    ready()
    expect(types(posted)).not.toContain('preview-motion')
    rerender(true)
    expect(posted.filter((m) => m.type === 'preview-motion')).toEqual([expect.objectContaining({ type: 'preview-motion', on: true })])
    posted.length = 0
    ready()
    expect(posted.filter((m) => m.type === 'preview-motion')).toEqual([expect.objectContaining({ on: true })])
    rerender(false)
    expect(posted.filter((m) => m.type === 'preview-motion').at(-1)).toMatchObject({ on: false })
  })

  it('play-motion carries the scope when given', () => {
    const { handle, posted, ready } = canvas(false)
    ready()
    handle.current!.playMotion('s_hero', 'page')
    handle.current!.playMotion('e_heading')
    expect(posted.filter((m) => m.type === 'play-motion')).toEqual([expect.objectContaining({ type: 'play-motion', id: 's_hero', scope: 'page' }), expect.objectContaining({ type: 'play-motion', id: 'e_heading' })])
    expect(posted.at(-1)).not.toHaveProperty('scope')
  })
})

describe('B18 toolbar: Preview motion and Play page', () => {
  function toolbar(onPlayPage?: () => void) {
    const store = createEditorStore(detail())
    const noop = () => {}
    render(
      <MemoryRouter>
        <TooltipProvider>
          <EditorStoreContext value={store}>
            <Toolbar canPublish onRename={async () => {}} onPreview={noop} onPublish={noop} onDiscard={noop} onHistory={noop} onShowProblem={noop} previewAs={false} onPlayPage={onPlayPage} />
          </EditorStoreContext>
        </TooltipProvider>
      </MemoryRouter>,
    )
    return store
  }

  it('the toggle is pressed while on (default off) and lives in the editor state; Play page plays the page', async () => {
    const user = userEvent.setup()
    const play = vi.fn()
    const store = toolbar(play)
    await user.click(screen.getByRole('button', { name: 'Motion' }))
    const toggle = await screen.findByRole('menuitemcheckbox', { name: 'Preview motion' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(store.getState().previewMotion).toBe(false)
    await user.click(toggle)
    expect(store.getState().previewMotion).toBe(true)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // Radix may leave the page aria-hidden for a moment in jsdom: reopen through the trigger itself.
    await user.click(screen.getByTestId('motion-menu-button'))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Preview motion' })).toHaveAttribute('aria-checked', 'true')
    // Not an edit: nothing to undo, nothing unsaved.
    expect(store.getState().history.past).toHaveLength(0)
    await user.click(screen.getByRole('menuitem', { name: 'Play page' }))
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('no motion controls without a canvas to play on', () => {
    toolbar()
    expect(screen.queryByRole('button', { name: 'Motion' })).not.toBeInTheDocument()
  })
})
