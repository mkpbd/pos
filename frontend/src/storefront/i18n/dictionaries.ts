import { useEffect, useState } from 'react'
import { en } from './en'
import type { Locale } from './runtime'
import type { Dictionary } from './translate'

/** English ships with the entry bundle; Bangla is a separate chunk, fetched the first time it is needed. */
const loaded: Partial<Record<Locale, Dictionary>> = { en }
const pending = new Map<Locale, Promise<Dictionary>>()

export function loadedDictionary(locale: Locale): Dictionary | undefined {
  return loaded[locale]
}

export function loadDictionary(locale: Locale): Promise<Dictionary> {
  const ready = loaded[locale]
  if (ready) return Promise.resolve(ready)
  let promise = pending.get(locale)
  if (!promise) {
    promise = import('./bn').then((module) => {
      loaded.bn = module.bn
      return module.bn
    })
    promise.catch(() => pending.delete(locale))
    pending.set(locale, promise)
  }
  return promise
}

/**
 * The dictionary for a locale and the locale it belongs to. While Bangla loads, the previous
 * dictionary stays on screen (switching), or nothing (null) on a first visit in Bangla. A failed
 * load falls back to English.
 */
export function useDictionary(locale: Locale): { dictionary: Dictionary; locale: Locale } | null {
  const [, setVersion] = useState(0)
  const [last, setLast] = useState<{ dictionary: Dictionary; locale: Locale } | null>(null)
  const [failed, setFailed] = useState<Locale | null>(null)
  const ready = loadedDictionary(locale)

  useEffect(() => {
    if (loadedDictionary(locale)) return
    let active = true
    loadDictionary(locale).then(
      () => active && setVersion((v) => v + 1),
      () => active && setFailed(locale),
    )
    return () => {
      active = false
    }
  }, [locale])

  const current = ready ? { dictionary: ready, locale } : failed === locale ? { dictionary: en, locale: 'en' as const } : null
  if (current && (last?.dictionary !== current.dictionary || last.locale !== current.locale)) setLast(current)
  return current ?? last
}
