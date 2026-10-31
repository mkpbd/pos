import { useEffect, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import {
  BoldIcon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  UnderlineIcon,
  Undo2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, toPaginated } from '@/lib/api/client'
import type { MediaItem } from '@/features/media/api'
import { MediaPicker } from '@/features/media/components/media-picker'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (html: string) => void
  /** Accessible name of the editing area. */
  label: string
  id?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
}

/** Mirrors the server whitelist (ADR-009): site paths, http(s) and mailto links. */
function isAllowedLink(href: string): boolean {
  const value = href.trim()
  if (!value || /\s/.test(value)) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  return /^(https?:\/\/[^/\s]+|mailto:[^\s@]+@[^\s@]+)/i.test(value)
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(active && 'bg-accent text-accent-foreground')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function LinkButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  const [newTab, setNewTab] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = editor.isActive('link')

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      const attrs = editor.getAttributes('link') as { href?: string; target?: string | null }
      setHref(attrs.href ?? '')
      setNewTab(attrs.target === '_blank')
      setError(null)
    }
  }

  const apply = () => {
    if (!isAllowedLink(href)) return setError('Use a site path (/sale), an http(s) address or mailto:.')
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim(), target: newTab ? '_blank' : null }).run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Link" title="Link" aria-pressed={active} disabled={disabled} className={cn(active && 'bg-accent text-accent-foreground')}>
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-2">
        <Input
          aria-label="Link address"
          placeholder="/pages/about or https://…"
          value={href}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              apply()
            }
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} /> Open in a new tab
        </label>
        <div className="flex justify-end gap-2">
          {active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                setOpen(false)
              }}
            >
              Remove link
            </Button>
          )}
          <Button type="button" size="sm" onClick={apply}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [picking, setPicking] = useState(false)
  // Re-render the toolbar when the selection's formatting changes.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      h4: e.isActive('heading', { level: 4 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()

  const insertImage = async (ids: string[]) => {
    const id = ids[0]
    if (!id) return
    const res = await api.get<MediaItem[]>('/media', { query: { ids: id } }).then(toPaginated)
    const item = res.items[0]
    if (item) chain().setImage({ src: item.url, alt: item.alt ?? '' }).run()
  }

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
      <ToolButton label="Bold" active={state.bold} disabled={disabled} onClick={() => chain().toggleBold().run()}><BoldIcon /></ToolButton>
      <ToolButton label="Italic" active={state.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()}><ItalicIcon /></ToolButton>
      <ToolButton label="Underline" active={state.underline} disabled={disabled} onClick={() => chain().toggleUnderline().run()}><UnderlineIcon /></ToolButton>
      <ToolButton label="Strikethrough" active={state.strike} disabled={disabled} onClick={() => chain().toggleStrike().run()}><StrikethroughIcon /></ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton label="Heading 2" active={state.h2} disabled={disabled} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2Icon /></ToolButton>
      <ToolButton label="Heading 3" active={state.h3} disabled={disabled} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3Icon /></ToolButton>
      <ToolButton label="Heading 4" active={state.h4} disabled={disabled} onClick={() => chain().toggleHeading({ level: 4 }).run()}><Heading4Icon /></ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton label="Bulleted list" active={state.bullet} disabled={disabled} onClick={() => chain().toggleBulletList().run()}><ListIcon /></ToolButton>
      <ToolButton label="Numbered list" active={state.ordered} disabled={disabled} onClick={() => chain().toggleOrderedList().run()}><ListOrderedIcon /></ToolButton>
      <ToolButton label="Quote" active={state.quote} disabled={disabled} onClick={() => chain().toggleBlockquote().run()}><QuoteIcon /></ToolButton>
      <ToolButton label="Divider" disabled={disabled} onClick={() => chain().setHorizontalRule().run()}><MinusIcon /></ToolButton>
      <LinkButton editor={editor} disabled={disabled} />
      <ToolButton label="Image" disabled={disabled} onClick={() => setPicking(true)}><ImageIcon /></ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton label="Undo" disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()}><Undo2Icon /></ToolButton>
      <ToolButton label="Redo" disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()}><Redo2Icon /></ToolButton>
      <MediaPicker open={picking} onOpenChange={setPicking} title="Insert image" selected={[]} onConfirm={(ids) => void insertImage(ids)} />
    </div>
  )
}

/**
 * Rich text with the formatting the server keeps (headings 2–4, emphasis, lists, quotes,
 * links, images from the media library). The server sanitizes again on save; this editor
 * only offers what survives. Emits "" for an empty document.
 */
export function RichTextEditor({ value, onChange, label, id, invalid, disabled = false, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Image,
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(id ? { id } : {}),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        class: 'rich-text min-h-48 px-3 py-2 outline-none',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  })

  // Adopt values set from outside (loading a record, resetting the form).
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (value !== current) editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <div className={cn('overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring/50', invalid && 'border-destructive', className)}>
      {editor && !disabled && <Toolbar editor={editor} disabled={disabled} />}
      <EditorContent editor={editor} />
    </div>
  )
}
