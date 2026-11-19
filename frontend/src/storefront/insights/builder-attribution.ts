import { cleanArms, reportedArmsOf } from '../builder/audience/experiments'
import type { ExperimentArms } from '../builder/audience/types'
import { NODE_ID } from '../builder/registry'
import type { Device } from '../builder/types'
import { trackingRefused } from './privacy'
import type { BuilderAttribution, WithBuilderAttribution } from './types'

/*
 * B15 §2 orders per page and section. When a shopper clicks toward a product on a published builder
 * page (a product link, or a button of an element that sells), that page and section are kept in
 * sessionStorage for 30 minutes and go with add-to-cart, the order form and the checkout as
 * `attribution.builder`. Nothing personal is kept: two ids, the device kind and a time. Blocked storage is ignored.
 * B13: plus the A/B test arms (running experiments) the shopper saw on that page, as `experiments`,
 * so orders and add-to-carts count per arm (never with DNT / GPC: no arms are reported then).
 */

export const BUILDER_ATTRIBUTION_KEY = 'sf.builder-attribution'
export const BUILDER_ATTRIBUTION_MS = 30 * 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Stored = BuilderAttribution & { at: number }

const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile']

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Keeps the page (and section) clicked toward a product; the last one wins. B13: `experiments` = the arms seen on it. */
export function rememberBuilderClick(documentId: string, nodeId: string | null, device: Device | null, now: number = Date.now(), experiments: ExperimentArms | null = null): void {
  if (!UUID.test(documentId)) return
  const value: Stored = { document_id: documentId, at: now }
  if (nodeId && NODE_ID.test(nodeId)) value.node_id = nodeId
  if (device && DEVICES.includes(device)) value.device = device
  const arms = trackingRefused() ? null : cleanArms(experiments)
  if (arms) value.experiments = arms
  try {
    storage()?.setItem(BUILDER_ATTRIBUTION_KEY, JSON.stringify(value))
  } catch {
    // Blocked or full storage: this order is simply not attributed to a page.
  }
}

function forget(store: Storage): void {
  try {
    store.removeItem(BUILDER_ATTRIBUTION_KEY)
  } catch {
    // ignore
  }
}

/** The page and section of the past 30 minutes, or null (checked again: the value may have been edited). */
export function readBuilderAttribution(now: number = Date.now()): BuilderAttribution | null {
  const store = storage()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(BUILDER_ATTRIBUTION_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    value = null
  }
  const stored = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const at = typeof stored?.at === 'number' ? stored.at : NaN
  const documentId = typeof stored?.document_id === 'string' && UUID.test(stored.document_id) ? stored.document_id : null
  if (!documentId || !Number.isFinite(at) || now - at > BUILDER_ATTRIBUTION_MS || at > now + 60_000) {
    forget(store)
    return null
  }
  const out: BuilderAttribution = { document_id: documentId }
  if (typeof stored?.node_id === 'string' && NODE_ID.test(stored.node_id)) out.node_id = stored.node_id
  if (DEVICES.includes(stored?.device as Device)) out.device = stored!.device as Device
  const arms = cleanArms(stored?.experiments)
  if (arms) out.experiments = arms
  return out
}

/**
 * An order's `attribution` with the builder page added: the campaign touch (P2a) when there is one,
 * plus `builder`; just `{builder}` without a touch; null when there is neither.
 */
export function withBuilderAttribution<T extends object>(attribution: T | null, now: number = Date.now()): (Partial<T> & WithBuilderAttribution) | null {
  const builder = readBuilderAttribution(now)
  if (!builder) return attribution
  return { ...(attribution ?? {}), builder } as Partial<T> & WithBuilderAttribution
}

/**
 * The builder part for an order placed on the page itself (the order form): the page shown and the
 * section the form sits in. Null for a visitor who refused tracking (the server then falls back to
 * the order form's document) or when the page id is not a published document's.
 */
export function builderAttributionAt(documentId: string | undefined, form: Element | null, device: Device): BuilderAttribution | null {
  if (!documentId || !UUID.test(documentId) || trackingRefused()) return null
  const section = form?.closest('section.b-section[data-b]')
  const nodeId = section?.getAttribute('data-b')
  // B13: the arms of the page's running A/B tests this shopper sees.
  const arms = reportedArmsOf(documentId)
  return { document_id: documentId, ...(nodeId && NODE_ID.test(nodeId) ? { node_id: nodeId } : {}), device, ...(arms ? { experiments: arms } : {}) }
}
