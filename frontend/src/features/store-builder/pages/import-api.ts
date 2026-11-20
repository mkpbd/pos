import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { builderAdminKeys, type DocumentSummary } from '../api'
import { parseZoneKey } from '../document-kind'

/*
 * B16 §4: importing a page copy (the .json file of "Download a copy") on the Pages list.
 * POST /storefront/builder/import (storefront.manage, multipart, ≤ 30 MB): as a new campaign page
 * (`target=new`, title, key `landing:<slug>`) or over the draft of a document of the same kind
 * (`target=replace`, document_id, revision). Pictures go into the media library, products,
 * categories, brands … are matched by SKU or address in this shop; the answer is a report.
 * Nothing is ever published.
 */

export const IMPORT_MAX_BYTES = 30 * 1024 * 1024
export const EXPORT_FORMAT = 'pos-builder-page'
export const EXPORT_VERSION = 1

/** The document kinds of an exported page (`document.key_kind`). */
export type KeyKind = 'page' | 'landing' | 'cms' | 'header' | 'footer' | 'zone' | 'popup' | 'global' | 'template'

const KEY_KINDS: readonly KeyKind[] = ['page', 'landing', 'cms', 'header', 'footer', 'zone', 'popup', 'global', 'template']

/** What the Pages list shows of a chosen file before importing it (read in the browser). */
export type ExportPreview = {
  title: string
  keyKind: KeyKind
  key: string | null
  context: string | null
  store: string | null
  exportedAt: string | null
  media: number
  products: number
}

export type ImportTarget = { target: 'new'; title: string; key: `landing:${string}` } | { target: 'replace'; document_id: string; revision: number }

export type MappedCounts = Partial<Record<'media' | 'products' | 'categories' | 'brands' | 'banners' | 'menus' | 'blog_categories' | 'promotions', number>>

export type MissingType = 'product' | 'category' | 'brand' | 'menu' | 'blog_category' | 'promotion' | 'media'

export type ImportReport = {
  created_document: DocumentSummary
  mapped: MappedCounts
  missing: { type: MissingType | string; name: string | null }[]
  dropped_elements: { type: string; count: number }[]
}

export type ImportProblem = 'notJson' | 'notCopy' | 'newerVersion' | 'tooLarge' | 'theme'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

async function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

/** Reads a chosen file: what it holds, or why it can't be a page copy (the server checks it again). */
export async function readExportFile(file: File): Promise<{ preview: ExportPreview } | { problem: ImportProblem }> {
  if (file.size > IMPORT_MAX_BYTES) return { problem: 'tooLarge' }
  let data: unknown
  try {
    data = JSON.parse(await readText(file))
  } catch {
    return { problem: 'notJson' }
  }
  if (!isRecord(data) || data.format !== EXPORT_FORMAT || !isRecord(data.document)) return { problem: 'notCopy' }
  if (typeof data.version === 'number' && data.version > EXPORT_VERSION) return { problem: 'newerVersion' }
  const doc = data.document
  if (doc.kind === 'theme') return { problem: 'theme' }
  const keyKind = KEY_KINDS.find((k) => k === doc.key_kind) ?? null
  if (!keyKind) return { problem: 'notCopy' }
  const source = isRecord(data.source) ? data.source : {}
  const references = isRecord(data.references) ? data.references : {}
  return {
    preview: {
      title: typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : '',
      keyKind,
      key: typeof doc.key === 'string' ? doc.key : null,
      context: typeof doc.context === 'string' ? doc.context : null,
      store: typeof source.store === 'string' ? source.store : isRecord(source.store) && typeof source.store.name === 'string' ? source.store.name : null,
      exportedAt: typeof data.exported_at === 'string' ? data.exported_at : null,
      media: Array.isArray(data.media) ? data.media.length : 0,
      products: Array.isArray(references.products) ? references.products.length : 0,
    },
  }
}

/** The kind of a document of this shop, in the words of an exported file. */
export function keyKindOf(doc: Pick<DocumentSummary, 'kind' | 'key'>): KeyKind | null {
  if (doc.kind === 'theme') return null
  if (doc.kind !== 'page') return doc.kind
  if (doc.key === 'home') return 'page'
  if (doc.key.startsWith('landing:')) return 'landing'
  if (doc.key.startsWith('cms:')) return 'cms'
  if (doc.key.startsWith('template:')) return 'template'
  return 'page'
}

/** Documents whose draft the file may replace: the same kind (same store page, zone or global context). */
export function replaceableDocuments(documents: readonly DocumentSummary[], preview: ExportPreview): DocumentSummary[] {
  return documents.filter((doc) => {
    if (keyKindOf(doc) !== preview.keyKind) return false
    if (preview.keyKind === 'template') return preview.key === null || doc.key === preview.key
    if (preview.keyKind === 'zone') return preview.key === null || parseZoneKey(doc.key)?.zone === parseZoneKey(preview.key)?.zone
    if (preview.keyKind === 'global') return (doc.context ?? 'page') === (preview.context ?? 'page')
    return true
  })
}

/** A page copy can become a new campaign page when it is a page (not a store page design, header, popup …). */
export const canImportAsNewPage = (preview: ExportPreview) => preview.keyKind === 'landing' || preview.keyKind === 'page' || preview.keyKind === 'cms'

export function importPage(file: File, target: ImportTarget): Promise<ImportReport> {
  const body = new FormData()
  body.append('file', file)
  for (const [name, value] of Object.entries(target)) body.append(name, String(value))
  return api.post<ImportReport>('/storefront/builder/import', body).then((r) => r.data)
}

export function useImportPageMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, target }: { file: File; target: ImportTarget }) => importPage(file, target),
    onSuccess: (report) => {
      queryClient.removeQueries({ queryKey: builderAdminKeys.document(report.created_document.id) })
      return queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    },
  })
}

/** Defensive reading of the report (empty parts when a field is missing). */
export function normalizeReport(report: ImportReport): ImportReport {
  return {
    created_document: report.created_document,
    mapped: isRecord(report.mapped) ? report.mapped : {},
    missing: Array.isArray(report.missing) ? report.missing : [],
    dropped_elements: Array.isArray(report.dropped_elements) ? report.dropped_elements.filter((d) => d && typeof d.count === 'number' && d.count > 0) : [],
  }
}
