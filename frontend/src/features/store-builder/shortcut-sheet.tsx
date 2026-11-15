import { Fragment } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { IS_MAC } from './format'

/*
 * B12: the keyboard shortcut sheet (`?`, or toolbar ⋯ → Keyboard shortcuts). Every shortcut of
 * the editor, grouped, with the Windows and the Mac keys (the reader's own system first).
 */

/** `mod` stands for Ctrl (Windows) / ⌘ (Mac); `alt` for Alt / ⌥. */
type Shortcut = { keys: string[][]; what: string }

const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Anywhere in the editor',
    items: [
      { keys: [['mod', 'K']], what: 'Find an element, a page or an action' },
      { keys: [['?']], what: 'Show these shortcuts' },
      { keys: [['mod', 'Z']], what: 'Undo' },
      { keys: [['mod', 'Shift', 'Z'], ['mod', 'Y']], what: 'Redo' },
    ],
  },
  {
    title: 'Choosing things on the page',
    items: [
      { keys: [['Click']], what: 'Select an item' },
      { keys: [['mod', 'Click']], what: 'Add an item to the selection, or take it out' },
      { keys: [['Shift', 'Click']], what: 'Select everything between two items side by side' },
      { keys: [['↑'], ['↓']], what: 'Select the item before or after' },
      { keys: [['Esc']], what: 'Several selected: clear the selection. One: select what it sits in' },
    ],
  },
  {
    title: 'Changing the selection',
    items: [
      { keys: [['Enter']], what: 'Edit the text on the page' },
      { keys: [['mod', 'D']], what: 'Duplicate' },
      { keys: [['Delete'], ['Backspace']], what: 'Delete (asks first)' },
      { keys: [['mod', 'C']], what: 'Copy (paste it on any page)' },
      { keys: [['mod', 'V']], what: 'Paste after the selection' },
    ],
  },
  {
    title: 'Editing text on the page',
    items: [
      { keys: [['mod', 'B']], what: 'Bold' },
      { keys: [['mod', 'I']], what: 'Italic' },
      { keys: [['Esc']], what: 'Finish editing' },
    ],
  },
  {
    title: 'Dragging spacing and column handles',
    items: [
      { keys: [['alt', 'Drag']], what: 'Move freely, without snapping' },
      { keys: [['←'], ['→'], ['↑'], ['↓']], what: 'Change it step by step (handle focused)' },
    ],
  },
]

function keyName(key: string, mac: boolean): string {
  if (key === 'mod') return mac ? '⌘' : 'Ctrl'
  if (key === 'alt') return mac ? '⌥ Option' : 'Alt'
  if (key === 'Shift') return mac ? '⇧ Shift' : 'Shift'
  if (key === 'Backspace') return mac ? '⌫ Delete' : 'Backspace'
  return key
}

function Keys({ keys, mac }: { keys: string[][]; mac: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
          <span className="inline-flex items-center gap-0.5">
            {combo.map((key, j) => (
              <Fragment key={j}>
                {j > 0 && <span aria-hidden className="text-xs text-muted-foreground">+</span>}
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keyName(key, mac)}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const systems = IS_MAC ? ([['Mac', true], ['Windows', false]] as const) : ([['Windows', false], ['Mac', true]] as const)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="shortcut-sheet">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work faster in the page builder. Shortcuts don’t act while you type in a field.</DialogDescription>
        </DialogHeader>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`shortcuts-${group.title}`} className="flex flex-col gap-1">
            <h3 id={`shortcuts-${group.title}`} className="text-sm font-semibold">
              {group.title}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-1/2 text-left font-normal"><span className="sr-only">What it does</span></th>
                    {systems.map(([name]) => (
                      <th key={name} scope="col" className="text-left font-normal">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.what} className="border-b last:border-b-0">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                        {item.what}
                      </th>
                      {systems.map(([name, mac]) => (
                        <td key={name} className="py-1.5 pr-2 align-top">
                          <Keys keys={item.keys} mac={mac} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
