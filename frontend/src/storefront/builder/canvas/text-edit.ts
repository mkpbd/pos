import { stripTextEffects } from '../text-effect'
import type { TextFieldKind } from './protocol'
import { sanitizeHtml, sanitizeRichText } from './sanitize'
import type { FieldTarget } from './text-fields'

/*
 * B10: one in-place text edit on the canvas. The drawn element becomes `contenteditable` (plain
 * text for plain fields, rich text with the format bar for HTML fields); its original child nodes
 * are kept and put back when the edit ends, so React's own nodes are never lost — the canvas
 * shows the committed value from the editor's next render.
 */

export type FormatCommand = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'clear'

const LINK_URL = /^(?:\/(?![/\\])|#|https?:\/\/|mailto:)/i

/** A link the format bar may set: site-relative, an anchor, http(s) or mailto, at most 2048 characters. */
export function isEditLink(url: string): boolean {
  return url.length > 0 && url.length <= 2048 && !/[\s<>"]/.test(url) && LINK_URL.test(url)
}

function exec(command: string, value?: string): boolean {
  const doc = document as Document & { execCommand?: (command: string, ui?: boolean, value?: string) => boolean }
  try {
    return typeof doc.execCommand === 'function' ? doc.execCommand(command, false, value) : false
  } catch {
    return false
  }
}

/**
 * The typed text: text nodes as they are (not `innerText`, which would apply the theme's heading
 * case), `<br>` and the browser's line blocks as line breaks.
 */
const NL = '\n'

export function readPlain(element: Node): string {
  let out = ''
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue ?? ''
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName
        if (tag === 'BR') out += NL
        else if (tag === 'DIV' || tag === 'P') {
          if (out !== '' && !out.endsWith(NL)) out += NL
          walk(child)
        } else walk(child)
      }
    }
  }
  walk(element)
  return out
}

/** A plain field's value as typed: no `\r`, single-line fields on one line, trimmed. */
export function normalizePlain(text: string, kind: TextFieldKind): string {
  const value = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ')
  return kind === 'line' ? value.replace(/\s*\n\s*/g, ' ').trim() : value.replace(/[ \t]+\n/g, '\n').trim()
}

export class TextEditSession {
  readonly id: string
  readonly field: string
  readonly kind: TextFieldKind
  readonly locale: string
  readonly element: HTMLElement
  private readonly originals: Node[]
  private readonly original: string
  private readonly attributes: Record<string, string | null>
  private range: Range | null = null
  private ended = false

  constructor(target: FieldTarget, id: string, locale: string) {
    this.id = id
    this.field = target.field
    this.kind = target.kind
    this.locale = locale
    this.element = target.element
    this.originals = Array.from(target.element.childNodes)
    this.original = target.html ? sanitizeRichText(sanitizeHtml(target.value)) : normalizePlain(target.value, target.kind)
    this.attributes = Object.fromEntries(['contenteditable', 'spellcheck', 'role', 'aria-multiline', 'aria-label', 'tabindex'].map((name) => [name, target.element.getAttribute(name)]))
  }

  /** Makes the element editable and focuses it: the caret at `point` (a double-click) or everything selected. */
  start(point?: { x: number; y: number }) {
    const el = this.element
    // B18: the text effect's decorations are not part of the text being edited.
    el.querySelectorAll('.b-te-fx').forEach((overlay) => overlay.remove())
    stripTextEffects(el)
    el.dataset.bEditing = this.kind
    if (this.kind === 'html') el.setAttribute('contenteditable', 'true')
    else {
      // Plain fields take plain text only (where the browser can; else paste is cleaned below).
      el.setAttribute('contenteditable', 'plaintext-only')
      if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true')
    }
    el.setAttribute('spellcheck', 'true')
    el.setAttribute('role', 'textbox')
    el.setAttribute('aria-multiline', this.kind === 'line' ? 'false' : 'true')
    el.setAttribute('aria-label', 'Edit text on the page. Enter or Tab saves, Escape cancels.')
    el.setAttribute('tabindex', '-1')
    if (this.kind === 'html') exec('defaultParagraphSeparator', 'p')
    el.focus({ preventScroll: true })
    const selection = window.getSelection()
    if (!selection) return
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const caret = point && typeof doc.caretRangeFromPoint === 'function' ? doc.caretRangeFromPoint(point.x, point.y) : null
    if (caret && el.contains(caret.startContainer)) {
      selection.removeAllRanges()
      selection.addRange(caret)
      return
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** The value now: plain text, or the rich text sanitized to the server's tags. */
  value(): string {
    return this.kind === 'html' ? sanitizeRichText(this.element.innerHTML) : normalizePlain(readPlain(this.element), this.kind)
  }

  changed(): boolean {
    return this.value() !== this.original
  }

  /** Takes the edit away: the element's own nodes and attributes back. Safe to call twice. */
  restore() {
    if (this.ended) return
    this.ended = true
    const el = this.element
    delete el.dataset.bEditing
    for (const [name, value] of Object.entries(this.attributes)) {
      if (value === null) el.removeAttribute(name)
      else el.setAttribute(name, value)
    }
    el.replaceChildren(...this.originals)
    if (document.activeElement === el) el.blur()
  }

  get isEnded() {
    return this.ended
  }

  /** Remembers the selection (before the editor's link prompt takes the focus). */
  saveSelection() {
    const selection = window.getSelection()
    this.range = selection && selection.rangeCount > 0 && this.element.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange() : null
  }

  restoreSelection() {
    this.element.focus({ preventScroll: true })
    const selection = window.getSelection()
    if (!selection || !this.range) return
    selection.removeAllRanges()
    selection.addRange(this.range)
  }

  /** The link at the selection, if any. */
  currentLink(): string | null {
    const selection = window.getSelection()
    const node = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null
    const element = node ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) : null
    const anchor = element?.closest('a')
    return anchor && this.element.contains(anchor) ? anchor.getAttribute('href') : null
  }

  /** The editor's answer to the link prompt: a URL links the selection, '' removes the link, null changes nothing. */
  applyLink(url: string | null) {
    this.restoreSelection()
    if (url === null) return
    if (url === '') exec('unlink')
    else if (isEditLink(url)) exec('createLink', url)
  }

  format(command: FormatCommand) {
    if (this.kind !== 'html') return
    if (command !== 'clear') {
      exec(command)
      return
    }
    // Clear formatting: the selection, or the whole text when nothing is selected.
    const selection = window.getSelection()
    if (selection && (selection.rangeCount === 0 || selection.isCollapsed)) {
      const range = document.createRange()
      range.selectNodeContents(this.element)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    exec('removeFormat')
    exec('unlink')
  }
}

/** Is a format command on at the selection (bold, a list …)? */
export function formatState(command: Exclude<FormatCommand, 'clear'>): boolean {
  const doc = document as Document & { queryCommandState?: (command: string) => boolean }
  try {
    return typeof doc.queryCommandState === 'function' ? doc.queryCommandState(command) : false
  } catch {
    return false
  }
}
