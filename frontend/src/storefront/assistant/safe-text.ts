/*
 * AI2b: the assistant's replies are plain text. The widget understands a tiny subset and nothing else:
 * paragraphs (blank lines), bullet lines ("- ", "* ", "• "), **bold**, and [label](/path) links to this
 * store's own pages. Text is never parsed as HTML (tags show as typed); a link to anywhere else keeps only
 * its label; bare addresses stay plain text.
 */

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; children: Inline[] } | { kind: 'link'; label: string; path: string }

export type Block = { kind: 'paragraph'; lines: Inline[][] } | { kind: 'list'; items: Inline[][] }

const BULLET = /^\s*(?:[-*•])\s+(.*)$/
// Control and text-direction characters (not line breaks or tabs) never reach the screen.
const CONTROL_RANGES: [number, number][] = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]]
const isControl = (code: number) => CONTROL_RANGES.some(([from, to]) => code >= from && code <= to)
const stripControl = (text: string) => [...text].filter((char) => !isControl(char.codePointAt(0)!)).join('')
const hasControl = (text: string) => [...text].some((char) => isControl(char.codePointAt(0)!))
const TOKEN = /\*\*([^*\n]+?)\*\*|\[([^\]\n]{1,200})\]\(([^()\s]{1,500})\)/g
const LINK = /\[([^\]\n]{1,200})\]\(([^()\s]{1,500})\)/g

function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/**
 * A link target as a path on this store ("/product/kids-tee?variant=1#reviews"), or null: only a
 * root-relative path (not "//host", no backslashes, no spaces or control characters) or an absolute
 * http(s) address on this very origin.
 */
export function safeStorePath(target: string | null | undefined, origin: string = currentOrigin()): string | null {
  if (typeof target !== 'string') return null
  const value = target.trim()
  if (value === '' || value.length > 500 || /[\s\\]/.test(value) || hasControl(value)) return null
  let url: URL
  try {
    url = new URL(value, origin)
  } catch {
    return null
  }
  if (url.origin !== origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
  if (value.startsWith('/')) return value.startsWith('//') ? null : `${url.pathname}${url.search}${url.hash}`
  // An absolute address on this store's own host.
  return /^https?:\/\//i.test(value) ? `${url.pathname}${url.search}${url.hash}` : null
}

function pushText(out: Inline[], text: string) {
  if (text === '') return
  const last = out[out.length - 1]
  if (last?.kind === 'text') last.text += text
  else out.push({ kind: 'text', text })
}

/** Links only (inside bold text). */
function parseLinks(text: string, origin: string): Inline[] {
  const out: Inline[] = []
  let at = 0
  for (const match of text.matchAll(LINK)) {
    pushText(out, text.slice(at, match.index))
    const label = match[1]!
    const path = safeStorePath(match[2], origin)
    if (path) out.push({ kind: 'link', label, path })
    else pushText(out, label)
    at = match.index + match[0].length
  }
  pushText(out, text.slice(at))
  return out
}

export function parseInline(text: string, origin: string = currentOrigin()): Inline[] {
  const out: Inline[] = []
  let at = 0
  for (const match of text.matchAll(TOKEN)) {
    pushText(out, text.slice(at, match.index))
    if (match[1] !== undefined) {
      out.push({ kind: 'bold', children: parseLinks(match[1], origin) })
    } else {
      const label = match[2]!
      const path = safeStorePath(match[3], origin)
      if (path) out.push({ kind: 'link', label, path })
      else pushText(out, label)
    }
    at = match.index + match[0].length
  }
  pushText(out, text.slice(at))
  return out
}

/** The reply as blocks: paragraphs of lines and bullet lists. At most 4,000 characters are shown. */
export function parseAssistantText(text: string, origin: string = currentOrigin()): Block[] {
  const clean = stripControl(String(text ?? '').slice(0, 4000).replace(/\r\n?/g, '\n'))
  const blocks: Block[] = []
  let paragraph: Inline[][] | null = null
  let list: Inline[][] | null = null

  for (const raw of clean.split('\n')) {
    const line = raw.trimEnd()
    const bullet = BULLET.exec(line)
    if (line.trim() === '') {
      paragraph = null
      list = null
    } else if (bullet) {
      paragraph = null
      if (!list) {
        list = []
        blocks.push({ kind: 'list', items: list })
      }
      list.push(parseInline(bullet[1]!.trim(), origin))
    } else {
      list = null
      if (!paragraph) {
        paragraph = []
        blocks.push({ kind: 'paragraph', lines: paragraph })
      }
      paragraph.push(parseInline(line.trim(), origin))
    }
  }
  return blocks
}

/** The reply without markup, for the screen-reader announcement and the WhatsApp message. */
export function plainText(text: string, origin: string = currentOrigin()): string {
  const flatten = (inlines: Inline[]): string => inlines.map((node) => (node.kind === 'text' ? node.text : node.kind === 'link' ? node.label : flatten(node.children))).join('')
  return parseAssistantText(text, origin)
    .map((block) => (block.kind === 'paragraph' ? block.lines.map(flatten).join(' ') : block.items.map(flatten).join('; ')))
    .join(' ')
}
