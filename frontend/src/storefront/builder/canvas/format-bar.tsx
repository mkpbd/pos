import { useEffect, useLayoutEffect, useState, type MouseEvent } from 'react'
import { BoldIcon, ItalicIcon, LinkIcon, ListIcon, ListOrderedIcon, RemoveFormattingIcon, type LucideIcon } from 'lucide-react'
import { formatState, type FormatCommand } from './text-edit'

/*
 * B10: the small format bar over a rich text field being edited on the canvas: bold, italic,
 * link (the editor asks for the address), bulleted and numbered list, clear formatting. Buttons
 * keep the text selection (no focus on mousedown); Ctrl+B / Ctrl+I work in the text as well.
 */

type Button = { command: FormatCommand | 'link'; label: string; icon: LucideIcon; state?: Exclude<FormatCommand, 'clear'> }

const BUTTONS: readonly Button[] = [
  { command: 'bold', label: 'Bold', icon: BoldIcon, state: 'bold' },
  { command: 'italic', label: 'Italic', icon: ItalicIcon, state: 'italic' },
  { command: 'link', label: 'Link', icon: LinkIcon },
  { command: 'insertUnorderedList', label: 'Bulleted list', icon: ListIcon, state: 'insertUnorderedList' },
  { command: 'insertOrderedList', label: 'Numbered list', icon: ListOrderedIcon, state: 'insertOrderedList' },
  { command: 'clear', label: 'Clear formatting', icon: RemoveFormattingIcon },
]

const BAR_HEIGHT = 40

type Props = {
  /** The element being edited (the bar sits above it, or below near the top of the canvas). */
  target: HTMLElement
  onCommand: (command: FormatCommand) => void
  onLink: () => void
}

export function FormatBar({ target, onCommand, onLink }: Props) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [active, setActive] = useState<Record<string, boolean>>({})

  useLayoutEffect(() => {
    const place = () => {
      const rect = target.getBoundingClientRect()
      const top = rect.top - BAR_HEIGHT - 8 >= 4 ? rect.top - BAR_HEIGHT - 8 : rect.bottom + 8
      setPosition({ top: Math.max(4, Math.min(top, window.innerHeight - BAR_HEIGHT - 4)), left: Math.max(4, Math.min(rect.left, window.innerWidth - 260)) })
    }
    place()
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(target)
    return () => {
      window.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
  }, [target])

  useEffect(() => {
    const update = () => setActive(Object.fromEntries(BUTTONS.filter((b) => b.state).map((b) => [b.command, formatState(b.state!)])))
    update()
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  // Pressing a button never moves the focus out of the text (the selection stays).
  const keep = (event: MouseEvent) => event.preventDefault()

  return (
    <div
      role="toolbar"
      aria-label="Text format"
      data-b-format-bar=""
      data-testid="canvas-format-bar"
      className="fixed z-[2147483000] flex items-center gap-0.5 rounded-md border border-neutral-300 bg-white p-1 text-neutral-800 shadow-lg"
      style={{ top: position?.top ?? -9999, left: position?.left ?? 0, height: BAR_HEIGHT, font: '500 13px/1 system-ui, sans-serif' }}
    >
      {BUTTONS.map(({ command, label, icon: Icon, state }) => (
        <button
          key={command}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={state ? Boolean(active[command]) : undefined}
          onMouseDown={keep}
          onClick={() => (command === 'link' ? onLink() : onCommand(command))}
          className="grid size-8 place-items-center rounded hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-600 aria-pressed:bg-blue-100 aria-pressed:text-blue-800"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  )
}
