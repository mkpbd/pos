import { useEffect, useRef, type RefObject } from 'react'
import type { ExperimentArms } from '../builder/audience/types'
import type { BuilderPage, Device } from '../builder/types'
import { rememberBuilderClick } from './builder-attribution'
import { createPageCollector } from './collector'
import { isStaffView, trackingRefused } from './privacy'
import { sendBeaconPayload } from './send'
import type { InsightsBeacon } from './types'
import { vitalsFor } from './vitals'

/*
 * B15: counts a page view of a published builder page (front page, landing page, CMS page) for the
 * store's Insights, and remembers the section a shopper clicked toward a product (§2). Off for a
 * draft or the canvas payload, a staff preview, the editor canvas (/admin) and visitors who sent Do
 * Not Track or Global Privacy Control. One page view lasts while the same document version is shown
 * at the same address; the device is the one the page view started on.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The published document a payload counts for, or null when it must not be counted. */
export function insightsTarget(page: BuilderPage): { id: string; version: number } | null {
  const doc = page.document
  if (!doc || doc.source !== 'published' || doc.key === 'canvas') return null
  if (typeof doc.id !== 'string' || !UUID.test(doc.id) || typeof doc.version !== 'number' || !Number.isInteger(doc.version) || doc.version < 1) return null
  return { id: doc.id, version: doc.version }
}

export function usePageInsights(
  rootRef: RefObject<HTMLElement | null>,
  page: BuilderPage,
  device: Device,
  enabled: boolean,
  send: (beacon: InsightsBeacon) => void = sendBeaconPayload,
  /** B13: the running A/B tests' arms this visitor sees (a new set starts a new page view). */
  arms: ExperimentArms | null = null,
) {
  const target = enabled ? insightsTarget(page) : null
  const id = target?.id ?? null
  const version = target?.version ?? null
  const armsKey = arms && Object.keys(arms).length > 0 ? JSON.stringify(arms) : null
  const deviceRef = useRef(device)
  const sendRef = useRef(send)
  // Kept current without starting a new page view (declared first: runs before the effect below).
  useEffect(() => {
    deviceRef.current = device
    sendRef.current = send
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root || id === null || version === null || isStaffView() || trackingRefused()) return
    const path = window.location.pathname.slice(0, 255)
    const startDevice = deviceRef.current
    const pageArms: ExperimentArms | null = armsKey ? (JSON.parse(armsKey) as ExperimentArms) : null
    const collector = createPageCollector({
      root,
      documentId: id,
      version,
      path,
      device: startDevice,
      send: (beacon) => sendRef.current(beacon),
      vitals: vitalsFor(path),
      onTowardProduct: (sectionId) => rememberBuilderClick(id, sectionId, startDevice, Date.now(), pageArms),
      arms: pageArms,
    })
    // Sections drawn later (device order, language) are picked up.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => collector.scan())
    mutations?.observe(root, { childList: true })
    const onVisibility = () => collector.setHidden(document.visibilityState === 'hidden')
    const onPageHide = () => collector.flush(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      mutations?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      collector.destroy()
    }
  }, [rootRef, id, version, armsKey])
}
