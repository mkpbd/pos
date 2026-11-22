import type { GroupSpec } from '../inspector/style-groups'

/*
 * B21 Easy building: what the editor remembers per person in this browser — Easy mode on or off,
 * whether the guided tour has been shown, and which one-line tips have been seen. Kept in
 * localStorage `pos.builder.ease.<user id>`; storage that is blocked or full is ignored (the
 * choices then last for this visit).
 *
 * The first time a person opens the editor there is no record yet. People who used the editor
 * before B21 (any other `pos.builder.*` key in this browser: the B12 recent commands, the undo
 * memory, the clipboard) start in full mode with the tour and tips already seen; everyone else
 * starts in Easy mode and gets the tour.
 */

export const EASE_PREFIX = 'pos.builder.ease.'
const VERSION = 1

export const TIP_IDS = ['picture', 'empty', 'publish'] as const
export type TipId = (typeof TIP_IDS)[number]

export type EaseRecord = {
  /** Easy mode: fewer controls. */
  easy: boolean
  /** The guided tour was shown (or skipped) — it doesn't open by itself again. */
  tourSeen: boolean
  /** Tips already shown. */
  tips: TipId[]
}

export function easeKey(userId: string): string {
  return `${EASE_PREFIX}${userId}`
}

const isTip = (value: unknown): value is TipId => typeof value === 'string' && (TIP_IDS as readonly string[]).includes(value)

/** The stored record, or null when there is none (or it can't be read). */
export function readEase(userId: string): EaseRecord | null {
  try {
    const text = window.localStorage.getItem(easeKey(userId))
    if (!text) return null
    const value = JSON.parse(text) as { v?: unknown; easy?: unknown; tour?: unknown; tips?: unknown }
    if (value?.v !== VERSION || typeof value.easy !== 'boolean') return null
    return { easy: value.easy, tourSeen: value.tour === true, tips: Array.isArray(value.tips) ? [...new Set(value.tips.filter(isTip))] : [] }
  } catch {
    return null
  }
}

export function writeEase(userId: string, record: EaseRecord): void {
  try {
    window.localStorage.setItem(easeKey(userId), JSON.stringify({ v: VERSION, easy: record.easy, tour: record.tourSeen, tips: record.tips }))
  } catch {
    // Storage blocked or full: the choice lasts until the editor is left.
  }
}

/** Someone used the store builder in this browser before (any builder key that isn't an Easy-building record). */
export function usedBuilderBefore(): boolean {
  try {
    const storage = window.localStorage
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key && key.startsWith('pos.builder.') && !key.startsWith(EASE_PREFIX)) return true
    }
  } catch {
    // Unreadable storage: treat as a first visit.
  }
  return false
}

/** What a person starts with: their record, else Easy mode + the tour (first visit) or full mode (they used the editor before). */
export function initialEase(userId: string): { record: EaseRecord; firstVisit: boolean } {
  const stored = readEase(userId)
  if (stored) return { record: stored, firstVisit: false }
  if (usedBuilderBefore()) return { record: { easy: false, tourSeen: true, tips: [...TIP_IDS] }, firstVisit: false }
  return { record: { easy: true, tourSeen: false, tips: [] }, firstVisit: true }
}

/**
 * B21: a page check "Fix it" target that Easy mode hides — the editor switches to full mode
 * first. Easy mode keeps the Content tab (except the hover and scroll pickers) and, on the Style
 * tab, the colours and the background; everything on the Advanced tab is hidden.
 */
export function easyHidesFix(tab: 'content' | 'style' | 'advanced', field: string | null): boolean {
  if (tab === 'advanced') return true
  if (tab === 'style') return field !== 'color' && field !== 'background'
  return field === 'card_hover' || field === 'ken_burns' || field === 'ken_burns_direction'
}

/** The Style groups kept in Easy mode (simple presets and colours; no hover, scroll, borders, shadows or raw sizes). */
const EASY_GROUPS = new Set(['background', 'button-colors', 'color', 'typography', 'spacing', 'layout', 'motion'])

export function easyGroups(groups: readonly GroupSpec[], nodeType: string): GroupSpec[] {
  // A button keeps "Fill the column width" (its Size group shows only that in Easy mode).
  return groups.filter((g) => EASY_GROUPS.has(g.id) || (g.id === 'size' && nodeType === 'button'))
}

