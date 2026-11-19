import { useMemo } from 'react'
import { evaluateAudience } from '@/storefront/builder/audience/evaluate'
import type { Audience, AudienceCampaigns, PreviewContext } from '@/storefront/builder/audience/types'
import type { BuilderContent } from '@/storefront/builder/types'
import { useAudienceData } from './lookups'
import { audienceBadgeText, type AudienceLookups } from './words'

/** B13: a "Who sees this" badge on the canvas (`out`: the "Preview as" shopper wouldn't see the node). */
export type CanvasAudienceBadge = { id: string; text: string; out: boolean }

type AnyNode = { id: string; audience?: Audience | null; columns?: { elements: AnyNode[] }[] }

/** Every node with rules, outermost first. */
export function ruledNodes(sections: readonly unknown[]): { id: string; audience: Audience }[] {
  const out: { id: string; audience: Audience }[] = []
  const walk = (node: AnyNode) => {
    if (node.audience && node.audience.rules.length > 0) out.push({ id: node.id, audience: node.audience })
    for (const column of node.columns ?? []) column.elements.forEach(walk)
  }
  ;(sections as AnyNode[]).forEach(walk)
  return out
}

/** Whether any rule names a district or a campaign (their names need loading). */
export function needsNames(nodes: readonly { audience: Audience }[]): boolean {
  return nodes.some((n) => n.audience.rules.some((r) => r.kind === 'district' || r.kind === 'campaign'))
}

/** The audience badges of the content, with names loaded only when a rule needs them. */
export function useAudienceBadges(content: Pick<BuilderContent, 'sections'>, context: PreviewContext | null): { badges: CanvasAudienceBadge[]; lookups: AudienceLookups; campaigns: AudienceCampaigns } {
  const nodes = useMemo(() => ruledNodes(content.sections), [content.sections])
  const data = useAudienceData({ enabled: needsNames(nodes) })
  const badges = useMemo(
    () =>
      nodes.map(({ id, audience }) => ({
        id,
        text: audienceBadgeText(audience, data) ?? '',
        out: context ? !evaluateAudience(audience, context, { campaigns: data.campaignUtm }) : false,
      })),
    [nodes, data, context],
  )
  return { badges, lookups: data, campaigns: data.campaignUtm }
}

