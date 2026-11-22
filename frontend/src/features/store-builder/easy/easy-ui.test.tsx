import { useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { Device, Element } from '@/storefront/builder/types'
import { renderWithQuery } from '@/test/utils'
import { findNode } from '../tree'
import { Inspector, type BuilderNode, type ElementsMetadata } from '../inspector'
import { EaseContext, TOUR_DELAY, useEase, type EaseUi } from './ease-context'
import { GuidedTour } from './guided-tour'
import { FirstPublishTip } from './tips'

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }

function ui(overrides: Partial<EaseUi> = {}): EaseUi {
  return { easy: true, setEasy: vi.fn(), available: true, tipSeen: () => false, seeTip: vi.fn(), lang: 'en', bangla: false, ...overrides }
}

/** The inspector in an editor-like Easy context whose switch works. */
function inspector(id: string, { device = 'desktop' as Device, errors = [] as { path: string; message: string }[] } = {}) {
  const content = cloneSample()
  const initial = findNode(content, id)!.node
  const onChange = vi.fn()
  function Harness() {
    const [easy, setEasy] = useState(true)
    const [node, setNode] = useState<BuilderNode>(initial)
    return (
      <EaseContext value={ui({ easy, setEasy })}>
        <Inspector
          content={content}
          node={node}
          document={{ id: 'd-1', title: 'Home', path: '/', published: null }}
          registry={registry}
          locales={['en']}
          errors={errors}
          device={device}
          onChange={(next, opts) => {
            onChange(next, opts)
            setNode(next)
          }}
          onCommand={() => undefined}
        />
      </EaseContext>
    )
  }
  const user = userEvent.setup()
  renderWithQuery(<Harness />)
  return { user, onChange, last: () => onChange.mock.calls.at(-1)?.[0] as Element }
}

describe('B21 Easy mode in the inspector', () => {
  it('hides the Advanced tab, the per-device styles and the spacing numbers; S / M / L writes every device; More options shows everything', async () => {
    const { user, last } = inspector('e_heading', { device: 'mobile' })
    const header = screen.getByRole('switch', { name: 'Easy mode' })
    expect(header).toBeChecked()
    expect(screen.queryByRole('tab', { name: 'Advanced' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Style' }))
    expect(screen.queryByTestId('style-device-banner')).toBeNull()
    // The phone view shows a heading with its own phone text size: said, not hidden silently.
    expect(screen.getByTestId('easy-device-note')).toHaveTextContent('On a phone this part also has its own settings.')
    expect(screen.queryByTestId('style-group-text-effects')).toBeNull()
    expect(screen.queryByRole('img', { name: /set for Mobile/ })).toBeNull()
    const typography = within(screen.getByTestId('style-group-typography'))
    expect(typography.queryByText('Line height')).toBeNull()
    expect(typography.getByText('Weight')).toBeInTheDocument()

    const presets = within(screen.getByTestId('spacing-presets'))
    const inside = within(presets.getByRole('radiogroup', { name: 'Space inside' }))
    await user.click(inside.getByRole('radio', { name: 'Small' }))
    // Easy mode styles every device: the desktop (base) values.
    expect(last().style.base?.spacing?.padding).toEqual({ top: '8px', right: '8px', bottom: '8px', left: '8px' })
    expect(last().style.mobile?.spacing).toBeUndefined()
    expect(inside.getByRole('radio', { name: 'Small' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('switch', { name: 'Easy mode' })).not.toBeChecked()
    expect(screen.getByRole('tab', { name: 'Advanced' })).toBeInTheDocument()
    expect(screen.getByTestId('style-device-banner')).toHaveTextContent('Styling for Mobile')
    expect(screen.getByTestId('spacing-padding')).toBeInTheDocument()
    expect(screen.queryByTestId('more-options')).toBeNull()
  })

  it('a section keeps roomy steps and the line-up choices; the animation keeps its tiles only', async () => {
    const { user, last } = inspector('s_story')
    await user.click(screen.getByRole('tab', { name: 'Style' }))
    const presets = within(screen.getByTestId('spacing-presets'))
    expect(presets.queryByRole('radiogroup', { name: 'Space below' })).toBeNull()
    await user.click(presets.getByRole('radio', { name: 'Large' }))
    expect(last().style.base?.spacing?.padding).toMatchObject({ top: '96px', bottom: '96px' })
    const layout = within(screen.getByTestId('style-group-layout'))
    expect(layout.getByRole('radiogroup', { name: 'Line up columns' })).toBeInTheDocument()
    expect(layout.queryByText('Space between columns')).toBeNull()
    expect(screen.queryByTestId('style-group-border')).toBeNull()
    await user.click(within(screen.getByTestId('style-group-motion')).getByRole('button', { name: /^Animation/ }))
    const motion = within(screen.getByTestId('motion-control'))
    expect(motion.getByTestId('entrance-tiles')).toBeInTheDocument()
    expect(motion.queryByText('Duration')).toBeNull()
    expect(motion.queryByRole('button', { name: /Open timeline/ })).toBeNull()
    expect(motion.queryByTestId('parallax-control')).toBeNull()
  })

  it('shows the Advanced tab while it has a problem to fix', () => {
    inspector('e_heading', { errors: [{ path: 'ends_at', message: 'The end must be after the start.' }] })
    expect(screen.getByRole('tab', { name: /Advanced/ })).toBeInTheDocument()
  })

  it('outside the editor (no Easy context) everything is shown and there is no switch', async () => {
    const content = cloneSample()
    const user = userEvent.setup()
    renderWithQuery(
      <Inspector content={content} node={findNode(content, 'e_heading')!.node} document={{ id: 'd-1', title: 'Home', path: '/', published: null }} registry={registry} locales={['en']} errors={[]} onChange={() => undefined} onCommand={() => undefined} />,
    )
    expect(screen.queryByRole('switch', { name: 'Easy mode' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Advanced' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Style' }))
    expect(screen.getByTestId('style-device-banner')).toBeInTheDocument()
  })
})

describe('B21 guided tour', () => {
  it('moves focus into each step, goes Next / Back, closes with Esc and gives focus back', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <EaseContext value={ui()}>
          <nav data-tour="add">Add panel</nav>
          <button type="button" onClick={() => setOpen(true)}>
            Start
          </button>
          <GuidedTour
            open={open}
            onClose={() => {
              onClose()
              setOpen(false)
            }}
          />
        </EaseContext>
      )
    }
    render(<Harness />)
    const start = screen.getByRole('button', { name: 'Start' })
    await user.click(start)
    const dialog = screen.getByRole('dialog', { name: 'Editor tour' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('Step 1 of 6')).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Add a section' })).toHaveFocus()
    expect(screen.getByTestId('guided-tour')).toHaveAttribute('data-step', 'add')
    expect(within(dialog).queryByRole('button', { name: 'Back' })).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByRole('heading', { name: 'Change the words' })).toHaveFocus()
    // Tab stays inside: Skip → Back → Next → Skip.
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Skip tour' })).toHaveFocus()
    await user.tab()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Next' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Skip tour' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Back' }))
    expect(within(dialog).getByRole('heading', { name: 'Add a section' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(start).toHaveFocus()
  })

  it('walks to Done on the last step; a step whose part is missing shows its card in the middle', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <EaseContext value={ui()}>
        <GuidedTour open onClose={onClose} />
      </EaseContext>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Editor tour' })
    expect(screen.queryByTestId('tour-spotlight')).toBeNull()
    for (let i = 0; i < 5; i += 1) await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByText('Step 6 of 6')).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Publish when you are ready' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('speaks Bangla, or English with a Bangla line for Bangla stores', async () => {
    const { unmount } = render(
      <EaseContext value={ui({ lang: 'bn', bangla: true })}>
        <GuidedTour open onClose={() => undefined} />
      </EaseContext>,
    )
    const bn = screen.getByRole('dialog', { name: 'এডিটর পরিচিতি' })
    expect(within(bn).getByRole('heading', { name: 'একটি অংশ যোগ করুন' })).toBeInTheDocument()
    expect(within(bn).getByText('ধাপ ১ / ৬')).toBeInTheDocument()
    expect(within(bn).getByRole('button', { name: 'পরবর্তী' })).toBeInTheDocument()
    unmount()
    render(
      <EaseContext value={ui({ lang: 'en', bangla: true })}>
        <GuidedTour open onClose={() => undefined} />
      </EaseContext>,
    )
    const en = screen.getByRole('dialog', { name: 'Editor tour' })
    expect(within(en).getByRole('heading', { name: 'Add a section' })).toBeInTheDocument()
    expect(en.querySelector('[lang="bn"]')).toHaveTextContent('একটি অংশ যোগ করুন')
  })
})

describe('B21 first publish tip', () => {
  it('shows once with a Check page button, is remembered as seen, and can be dismissed', async () => {
    const user = userEvent.setup()
    const seeTip = vi.fn()
    const onShowCheck = vi.fn()
    render(
      <EaseContext value={ui({ seeTip })}>
        <FirstPublishTip onShowCheck={onShowCheck} />
      </EaseContext>,
    )
    const tip = screen.getByTestId('tip-publish')
    expect(tip).toHaveTextContent('Tip: Check page looks for problems first.')
    expect(seeTip).toHaveBeenCalledWith('publish')
    await user.click(within(tip).getByRole('button', { name: 'Check page' }))
    expect(onShowCheck).toHaveBeenCalled()
    await user.click(within(tip).getByRole('button', { name: 'Dismiss tip' }))
    expect(screen.queryByTestId('tip-publish')).toBeNull()
  })

  it('is not shown once seen, or outside the editor', () => {
    const { unmount } = render(
      <EaseContext value={ui({ tipSeen: () => true })}>
        <FirstPublishTip />
      </EaseContext>,
    )
    expect(screen.queryByTestId('tip-publish')).toBeNull()
    unmount()
    render(<FirstPublishTip />)
    expect(screen.queryByTestId('tip-publish')).toBeNull()
  })
})

describe('B21 tour auto-start does not interrupt', () => {
  function Probe() {
    const ease = useEase({ userId: 'u-auto', editLocale: 'en', bangla: false })
    return <span data-testid="tour-state">{ease.tourOpen ? 'open' : 'closed'}</span>
  }

  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('opens by itself on a first visit when nothing else is going on', () => {
    render(<Probe />)
    act(() => vi.advanceTimersByTime(TOUR_DELAY + 10))
    expect(screen.getByTestId('tour-state')).toHaveTextContent('open')
  })

  it('stays closed when the person already started typing or clicking', () => {
    render(<Probe />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      vi.advanceTimersByTime(TOUR_DELAY + 10)
    })
    expect(screen.getByTestId('tour-state')).toHaveTextContent('closed')
  })

  it('stays closed while a dialog is open', () => {
    render(
      <>
        <div role="dialog" aria-label="Make global" />
        <Probe />
      </>,
    )
    act(() => vi.advanceTimersByTime(TOUR_DELAY + 10))
    expect(screen.getByTestId('tour-state')).toHaveTextContent('closed')
  })
})
