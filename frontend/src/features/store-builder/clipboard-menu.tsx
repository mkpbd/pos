import { ClipboardCopyIcon, ClipboardPasteIcon, GlobeIcon, PaintbrushIcon, PaintBucketIcon, PencilIcon, UnlinkIcon } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { useCommands } from './commands'
import { globalRefOf } from './global-sections'
import { useEditorStoreApi } from './store'
import type { NodeKind } from './tree'
import { findNode } from './tree'

/*
 * B9: the copy & paste and global section items of a node's menu (the canvas mini toolbar's ⋯ and
 * the Layers row's ⋯): Copy, Paste, Copy style, Paste style, and Make global / Edit global section /
 * Detach. Rendered when the menu opens, so Paste style reflects what was copied last.
 */

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export function NodeClipboardItems({ id, kind }: { id: string; kind: NodeKind }) {
  const commands = useCommands()
  const store = useEditorStoreApi()
  const node = findNode(store.getState().content, id)?.node
  const ref = globalRefOf(node)
  const canPasteStyle = commands.canPasteStyle(id)

  return (
    <>
      {kind !== 'column' && (
        <DropdownMenuItem onSelect={() => commands.copy(id)}>
          <ClipboardCopyIcon /> Copy
          <DropdownMenuShortcut>{MOD}C</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onSelect={() => {
          store.getState().select(id)
          commands.paste(null)
        }}
      >
        <ClipboardPasteIcon /> {kind === 'column' ? 'Paste into this column' : 'Paste after this'}
        <DropdownMenuShortcut>{MOD}V</DropdownMenuShortcut>
      </DropdownMenuItem>
      {!ref && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => commands.copyStyleOf(id)}>
            <PaintbrushIcon /> Copy style
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canPasteStyle} onSelect={() => commands.pasteStyleTo(id)}>
            <PaintBucketIcon /> Paste style
          </DropdownMenuItem>
        </>
      )}
      {kind === 'section' && !ref && commands.requestMakeGlobal && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => commands.requestMakeGlobal?.(id)}>
            <GlobeIcon /> Make global…
          </DropdownMenuItem>
        </>
      )}
      {ref && (
        <>
          <DropdownMenuSeparator />
          {commands.openGlobal && (
            <DropdownMenuItem onSelect={() => commands.openGlobal?.(ref.ref)}>
              <PencilIcon /> Edit global section
            </DropdownMenuItem>
          )}
          {commands.requestDetach && (
            <DropdownMenuItem onSelect={() => commands.requestDetach?.(id)}>
              <UnlinkIcon /> Detach from global…
            </DropdownMenuItem>
          )}
        </>
      )}
    </>
  )
}
