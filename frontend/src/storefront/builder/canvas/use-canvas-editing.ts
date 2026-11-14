import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { NODE_ID } from '../registry'
import type { BuilderPage, RenderPageSection } from '../types'
import type { CanvasMessage, ImageDropTarget, TextFieldKind } from './protocol'
import { sanitizeRichText } from './sanitize'
import { TextEditSession, type FormatCommand } from './text-edit'
import { fieldTargets, imageTargetOf, indexNodes, type FieldTarget, type TreeNode } from './text-fields'

/*
 * B10: editing on the canvas — texts in place (double-click, Enter on the selected node, or the
 * editor's `edit-text`), the format bar's link round trip, and pictures dropped from the desktop
 * onto an image or a background-image node (handed to the editor, which uploads them).
 *
 * While a text is edited the drawn page is frozen (the editor's render frames still update the
 * outlines), so React never touches the element being typed in. A commit keeps the typed text on
 * screen until the editor's next render arrives (or 1.5 s), then the element's own nodes go back
 * and React draws the committed value.
 */

export type Editing = { id: string; field: string; kind: TextFieldKind; element: HTMLElement }

const HOLD_MS = 1500

/** Inside the element being edited or the format bar: pointer and key input belong to the edit. */
export function isEditUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-b-editing], [data-b-format-bar]') !== null
}

/** The node's element on the canvas (outside global sections, whose nodes are edited in the global). */
function nodeElement(id: string): HTMLElement | null {
  if (!NODE_ID.test(id)) return null
  const el = document.querySelector<HTMLElement>(`[data-b="${id}"]`)
  return el && !el.parentElement?.closest('[data-b-global]') ? el : null
}

/** The innermost of the targets that contain `node`. */
function targetAt(targets: FieldTarget[], node: Node): FieldTarget | undefined {
  const hits = targets.filter((target) => target.element.contains(node))
  return hits.find((hit) => !hits.some((other) => other !== hit && hit.element.contains(other.element)))
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

type Options = {
  post: (message: CanvasMessage) => void
  sections: readonly RenderPageSection[]
  page: BuilderPage | null
  locale: string
  /** The selected node (Enter edits its first text). */
  selection: string | null
}

export function useCanvasEditing({ post, sections, page, locale, selection }: Options) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [frozenPage, setFrozenPage] = useState<BuilderPage | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const session = useRef<TextEditSession | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const holding = useRef<number | null>(null)
  const linkPending = useRef(false)

  const nodes = useMemo(() => indexNodes(sections), [sections])
  // The latest values for the listeners below (they are added once).
  const latest = useRef({ post, nodes, page, locale, selection })
  useEffect(() => {
    latest.current = { post, nodes, page, locale, selection }
  })

  /** Ends the edit for good: the element's own nodes back, the page drawn from the latest frame. */
  const release = useCallback((apply?: () => void) => {
    if (holding.current !== null) window.clearTimeout(holding.current)
    holding.current = null
    detach.current?.()
    detach.current = null
    session.current?.restore()
    session.current = null
    linkPending.current = false
    flushSync(() => {
      apply?.()
      setEditing(null)
      setFrozenPage(null)
    })
  }, [])

  /** Commits (sends the value; the typed text stays until the next render) or cancels the edit. */
  const finish = useCallback(
    (mode: 'commit' | 'cancel') => {
      const current = session.current
      if (!current || holding.current !== null) return
      detach.current?.()
      detach.current = null
      linkPending.current = false
      if (mode === 'commit' && current.changed()) {
        latest.current.post({ type: 'text-edit-commit', id: current.id, field: current.field, value: current.value(), locale: current.locale, kind: current.kind })
        current.element.removeAttribute('contenteditable')
        flushSync(() => setEditing(null))
        holding.current = window.setTimeout(() => release(), HOLD_MS)
        return
      }
      latest.current.post({ type: 'text-edit-cancel', id: current.id, field: current.field })
      release()
    },
    [release],
  )

  /** Starts editing a text of a node: `field` (else the one at `point`, else its first). False when it has none on the canvas. */
  const startEdit = useCallback(
    (id: string, field?: string, point?: { x: number; y: number; node?: Node }): boolean => {
      if (session.current) {
        if (holding.current !== null) release()
        else finish('commit')
      }
      const { nodes: index, page: current, locale: lang } = latest.current
      const node = index.get(id)
      const root = nodeElement(id)
      if (!node || node.global || !root || !current) return false
      const targets = fieldTargets(root, node)
      const target = field ? targets.find((t) => t.field === field) : point?.node ? targetAt(targets, point.node) : targets[0]
      if (!target) return false
      const edit = new TextEditSession(target, id, lang)
      session.current = edit
      flushSync(() => {
        setFrozenPage(current)
        setEditing({ id, field: target.field, kind: target.kind, element: target.element })
      })
      edit.start(point)
      detach.current = attachFieldListeners(edit, finish)
      latest.current.post({ type: 'text-edit-start', id, field: target.field, locale: lang, kind: target.kind })
      return true
    },
    [finish, release],
  )

  /** A double-click: edit the text under the pointer, or replace the picture of an image / background node. */
  const onDoubleClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target || target.closest('[data-b-global]')) return
      const owner = target.closest<HTMLElement>('[data-b]')
      const id = owner?.dataset.b
      if (!id) return
      if (startEdit(id, undefined, { x: event.clientX, y: event.clientY, node: target })) return
      // A picture: the image itself, else the background of the node (or of the section around an empty column).
      const { nodes: index } = latest.current
      let el: HTMLElement | null = owner
      for (let depth = 0; el && depth < 3; depth += 1) {
        const node = el.dataset.b ? index.get(el.dataset.b) : undefined
        const kind = imageTargetOf(node)
        if (node && kind) {
          latest.current.post({ type: 'image-replace', id: node.id, target: kind })
          return
        }
        if (node && node.type !== 'column') return
        el = el.parentElement?.closest<HTMLElement>('[data-b]') ?? null
      }
    },
    [startEdit],
  )

  /** Enter on the selected node edits its first text (when focus is in the canvas). */
  const onEnter = useCallback((): boolean => {
    const { selection: selected } = latest.current
    return !session.current && typeof selected === 'string' && startEdit(selected)
  }, [startEdit])

  /** The editor's `render`: a committed edit hands the element back before React draws the new value. */
  const beforeRender = useCallback(
    (apply: () => void): boolean => {
      if (holding.current === null) return false
      release(apply)
      return true
    },
    [release],
  )

  const answerLink = useCallback((url: string | null) => {
    if (!linkPending.current || !session.current) return
    linkPending.current = false
    session.current.applyLink(typeof url === 'string' ? url.trim() : null)
  }, [])

  const requestLink = useCallback(() => {
    const current = session.current
    if (!current || current.kind !== 'html') return
    current.saveSelection()
    linkPending.current = true
    latest.current.post({ type: 'text-edit-link', id: current.id, field: current.field, url: current.currentLink() })
  }, [])

  const format = useCallback((command: FormatCommand) => session.current?.format(command), [])

  // A pointer press outside the text (and its bar) commits; focus leaving the canvas commits too,
  // unless the editor is asking for a link.
  useEffect(() => {
    const onPointer = (event: Event) => {
      if (session.current && holding.current === null && !isEditUi(event.target)) finish('commit')
    }
    const onBlur = () => {
      if (session.current && holding.current === null && !linkPending.current) finish('commit')
    }
    document.addEventListener('pointerdown', onPointer, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointer, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [finish])

  // Pictures dragged in from the desktop: the image or background-image node under the pointer.
  useEffect(() => {
    const dropNodeAt = (target: EventTarget | null): { id: string; kind: ImageDropTarget } | null => {
      if (!(target instanceof Element) || target.closest('[data-b-global]')) return null
      let el = target.closest<HTMLElement>('[data-b]')
      while (el) {
        const node: TreeNode | undefined = el.dataset.b ? latest.current.nodes.get(el.dataset.b) : undefined
        const kind = imageTargetOf(node)
        if (node && kind) return { id: node.id, kind }
        el = el.parentElement?.closest<HTMLElement>('[data-b]') ?? null
      }
      return null
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      // Never let the browser open the file in the canvas.
      event.preventDefault()
      const hit = isEditUi(event.target) ? null : dropNodeAt(event.target)
      if (event.dataTransfer) event.dataTransfer.dropEffect = hit ? 'copy' : 'none'
      setDropTarget(hit?.id ?? null)
    }
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDropTarget(null)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDropTarget(null)
      const hit = isEditUi(event.target) ? null : dropNodeAt(event.target)
      const file = event.dataTransfer?.files?.[0]
      if (hit && file) latest.current.post({ type: 'image-drop', id: hit.id, target: hit.kind, file })
    }
    document.addEventListener('dragover', onOver, { capture: true })
    document.addEventListener('dragenter', onOver, { capture: true })
    document.addEventListener('dragleave', onLeave, { capture: true })
    document.addEventListener('drop', onDrop, { capture: true })
    return () => {
      document.removeEventListener('dragover', onOver, { capture: true })
      document.removeEventListener('dragenter', onOver, { capture: true })
      document.removeEventListener('dragleave', onLeave, { capture: true })
      document.removeEventListener('drop', onDrop, { capture: true })
    }
  }, [])

  // Leaving the canvas (unmount) ends any edit.
  useEffect(
    () => () => {
      if (holding.current !== null) window.clearTimeout(holding.current)
      detach.current?.()
      session.current?.restore()
    },
    [],
  )

  /** Whether a text is being edited: the canvas keeps the editor's shortcuts away. */
  const isEditing = useCallback(() => session.current !== null && holding.current === null, [])

  return { editing, frozenPage, dropTarget, startEdit, finish, onDoubleClick, onEnter, beforeRender, answerLink, requestLink, format, isEditing }
}

/** Keys and paste inside the edited element. Returns the remover. */
function attachFieldListeners(edit: TextEditSession, finish: (mode: 'commit' | 'cancel') => void): () => void {
  const el = edit.element
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish('cancel')
    } else if (event.key === 'Tab') {
      event.preventDefault()
      finish('commit')
    } else if (event.key === 'Enter' && edit.kind === 'line') {
      event.preventDefault()
      finish('commit')
    } else if (edit.kind !== 'html' && (event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
      // Plain fields have no formatting.
      event.preventDefault()
    }
  }
  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data) return
    event.preventDefault()
    const doc = document as Document & { execCommand?: (command: string, ui?: boolean, value?: string) => boolean }
    const html = edit.kind === 'html' ? data.getData('text/html') : ''
    const text = data.getData('text/plain')
    if (typeof doc.execCommand !== 'function') return
    if (html) doc.execCommand('insertHTML', false, sanitizeRichText(html))
    else doc.execCommand('insertText', false, edit.kind === 'line' ? text.replace(/\s*\n\s*/g, ' ') : text)
  }
  const onDrop = (event: DragEvent) => event.preventDefault()
  el.addEventListener('keydown', onKey)
  el.addEventListener('paste', onPaste)
  el.addEventListener('drop', onDrop)
  return () => {
    el.removeEventListener('keydown', onKey)
    el.removeEventListener('paste', onPaste)
    el.removeEventListener('drop', onDrop)
  }
}
