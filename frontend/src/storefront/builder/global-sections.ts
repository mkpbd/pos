import { NODE_ID } from './registry'
import type { RenderGlobalInfo } from './types'
import { isUuid } from './validate'

/*
 * B9 global sections in render payloads (contract §1): a section drawn from a global carries a
 * `global` marker; a draft render sends `{type: 'global_section', state: 'unavailable'}` for a
 * reference that cannot be drawn (published renders drop it).
 */

/** B9: the `global` marker of a section drawn from a global section (checked), or null. */
export function globalInfo(section: unknown): RenderGlobalInfo | null {
  const value = typeof section === 'object' && section !== null ? (section as { global?: unknown }).global : undefined
  if (typeof value !== 'object' || value === null) return null
  const g = value as Record<string, unknown>
  if (!isUuid(g.id)) return null
  return {
    id: g.id,
    title: typeof g.title === 'string' && g.title.trim() !== '' ? g.title.slice(0, 160) : null,
    section_id: typeof g.section_id === 'string' && NODE_ID.test(g.section_id) ? g.section_id : null,
    version: typeof g.version === 'number' && Number.isInteger(g.version) ? g.version : null,
  }
}

/**
 * B9: whether an entry of `sections` is a global section reference that cannot be drawn: the
 * server's `{type: 'global_section', state: 'unavailable'}` (draft renders only), or a section with
 * `global` and `state: 'unavailable'` (the editor's local expansion).
 */
export function isUnavailableGlobalSection(section: unknown): boolean {
  if (typeof section !== 'object' || section === null) return false
  const s = section as { type?: unknown; state?: unknown; global?: unknown }
  if (s.type === 'global_section') return true
  return s.state === 'unavailable' && globalInfo(section) !== null
}
