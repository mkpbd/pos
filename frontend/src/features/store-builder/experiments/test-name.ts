import type { BuilderContent } from '@/storefront/builder/types'
import { nodeSummary } from '../commands'
import { nextTestName } from './experiments-model'

/** "Banner test", "Heading test 2", "Test 1": after what the section starts with. */
export function testNameFor(content: BuilderContent, sectionId: string): string {
  const section = content.sections.find((s) => s.id === sectionId)
  const summary = section ? nodeSummary(section) : null
  const base = summary?.split(':')[0]?.trim()
  return nextTestName(content, base ? `${base} test` : 'Test')
}
