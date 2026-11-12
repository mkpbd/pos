import { cloneSample } from '@/storefront/builder/test-payload'
import type { Section } from '@/storefront/builder/types'
import { nodeName, nodeSummary } from './commands'
import { flattenLayers } from './layers'
import { findNode } from './tree'

describe('layer and canvas names', () => {
  it('names sections after their first element and its content', () => {
    const content = cloneSample()
    const names = flattenLayers(content).filter((row) => row.kind === 'section').map((row) => nodeName(row.node))
    expect(names[0]).toBe('Section · Hero slider')
    expect(names[1]).toBe('Section · Heading: Made fresh every morning')
    expect(names).toContain('Section · Product grid: Best sellers')
  })

  it('names elements by type and text; empty sections and columns plainly', () => {
    const content = cloneSample()
    expect(nodeName(findNode(content, 'e_text')!.node)).toBe('Text: Small batches, local farms and no shortcuts.')
    expect(nodeName(findNode(content, 'c_story_text')!.node)).toBe('Column')
    const empty = { ...(content.sections[0] as Section), columns: [] }
    expect(nodeName(empty)).toBe('Section · empty')
    const long = { ...(findNode(content, 'e_heading')!.node as object), props: { text: 'x'.repeat(80), level: 2, link: null } }
    expect(nodeSummary(long as never)!.length).toBeLessThanOrEqual(48)
  })
})
