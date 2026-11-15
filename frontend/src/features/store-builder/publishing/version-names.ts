import type { VersionEntry } from '../publishing-api'

/** "Eid sale" / "Version 3" / "Saved copy". */
export function entryTitle(entry: Pick<VersionEntry, 'kind' | 'number' | 'name'>): string {
  if (entry.name) return entry.name
  return entry.kind === 'version' && entry.number !== null ? `Version ${entry.number}` : 'Saved copy'
}
