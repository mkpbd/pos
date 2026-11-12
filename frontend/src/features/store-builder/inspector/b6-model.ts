/*
 * B6 editor helpers (pure): list item ids, moving the Bangla texts of list items along with the
 * items, chart label translations, hotspot positions and the Google Maps link of a map.
 */

import type { ChartDataChange } from './chart-data'

type Translations = Record<string, Record<string, string>>

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A fresh item id `<prefix>_<6 random [a-z0-9]>` (ITEM_ID pattern) not used by the list. */
export function newItemId(items: readonly { id: string }[], prefix = 'i'): string {
  const taken = new Set(items.map((i) => i.id))
  for (;;) {
    let id = `${prefix}_`
    for (let i = 0; i < 6; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
    if (!taken.has(id)) return id
  }
}

/** What changed besides the order and the items' values (so the caller can move the items' Bangla texts along). */
export type ItemListChange = {
  removed?: string
  duplicated?: { from: string; to: string }
  /** Typing in one item field: edits with the same key are one undo step. */
  typing?: string
}

/**
 * The translations after a list change: a removed item's texts are dropped, a duplicated item's
 * texts are copied to the copy (`<list>.<item_id>.<field>` in every locale).
 */
export function moveItemTranslations(translations: Translations, list: string, change: ItemListChange | undefined): Translations {
  if (!change?.removed && !change?.duplicated) return translations
  const out: Translations = {}
  for (const [locale, texts] of Object.entries(translations)) {
    const next: Record<string, string> = {}
    for (const [key, text] of Object.entries(texts)) {
      if (change.removed && key.startsWith(`${list}.${change.removed}.`)) continue
      next[key] = text
      const from = change.duplicated ? `${list}.${change.duplicated.from}.` : null
      if (change.duplicated && from && key.startsWith(from)) next[`${list}.${change.duplicated.to}.${key.slice(from.length)}`] = text
    }
    if (Object.keys(next).length > 0) out[locale] = next
  }
  return out
}

/**
 * Chart label translations are stored by position (`labels.<i>`): a removed row shifts the later
 * ones up, and a label whose text changed drops its Bangla text (it no longer matches). Series
 * names (`series.<id>.name`) of removed series are dropped.
 */
export function chartLabelTranslations(translations: Translations, before: readonly string[], after: readonly string[], change: ChartDataChange | undefined, series: readonly { id: string }[]): Translations {
  const removedRow = change?.removedRow
  const shifted = removedRow !== undefined ? before.filter((_, i) => i !== removedRow) : before
  const ids = new Set(series.map((s) => s.id))
  const out: Translations = {}
  for (const [locale, texts] of Object.entries(translations)) {
    const next: Record<string, string> = {}
    for (const [key, text] of Object.entries(texts)) {
      const label = /^labels\.(\d+)$/.exec(key)
      const name = /^series\.([^.]+)\.name$/.exec(key)
      if (label) {
        let index = Number(label[1])
        if (removedRow !== undefined) {
          if (index === removedRow) continue
          if (index > removedRow) index -= 1
        }
        if (index >= after.length || shifted[index] !== after[index]) continue
        next[`labels.${index}`] = text
      } else if (name) {
        if (ids.has(name[1]!)) next[key] = text
      } else next[key] = text
    }
    if (Object.keys(next).length > 0) out[locale] = next
  }
  return out
}

/** 0–100, two decimals (hotspot positions). */
export const clampPercent = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100

/** The Google Maps address of a map query (the storefront's embed uses the same query). */
export const mapsUrl = (query: string) => `https://www.google.com/maps?q=${encodeURIComponent(query.trim())}`

/** Defaults the storefront uses when a motion's duration / delay are absent. */
export const MOTION_DEFAULTS = { duration: 600, delay: 0 } as const
