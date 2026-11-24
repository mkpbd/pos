import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useStorefront } from '../api'
import { isPreviewContext } from '../assistant/visibility'
import { cleanPixelIds } from './pixels'
import { configureTracking, track } from './track'

/**
 * BD1c: mounted once in the store layout (after the page, so the page's title is set): loads the
 * store's ad pixels after the first render and reports a page view on every route change. Never
 * in a staff preview — a draft or section preview, the builder canvas (/admin) or the store framed
 * in an editor. Renders nothing.
 */
export function TrackingHost() {
  const bootstrap = useStorefront()
  const { pathname, search } = useLocation()
  const { preview, tracking } = bootstrap
  const configured = useRef<string | null>(null)
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    const ids = preview || isPreviewContext({ pathname, search }) ? null : cleanPixelIds(tracking)
    const idsKey = ids ? `${ids.meta ?? ''}|${ids.ga4 ?? ''}|${ids.tiktok ?? ''}` : ''
    const path = `${pathname}${search}`
    if (configured.current !== idsKey) {
      configured.current = idsKey
      lastPath.current = path
      configureTracking(ids, ids ? { path } : undefined)
      return
    }
    if (lastPath.current === path) return
    lastPath.current = path
    track('page_view', { path })
  }, [pathname, search, preview, tracking])

  return null
}
