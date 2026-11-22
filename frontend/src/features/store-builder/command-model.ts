/*
 * B12 command box model: fuzzy matching, grouping and the recent list. Pure, so it is unit-tested
 * without the dialog.
 */

export type CommandGroup = 'recent' | 'suggest' | 'action' | 'add' | 'template' | 'goto' | 'page'

export const GROUP_TITLES: Record<CommandGroup, string> = {
  recent: 'Recent',
  // B21: "What next?" — sections that usually follow the selected one.
  suggest: 'Suggested next',
  action: 'Actions',
  add: 'Add an element',
  template: 'Insert a template',
  goto: 'Go to on this page',
  page: 'Open another page',
}

const GROUP_ORDER: CommandGroup[] = ['suggest', 'action', 'add', 'template', 'goto', 'page']

export type CommandItem = {
  /** Unique across groups (`add:heading`, `goto:e_abc`, …); recent items are kept by it. */
  id: string
  group: Exclude<CommandGroup, 'recent'>
  label: string
  /** A second line (where it is, what it does). */
  hint?: string
  /** More words it is found by (Bangla names, synonyms). */
  words?: string
  /** Why it can't run now (shown; Enter does nothing). */
  disabled?: string | null
  run: () => void
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * How well `query` matches `text` (higher is better; 0 = no match): the whole query as a word
 * start beats it anywhere inside, which beats the letters in order (fuzzy). Each query word must
 * match somewhere. `fuzzy: false` (long hints and extra words) takes whole word parts only.
 */
export function matchScore(query: string, text: string, fuzzy = true): number {
  const q = normalize(query)
  if (!q) return 1
  const t = normalize(text)
  if (!t) return 0
  let total = 0
  for (const word of q.split(' ')) {
    const at = t.indexOf(word)
    if (at === 0) total += 100
    else if (at > 0 && /[\s:·/,(-]/.test(t[at - 1]!)) total += 80
    else if (at > 0) total += 50
    else {
      const letters = fuzzy ? subsequence(word, t) : 0
      if (letters === 0) return 0
      total += letters
    }
  }
  return total
}

/** Letters of `word` in order inside `text`: 1–30 (closer together scores higher), 0 = not there. */
function subsequence(word: string, text: string): number {
  let from = 0
  let first = -1
  let last = -1
  for (const char of word) {
    const at = text.indexOf(char, from)
    if (at < 0) return 0
    if (first < 0) first = at
    last = at
    from = at + 1
  }
  if (word.length < 2) return 0
  const spread = last - first + 1
  return Math.max(1, Math.round(30 * (word.length / spread)))
}

export type CommandSection = { group: CommandGroup; items: CommandItem[] }

/**
 * The sections to show: with no query, recent items first, then the actions and the first few of
 * each other group; with a query, the best matches of each group (recent ones slightly preferred).
 */
export function commandSections(items: readonly CommandItem[], query: string, recent: readonly string[], perGroup = 8): CommandSection[] {
  const q = query.trim()
  const sections: CommandSection[] = []
  if (!q) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const recents = recent.map((id) => byId.get(id)).filter((item): item is CommandItem => item !== undefined)
    if (recents.length > 0) sections.push({ group: 'recent', items: recents })
    const shown = new Set(recents.map((item) => item.id))
    for (const group of GROUP_ORDER) {
      const list = items.filter((item) => item.group === group && !shown.has(item.id))
      const limit = group === 'action' ? list.length : Math.min(perGroup, 5)
      if (list.length > 0) sections.push({ group, items: list.slice(0, limit) })
    }
    return sections
  }
  for (const group of GROUP_ORDER) {
    const scored = items
      .filter((item) => item.group === group)
      .map((item) => {
        const score = Math.max(matchScore(q, item.label) * 2, matchScore(q, `${item.label} ${item.hint ?? ''} ${item.words ?? ''}`, false))
        return { item, score: score > 0 && recent.includes(item.id) ? score + 15 : score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
    if (scored.length > 0) sections.push({ group, items: scored.slice(0, perGroup).map((entry) => entry.item) })
  }
  return sections
}

const RECENT_KEY = 'pos.builder.commands.recent'
export const RECENT_LIMIT = 6

export function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Puts an item first in the recent list (`goto:` items are this page's only, so they are not kept). */
export function rememberRecent(id: string): string[] {
  const list = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_LIMIT)
  if (id.startsWith('goto:')) return list
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Storage blocked: recent items last for this visit only.
  }
  return list
}
