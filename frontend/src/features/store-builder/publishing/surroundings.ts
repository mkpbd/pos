import type { CanvasSurroundings } from '@/storefront/builder/canvas/protocol'
import { parseZoneKey } from '../document-kind'

/** The canvas kind of a document; a product zone's version is drawn as its zone (P1b), a header / footer global where they sit (B9). */
export function canvasSurroundings(doc: { kind: string; key: string; context?: string | null }): CanvasSurroundings {
  if (doc.kind === 'global') return doc.context === 'header' || doc.context === 'footer' ? doc.context : 'page'
  if (doc.kind === 'zone') return parseZoneKey(doc.key)?.zone ?? 'page'
  return doc.kind === 'header' || doc.kind === 'footer' || doc.kind === 'popup' ? doc.kind : 'page'
}
