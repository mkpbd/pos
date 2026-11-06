/**
 * A deliberately tiny markdown subset for AI answers: paragraphs (single newlines become line
 * breaks), headings (shown as bold lines), bullet and numbered lists, fenced code, simple pipe
 * tables, and inline **bold**, *italic* and `code`.
 *
 * Safety: the parser only produces a tree of plain strings. The renderer turns that tree into
 * React elements, so every character the model wrote ends up as escaped text — raw HTML
 * (`<script>`, `<img onerror=…>`), entities and links are shown literally, never interpreted.
 * Links keep their text only (no href is ever built from model output).
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'br' }

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'code'; value: string }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }

/** Answers are short; anything longer is cut so a runaway reply cannot freeze the page. */
export const MAX_MARKDOWN_LENGTH = 20_000
const MAX_DEPTH = 4

const BULLET = /^\s{0,6}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,6}(\d{1,4})[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const FENCE = /^\s{0,3}(```|~~~)/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

const WORD = /[\p{L}\p{N}_]/u
/** Private-use character that stands in for backslash-escaped markup while parsing. */
const SENTINEL = ''
const ESCAPED = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g')

type InlineRule = { open: string; close: string; type: 'code' | 'strong' | 'em'; wordBound?: boolean }

// Order matters for ties: longer delimiters first.
const INLINE_RULES: InlineRule[] = [
  { open: '`', close: '`', type: 'code' },
  { open: '**', close: '**', type: 'strong' },
  { open: '__', close: '__', type: 'strong', wordBound: true },
  { open: '*', close: '*', type: 'em' },
  { open: '_', close: '_', type: 'em', wordBound: true },
]

type Match = { start: number; end: number; inner: string; rule: InlineRule }

function findClose(text: string, rule: InlineRule, from: number): number {
  let i = text.indexOf(rule.close, from)
  while (i !== -1) {
    const before = text[i - 1] ?? ''
    const after = text[i + rule.close.length] ?? ''
    const validEnd = rule.type === 'code' || (before.trim() !== '' && !(rule.wordBound && WORD.test(after)))
    // "**" must not be read as two "*" (and vice versa).
    const doubled = rule.close.length === 1 && rule.type !== 'code' && (after === rule.close || before === rule.close)
    if (validEnd && !doubled && i > from) return i
    i = text.indexOf(rule.close, i + 1)
  }
  return -1
}

function nextMatch(text: string): Match | null {
  let best: Match | null = null
  for (const rule of INLINE_RULES) {
    let start = text.indexOf(rule.open)
    while (start !== -1 && (best === null || start < best.start)) {
      const before = text[start - 1] ?? ''
      const after = text[start + rule.open.length] ?? ''
      const doubled = rule.open.length === 1 && rule.type !== 'code' && (after === rule.open || before === rule.open)
      const validStart = rule.type === 'code' || (after.trim() !== '' && !(rule.wordBound && WORD.test(before)))
      if (validStart && !doubled) {
        const close = findClose(text, rule, start + rule.open.length)
        if (close !== -1) {
          best = { start, end: close + rule.close.length, inner: text.slice(start + rule.open.length, close), rule }
          break
        }
      }
      start = text.indexOf(rule.open, start + 1)
    }
  }
  return best
}

/** Markdown links `[text](url)` keep only their text; images keep only their alt text. */
function stripLinks(text: string): string {
  return text.replace(/!?\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
}

function pushText(out: Inline[], value: string) {
  if (value === '') return
  const last = out[out.length - 1]
  if (last?.type === 'text') last.value += value
  else out.push({ type: 'text', value })
}

function parseSpan(text: string, depth: number): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest.length > 0) {
    const match = depth < MAX_DEPTH ? nextMatch(rest) : null
    if (!match) {
      pushText(out, rest)
      break
    }
    pushText(out, rest.slice(0, match.start))
    if (match.rule.type === 'code') out.push({ type: 'code', value: match.inner })
    else out.push({ type: match.rule.type, children: parseSpan(match.inner, depth + 1) })
    rest = rest.slice(match.end)
  }
  return out
}

/** Inline formatting of one line (or several joined by line breaks). */
export function parseInline(text: string): Inline[] {
  const lines = text.split('\n')
  const out: Inline[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'br' })
    // Backslash escapes: "\*" is a literal star.
    const escaped = line.replace(/\\([\\`*_[\]#|>-])/g, (_m, c: string) => `${SENTINEL}${c.charCodeAt(0)}${SENTINEL}`)
    const restore = (nodes: Inline[]): Inline[] =>
      nodes.map((n) => {
        if (n.type === 'text' || n.type === 'code') return { ...n, value: n.value.replace(ESCAPED, (_m, code: string) => String.fromCharCode(Number(code))) }
        if (n.type === 'strong' || n.type === 'em') return { ...n, children: restore(n.children) }
        return n
      })
    out.push(...restore(parseSpan(stripLinks(escaped), 0)))
  })
  return out
}

function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (c === '\\' && row[i + 1] === '|') {
      current += '|'
      i++
    } else if (c === '|') {
      cells.push(current.trim())
      current = ''
    } else current += c
  }
  cells.push(current.trim())
  return cells
}

const isTableRow = (line: string | undefined) => line !== undefined && line.includes('|') && line.trim() !== ''

/** Parses the supported markdown subset into blocks. Never throws. */
export function parseMarkdown(source: string): Block[] {
  const text = (source ?? '').slice(0, MAX_MARKDOWN_LENGTH).replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n').trim()) })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
      flush()
      continue
    }

    if (FENCE.test(line)) {
      flush()
      const fence = line.trim().slice(0, 3)
      const body: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence)) body.push(lines[i++] ?? '')
      blocks.push({ type: 'code', value: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', children: parseInline(heading[1] ?? '') })
      continue
    }

    if (HORIZONTAL_RULE.test(line)) {
      flush()
      continue
    }

    if (isTableRow(line) && TABLE_SEPARATOR.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('-')) {
      flush()
      const header = splitRow(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i]) && !FENCE.test(lines[i] ?? '')) {
        const cells = splitRow(lines[i] ?? '')
        // Pad or cut to the header width.
        rows.push(header.map((_, c) => parseInline(cells[c] ?? '')))
        i++
      }
      i--
      blocks.push({ type: 'table', header: header.map((h) => parseInline(h)), rows })
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = bullet ? null : ORDERED.exec(line)
    if (bullet || ordered) {
      flush()
      const isOrdered = !!ordered
      const items: string[] = []
      const start = ordered ? Number(ordered[1]) : 1
      while (i < lines.length) {
        const current = lines[i] ?? ''
        const b = BULLET.exec(current)
        const o = b ? null : ORDERED.exec(current)
        if ((isOrdered && o) || (!isOrdered && b)) {
          items.push((isOrdered ? o?.[2] : b?.[1]) ?? '')
          i++
        } else if (current.trim() !== '' && /^\s{2,}\S/.test(current) && items.length > 0 && !(b || o)) {
          // An indented continuation line belongs to the previous item.
          items[items.length - 1] += `\n${current.trim()}`
          i++
        } else break
      }
      i--
      blocks.push({ type: 'list', ordered: isOrdered, start, items: items.map((item) => parseInline(item.trim())) })
      continue
    }

    paragraph.push(line)
  }
  flush()
  return blocks
}

/** Plain text of inline nodes (for labels and tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.value : n.type === 'br' ? '\n' : inlineText(n.children))).join('')
}
