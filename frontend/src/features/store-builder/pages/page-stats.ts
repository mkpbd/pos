import { createContext } from 'react'
import type { PageInsightsSummary } from '../insights/insights-api'

/* B15: the pages list's views and orders (last 30 days) and its sort order. */

/** Views and orders per document id (last 30 days); null while unknown or not allowed (no columns then). */
export const PageStatsContext = createContext<Record<string, PageInsightsSummary> | null>(null)

export type PageSort = 'name' | 'views' | 'orders'

/** Rows sorted by name, or by views / orders in the last 30 days (most first, then by name). */
export function sortRows<T>(rows: T[], sort: PageSort, name: (row: T) => string, id: (row: T) => string | undefined, stats: Record<string, PageInsightsSummary> | null): T[] {
  const figure = (row: T) => {
    const key = id(row)
    const entry = key && stats ? stats[key] : undefined
    return sort === 'views' ? (entry?.views ?? -1) : (entry?.orders ?? -1)
  }
  return [...rows].sort((a, b) => (sort === 'name' || !stats ? 0 : figure(b) - figure(a)) || name(a).localeCompare(name(b)))
}
