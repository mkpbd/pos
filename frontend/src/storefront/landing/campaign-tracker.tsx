import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { isDraftPreviewUrl, useStorefront } from '../api'
import { captureTouch } from './attribution'
import { entryPathOf } from './entry-path'
import { sendVisit, visitFor } from './visits'

/**
 * Mounted once in the store layout: on every page view it records a campaign touch (UTM
 * parameters or a short link in the URL) and counts the visit of a campaign or landing page,
 * once per session. Staff draft previews are not counted. Renders nothing.
 */
export function CampaignTracker() {
  const { pathname, search } = useLocation()
  const bootstrap = useStorefront()
  const entryPath = entryPathOf(bootstrap)

  useEffect(() => {
    const touch = captureTouch({ pathname, search, host: window.location.host }, typeof document === 'undefined' ? '' : document.referrer)
    if (bootstrap.preview || isDraftPreviewUrl(search)) return
    // The host's `/` shows its entry page: the visit is that page's.
    const path = pathname === '/' && entryPath ? entryPath : pathname
    const ping = visitFor(path, touch)
    if (ping) sendVisit(ping)
  }, [pathname, search, entryPath, bootstrap.preview])

  return null
}
