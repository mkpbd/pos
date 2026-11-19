import type { Device } from '../builder/types'

/*
 * B15 "know what works": the request shapes the storefront sends (contract §1 and §2). The server
 * (Marketing module) validates every field again, ignores node ids that are not in the published
 * version and never stores an IP address or user agent.
 */

/** A section seen (≥ 50 % of it, or half the screen of a tall one, for ≥ 1 s): once per section per page view. */
export type InsightViewEvent = { t: 'view'; node: string }

/**
 * A click inside a section: where in the section (0–1 from its top left corner, for the heat map)
 * and the element clicked, when it was one.
 */
export type InsightClickEvent = { t: 'click'; node: string; el?: string; x: number; y: number }

export type InsightEvent = InsightViewEvent | InsightClickEvent

/** The share of the builder page the visitor scrolled to (the highest step reached). */
export type ScrollStep = 0 | 25 | 50 | 75 | 100

/** Real-user Web Vitals of the page load (only the ones the browser measured). */
export type WebVitals = { lcp_ms?: number; cls?: number; inp_ms?: number }

/**
 * POST /store/insights/events — one batch of one page view (sendBeacon, else fetch keepalive; JSON,
 * no session, cookie or CSRF token needed). `seq` is 0 on the first batch of a page view (the server
 * counts the view and the unique visitor only then), 1, 2, … after. `scroll` and `vitals` come once
 * per page view, with the batch sent when the page is first hidden or left, so nothing is counted
 * twice. 202 `{recorded, accepted, ignored}`; 429 past 60 a minute (nothing is retried).
 */
export type InsightsBeacon = {
  document_id: string
  version: number
  path: string
  device: Device
  seq: number
  events: InsightEvent[]
  scroll?: ScrollStep
  vitals?: WebVitals
}

/** §2 `attribution.builder`: the builder page (and its section) the shopper last clicked toward a product, and the device. */
export type BuilderAttribution = { document_id: string; node_id?: string; device?: Device }

/** The builder part of an order / cart request's `attribution`. */
export type WithBuilderAttribution = { builder?: BuilderAttribution }

/** Most events in one batch (more are sent in the next one). */
export const MAX_EVENTS_PER_BEACON = 50

/** The collection endpoint (under the API base; no `?lang`). */
export const INSIGHTS_PATH = '/store/insights/events'
