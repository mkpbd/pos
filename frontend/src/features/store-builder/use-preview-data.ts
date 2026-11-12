import { useEffect, useMemo, useRef, useState } from 'react'
import { isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderContent, BuilderData, BuilderMedia, Element } from '@/storefront/builder/types'
import type { StoreSection } from '@/storefront/types'
import { resolvePreview, type Problem, type ResolveResult } from './api'
import { mediaIds, resolveInput, resolveKey, withLocalTitles, wrappedElements } from './render-tree'

/*
 * Data for the canvas's wrapped homepage sections, B4 data elements (countdown, discount, promo
 * card, menu, FAQ list, contact form) and images (B2): POST /builder/resolve, 400 ms
 * after the last change, only for wrapped elements whose resolve input changed and media ids not
 * seen yet. While an element is re-resolved its previous data stays on screen; an element that has
 * never had data is `pending` (the canvas draws a skeleton).
 */

export const RESOLVE_DEBOUNCE = 400
const MAX_ELEMENTS = 60
const MAX_MEDIA = 200

type Entry = { key: string; section: BuilderData | null; errors: Problem[] }

type Cache = { entries: Record<string, Entry>; media: Record<string, BuilderMedia>; missingMedia: Record<string, true> }

export type PreviewData = {
  data: Record<string, BuilderData>
  media: Record<string, BuilderMedia>
  pending: string[]
  /** Problems the resolve found per wrapped element (before any save). */
  errors: Record<string, Problem[]>
}

type Resolver = (input: Parameters<typeof resolvePreview>[0], signal?: AbortSignal) => Promise<ResolveResult>

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function usePreviewData(content: BuilderContent, options: { locale: string; localMedia: Record<string, BuilderMedia>; enabled: boolean; resolve?: Resolver }): PreviewData {
  const { locale, localMedia, enabled } = options
  const resolve = options.resolve ?? resolvePreview
  const [cache, setCache] = useState<Cache>({ entries: {}, media: {}, missingMedia: {} })
  const cacheRef = useRef(cache)
  useEffect(() => {
    cacheRef.current = cache
  }, [cache])
  const inFlight = useRef<Record<string, string>>({})
  const first = useRef(true)

  const elements = useMemo(() => wrappedElements(content), [content])
  const ids = useMemo(() => mediaIds(content), [content])

  useEffect(() => {
    if (!enabled) return
    const run = () => {
      const current = cacheRef.current
      const send = elements.filter((element) => {
        const key = resolveKey(element)
        return current.entries[element.id]?.key !== key && inFlight.current[element.id] !== key
      })
      const media = ids.filter((id) => !current.media[id] && !current.missingMedia[id] && !localMedia[id] && inFlight.current[`m:${id}`] === undefined)
      if (send.length === 0 && media.length === 0) return
      const keys = Object.fromEntries(send.map((element) => [element.id, resolveKey(element)]))
      for (const [id, key] of Object.entries(keys)) inFlight.current[id] = key
      for (const id of media) inFlight.current[`m:${id}`] = '1'
      const elementChunks = chunk(send, MAX_ELEMENTS)
      const mediaChunks = chunk(media, MAX_MEDIA)
      const rounds = Math.max(elementChunks.length, mediaChunks.length)
      for (let i = 0; i < rounds; i += 1) {
        const batch = elementChunks[i] ?? []
        const batchMedia = mediaChunks[i] ?? []
        resolve({ elements: batch.map(resolveInput), media_ids: batchMedia, locale })
          .then((result) => {
            setCache((previous) => {
              const entries = { ...previous.entries }
              for (const element of batch) {
                entries[element.id] = { key: keys[element.id]!, section: result.data[element.id] ?? null, errors: result.errors[element.id] ?? [] }
              }
              const missingMedia = { ...previous.missingMedia }
              for (const id of batchMedia) if (!result.media[id]) missingMedia[id] = true
              return { entries, media: { ...previous.media, ...result.media }, missingMedia }
            })
          })
          .catch(() => {
            // Not reachable now: the next change asks again.
          })
          .finally(() => {
            for (const element of batch) if (inFlight.current[element.id] === keys[element.id]) delete inFlight.current[element.id]
            for (const id of batchMedia) delete inFlight.current[`m:${id}`]
          })
      }
    }
    if (first.current) {
      first.current = false
      run()
      return
    }
    const timer = setTimeout(run, RESOLVE_DEBOUNCE)
    return () => clearTimeout(timer)
  }, [elements, ids, enabled, locale, localMedia, resolve])

  return useMemo(() => {
    const data: Record<string, BuilderData> = {}
    const pending: string[] = []
    const errors: Record<string, Problem[]> = {}
    for (const element of elements as Element[]) {
      const entry = cache.entries[element.id]
      if (entry?.section) data[element.id] = isWrappedSectionType(element.type) ? withLocalTitles(entry.section as StoreSection, element, locale) : entry.section
      else if (!entry || entry.key !== resolveKey(element)) pending.push(element.id)
      if (entry && entry.errors.length > 0 && entry.key === resolveKey(element)) errors[element.id] = entry.errors
    }
    return { data, media: { ...cache.media, ...localMedia }, pending, errors }
  }, [cache, elements, localMedia, locale])
}
