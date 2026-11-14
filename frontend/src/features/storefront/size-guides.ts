import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { onlineCatalogKeys } from '@/features/online-catalog/api'
import { api, ApiError } from '@/lib/api/client'

/** Size guides (P1a §4): a measurement table per category, overridable per product. */

export const SIZE_GUIDE_LIMITS = { name: 100, title: 120, text: 1000, columns: 12, rows: 40, label: 60, cell: 120 } as const

export type SizeGuideColumn = { id: string; label: string }
export type SizeGuideRow = { id: string; cells: Record<string, string> }

export type SizeGuideSummary = { id: string; name: string; title: string; category_ids: string[]; products_count: number; updated_at: string }

export type SizeGuideBn = {
  title?: string | null
  intro?: string | null
  note?: string | null
  columns?: Record<string, string | null> | null
  cells?: Record<string, Record<string, string | null> | null> | null
}

export type SizeGuide = {
  id: string
  name: string
  title: string
  intro: string | null
  columns: SizeGuideColumn[]
  rows: SizeGuideRow[]
  note: string | null
  image_media_id: string | null
  image: { id: string; url: string; alt?: string | null } | null
  category_ids: string[]
  translations?: { bn?: SizeGuideBn | null } | null
  updated_at: string
}

export type SizeGuideInput = {
  name: string
  title: string
  intro: string | null
  columns: SizeGuideColumn[]
  rows: SizeGuideRow[]
  note: string | null
  image_media_id: string | null
  category_ids: string[]
  translations: { bn: { title: string; intro: string; note: string; columns: Record<string, string>; cells: Record<string, Record<string, string>> } }
}

export const sizeGuideKeys = {
  all: [...onlineCatalogKeys.all, 'size-guides'] as const,
  detail: (id: string) => [...onlineCatalogKeys.all, 'size-guides', id] as const,
}

export function useSizeGuidesQuery(enabled = true) {
  return useQuery({
    queryKey: sizeGuideKeys.all,
    queryFn: ({ signal }) => api.get<SizeGuideSummary[]>('/online-catalog/size-guides', { signal }).then((r) => r.data),
    enabled,
  })
}

export function useSizeGuideQuery(id: string | null) {
  return useQuery({
    queryKey: sizeGuideKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<SizeGuide>(`/online-catalog/size-guides/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export function useSaveSizeGuideMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SizeGuideInput }) =>
      (id ? api.put<SizeGuide>(`/online-catalog/size-guides/${id}`, input) : api.post<SizeGuide>('/online-catalog/size-guides', input)).then((r) => r.data),
    onSuccess: (saved) => {
      queryClient.setQueryData(sizeGuideKeys.detail(saved.id), saved)
      return queryClient.invalidateQueries({ queryKey: sizeGuideKeys.all, exact: true })
    },
  })
}

export function useDeleteSizeGuideMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/online-catalog/size-guides/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: sizeGuideKeys.detail(id) })
      // Product listings using it fall back to their category's guide.
      return queryClient.invalidateQueries({ queryKey: onlineCatalogKeys.all })
    },
  })
}

/** The editor's working copy: every text a string, Bangla keyed by column / row ids. */
export type GuideDraft = {
  name: string
  title: string
  intro: string
  note: string
  image_media_id: string | null
  category_ids: string[]
  columns: SizeGuideColumn[]
  rows: SizeGuideRow[]
  bn: { title: string; intro: string; note: string; columns: Record<string, string>; cells: Record<string, Record<string, string>> }
}

let counter = 0
/** A short id matching [A-Za-z0-9_-]{1,36}. */
export function newId(prefix: 'c' | 'r'): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`.slice(0, 36)
}

export type GuideTemplate = { key: string; label: string; columns: string[]; firstColumn: string[] }

/** Starting tables for new guides; the measurements are left for the shop to fill in. */
export const GUIDE_TEMPLATES: GuideTemplate[] = [
  { key: 'clothing', label: 'Clothing (S – XXL)', columns: ['Size', 'Chest (inch)', 'Length (inch)', 'Shoulder (inch)'], firstColumn: ['S', 'M', 'L', 'XL', 'XXL'] },
  { key: 'kids', label: 'Kids by age', columns: ['Size', 'Age', 'Height (cm)', 'Chest (cm)'], firstColumn: ['2', '4', '6', '8', '10'] },
  { key: 'shoes', label: 'Shoes', columns: ['EU', 'UK', 'US', 'Foot length (cm)'], firstColumn: ['38', '39', '40', '41', '42'] },
  { key: 'blank', label: 'Blank table', columns: ['Size', 'Measurement'], firstColumn: [''] },
]

export function draftFromTemplate(template: GuideTemplate): GuideDraft {
  const columns = template.columns.map((label) => ({ id: newId('c'), label }))
  const first = columns[0]!.id
  return {
    name: '', title: 'Size guide', intro: '', note: '', image_media_id: null, category_ids: [],
    columns,
    rows: template.firstColumn.map((value) => ({ id: newId('r'), cells: { [first]: value } })),
    bn: { title: '', intro: '', note: '', columns: {}, cells: {} },
  }
}

const str = (v: string | null | undefined) => (typeof v === 'string' ? v : '')

export function toDraft(guide: SizeGuide): GuideDraft {
  const bn = guide.translations?.bn ?? {}
  return {
    name: guide.name,
    title: guide.title,
    intro: str(guide.intro),
    note: str(guide.note),
    image_media_id: guide.image_media_id,
    category_ids: [...guide.category_ids],
    columns: guide.columns.map((c) => ({ ...c })),
    rows: guide.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
    bn: {
      title: str(bn.title),
      intro: str(bn.intro),
      note: str(bn.note),
      columns: Object.fromEntries(Object.entries(bn.columns ?? {}).map(([k, v]) => [k, str(v)])),
      cells: Object.fromEntries(Object.entries(bn.cells ?? {}).map(([r, cells]) => [r, Object.fromEntries(Object.entries(cells ?? {}).map(([c, v]) => [c, str(v)]))])),
    },
  }
}

/** Client checks mirroring the server limits; keys like the API ("columns.0.label"). */
export function validateDraft(draft: GuideDraft): Record<string, string> {
  const L = SIZE_GUIDE_LIMITS
  const errors: Record<string, string> = {}
  const max = (key: string, value: string, limit: number) => {
    if (value.trim().length > limit) errors[key] = `At most ${limit} characters.`
  }
  if (!draft.name.trim()) errors.name = 'Give the guide a name, e.g. “T-shirts”.'
  max('name', draft.name, L.name)
  if (!draft.title.trim()) errors.title = 'Enter the title shoppers see.'
  max('title', draft.title, L.title)
  max('intro', draft.intro, L.text)
  max('note', draft.note, L.text)
  if (draft.columns.length === 0) errors.columns = 'Add at least one column.'
  if (draft.columns.length > L.columns) errors.columns = `At most ${L.columns} columns.`
  if (draft.rows.length === 0) errors.rows = 'Add at least one row.'
  if (draft.rows.length > L.rows) errors.rows = `At most ${L.rows} rows.`
  draft.columns.forEach((c, i) => {
    if (!c.label.trim()) errors[`columns.${i}.label`] = 'Name the column.'
    max(`columns.${i}.label`, c.label, L.label)
    max(`translations.bn.columns.${c.id}`, draft.bn.columns[c.id] ?? '', L.label)
  })
  draft.rows.forEach((r, i) => {
    draft.columns.forEach((c) => {
      max(`rows.${i}.cells.${c.id}`, r.cells[c.id] ?? '', L.cell)
      max(`translations.bn.cells.${r.id}.${c.id}`, draft.bn.cells[r.id]?.[c.id] ?? '', L.cell)
    })
  })
  max('translations.bn.title', draft.bn.title, L.title)
  max('translations.bn.intro', draft.bn.intro, L.text)
  max('translations.bn.note', draft.bn.note, L.text)
  return errors
}

/** The POST/PUT body: trimmed texts, cells only for existing columns, Bangla always sent ("" clears). */
export function toSizeGuideInput(draft: GuideDraft): SizeGuideInput {
  const columnIds = draft.columns.map((c) => c.id)
  const cellsOf = (cells: Record<string, string> | undefined) =>
    Object.fromEntries(columnIds.map((id) => [id, (cells?.[id] ?? '').trim()]).filter(([, v]) => v !== ''))
  return {
    name: draft.name.trim(),
    title: draft.title.trim(),
    intro: draft.intro.trim() || null,
    columns: draft.columns.map((c) => ({ id: c.id, label: c.label.trim() })),
    rows: draft.rows.map((r) => ({ id: r.id, cells: cellsOf(r.cells) })),
    note: draft.note.trim() || null,
    image_media_id: draft.image_media_id,
    category_ids: draft.category_ids,
    translations: {
      bn: {
        title: draft.bn.title.trim(),
        intro: draft.bn.intro.trim(),
        note: draft.bn.note.trim(),
        columns: Object.fromEntries(columnIds.map((id) => [id, (draft.bn.columns[id] ?? '').trim()]).filter(([, v]) => v !== '')),
        cells: Object.fromEntries(draft.rows.map((r) => [r.id, cellsOf(draft.bn.cells[r.id])]).filter(([, cells]) => Object.keys(cells as object).length > 0)),
      },
    },
  }
}

/** Fills cells from a block pasted from a spreadsheet, adding rows (and columns) within the limits. */
export function pasteIntoDraft(draft: GuideDraft, startRow: number, startCol: number, block: string[][]): GuideDraft {
  const columns = [...draft.columns]
  const rows = draft.rows.map((r) => ({ ...r, cells: { ...r.cells } }))
  const width = Math.max(0, ...block.map((line) => line.length))
  while (columns.length < Math.min(SIZE_GUIDE_LIMITS.columns, startCol + width)) columns.push({ id: newId('c'), label: '' })
  while (rows.length < Math.min(SIZE_GUIDE_LIMITS.rows, startRow + block.length)) rows.push({ id: newId('r'), cells: {} })
  block.forEach((line, dr) => {
    const row = rows[startRow + dr]
    if (!row) return
    line.forEach((value, dc) => {
      const column = columns[startCol + dc]
      if (column) row.cells[column.id] = value
    })
  })
  return { ...draft, columns, rows }
}

export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target] as T, next[index] as T]
  return next
}

/** Validation details of a failed save, keyed like the API; anything else under `form`. */
export function sizeGuideErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
    const entries = Object.entries(error.fieldErrors).map(([k, m]) => [k, m[0] ?? error.message] as const)
    if (entries.length) return Object.fromEntries(entries)
  }
  return { form: error instanceof Error ? error.message : 'Something went wrong.' }
}
