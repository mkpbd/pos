import { useCallback, useMemo, useState } from 'react'
import { useDocumentInsightsQuery, type InsightsRange } from './insights-api'
import { heatMax, presetPeriod } from './insights-model'
import type { HeatLayer } from './heat-overlay'

/*
 * B15: the editor's Insights state — the panel, its period and device, the figures and the heat
 * map layer for the canvas (only while the panel is open, so "Clicks as a list" is always at hand).
 */

export function useInsights({ documentId, available, timeZone }: { documentId: string; available: boolean; timeZone: string | undefined }) {
  const [open, setOpenState] = useState(false)
  const [heatOn, setHeatOn] = useState(false)
  const [range, setRange] = useState<InsightsRange>(() => ({ ...presetPeriod('30', timeZone), device: 'all' }))
  const query = useDocumentInsightsQuery(documentId, range, available && open)
  const data = query.data

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    if (!next) setHeatOn(false)
  }, [])

  const heat = useMemo<HeatLayer | null>(() => {
    if (!open || !heatOn || !data) return null
    return {
      heat: data.heat,
      reach: Object.fromEntries(data.sections.filter((s) => s.live).map((s) => [s.node_id, s.reach])),
      max: heatMax(data.heat),
    }
  }, [open, heatOn, data])

  return { available, open, setOpen, heatOn, setHeatOn, range, setRange, query, heat }
}

export type InsightsState = ReturnType<typeof useInsights>
