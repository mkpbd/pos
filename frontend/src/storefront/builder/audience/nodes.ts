import { NODE_ID } from '../registry'
import type { RenderColumn, RenderPageSection } from '../types'
import { evaluateAudience, readAudience } from './evaluate'
import type { AudienceCampaigns, AudienceContext, AudienceRuleKind } from './types'

/*
 * B13: the sections and elements of a document that carry audience rules (columns never do).
 */

type AudienceNode = { id: string; audience: unknown }

/** Every node with well-formed audience rules, sections first, then their elements (inner rows included). */
export function audienceNodes(sections: readonly RenderPageSection[]): AudienceNode[] {
  const out: AudienceNode[] = []
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const { id, audience } = node as { id?: unknown; audience?: unknown }
    if (typeof id === 'string' && NODE_ID.test(id) && readAudience(audience)) out.push({ id, audience })
  }
  const columns = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const column of list as RenderColumn[]) {
      for (const element of Array.isArray(column?.elements) ? column.elements : []) {
        visit(element)
        if (typeof element === 'object' && element !== null && 'columns' in element) columns((element as { columns?: unknown }).columns)
      }
    }
  }
  for (const section of Array.isArray(sections) ? sections : []) {
    visit(section)
    if (typeof section === 'object' && section !== null && 'columns' in section) columns(section.columns)
  }
  return out
}

/** Every rule kind a document uses (empty = no audiences). */
export function audienceKinds(sections: readonly RenderPageSection[]): Set<AudienceRuleKind> {
  const kinds = new Set<AudienceRuleKind>()
  for (const node of audienceNodes(sections)) for (const rule of readAudience(node.audience)!.rules) kinds.add(rule.kind)
  return kinds
}

/**
 * For the editor's "Preview as": the ids of the nodes with rules (`ruled`) and of those the context
 * would hide (`hidden`). A null context hides nothing.
 */
export function audienceVerdicts(
  sections: readonly RenderPageSection[],
  context: AudienceContext | null,
  campaigns: AudienceCampaigns | null = null,
): { ruled: string[]; hidden: string[] } {
  const nodes = audienceNodes(sections)
  return {
    ruled: nodes.map((node) => node.id),
    hidden: context ? nodes.filter((node) => !evaluateAudience(node.audience, context, { campaigns })).map((node) => node.id) : [],
  }
}
