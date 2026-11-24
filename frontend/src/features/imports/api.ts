import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import { downloadFile } from '@/lib/api/download'

export type ImportTypeKey = 'products' | 'opening_stock' | 'customers' | 'suppliers' | 'price_update'

export type ImportColumn = { key: string; label: string; required: boolean; example: string | null; help: string | null }

/** `GET /imports/types`: only the types the user may run. */
export type ImportTypeInfo = { type: ImportTypeKey; label: string; permission: string; columns: ImportColumn[]; max_rows: number }

export type ImportStatus = 'validating' | 'validated' | 'importing' | 'completed' | 'failed' | 'cancelled'

export type ImportRowError = { row: number; column: string | null; message: string }

export type ImportRecord = {
  id: string
  type: ImportTypeKey
  status: ImportStatus
  file_name: string
  rows_total: number | null
  rows_valid: number | null
  rows_error: number | null
  to_create: number | null
  to_update: number | null
  to_skip: number | null
  created: number | null
  updated: number | null
  skipped: number | null
  failed_rows: number | null
  /** First 200 stored errors (detail only). */
  errors?: ImportRowError[]
  errors_truncated?: boolean
  options: { update_existing?: boolean } | null
  created_by: { id: string; name: string } | null
  created_at: string
  validated_at: string | null
  started_at: string | null
  finished_at: string | null
  message: string | null
}

/** Mirrors the API's permission per type (UI hiding only; the API checks again). */
export const IMPORT_TYPES: Record<ImportTypeKey, { label: string; permission: string; done: { to: string; label: string } }> = {
  products: { label: 'Products', permission: 'products.manage', done: { to: '/products', label: 'Go to products' } },
  price_update: { label: 'Price update', permission: 'products.manage', done: { to: '/products', label: 'Go to products' } },
  opening_stock: { label: 'Opening stock', permission: 'inventory.adjust', done: { to: '/inventory', label: 'Go to inventory' } },
  customers: { label: 'Customers', permission: 'customers.manage', done: { to: '/customers', label: 'Go to customers' } },
  suppliers: { label: 'Suppliers', permission: 'suppliers.manage', done: { to: '/suppliers', label: 'Go to suppliers' } },
}

/** Any of these opens the import pages (each type is checked on its own). */
export const IMPORT_PERMISSIONS = [...new Set(Object.values(IMPORT_TYPES).map((t) => t.permission))]

export const IMPORT_STATUS: Record<ImportStatus, { label: string; variant: 'outline' | 'soft' | 'warning' | 'success' | 'destructive' | 'info' }> = {
  validating: { label: 'Checking', variant: 'info' },
  validated: { label: 'Ready to import', variant: 'soft' },
  importing: { label: 'Importing', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
}

/** Accepted by `POST /imports`: .xlsx or UTF-8 .csv up to 10 MB. */
export const IMPORT_ACCEPT = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024

export function fileProblem(file: File): string | null {
  if (!/\.(xlsx|csv)$/i.test(file.name)) return 'Choose an Excel (.xlsx) or CSV (.csv) file.'
  if (file.size > IMPORT_MAX_BYTES) return 'The file is larger than 10 MB. Split it into smaller files.'
  if (file.size === 0) return 'The file is empty.'
  return null
}

export const isBusy = (status: ImportStatus | undefined) => status === 'validating' || status === 'importing'

export const importKeys = {
  all: ['imports'] as const,
  types: ['imports', 'types'] as const,
  list: (params: ImportListParams) => ['imports', 'list', params] as const,
  detail: (id: string) => ['imports', 'detail', id] as const,
}

export type ImportListParams = { page: number; type?: ImportTypeKey; status?: ImportStatus }

export function useImportTypesQuery() {
  return useQuery({
    queryKey: importKeys.types,
    queryFn: ({ signal }) => api.get<ImportTypeInfo[]>('/imports/types', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })
}

export function useImportsQuery(params: ImportListParams) {
  return useQuery({
    queryKey: importKeys.list(params),
    queryFn: ({ signal }) => api.get<ImportRecord[]>('/imports', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
    // Keep running imports moving in the history too.
    refetchInterval: (query) => (query.state.data?.items.some((i) => isBusy(i.status)) ? 5000 : false),
  })
}

/** Polls every 2 s while the file is being checked or imported. */
export function useImportQuery(id: string | undefined) {
  return useQuery({
    queryKey: importKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<ImportRecord>(`/imports/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (query) => (isBusy(query.state.data?.status) ? 2000 : false),
  })
}

export function useUploadImportMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ type, file, updateExisting }: { type: ImportTypeKey; file: File; updateExisting?: boolean }) => {
      const body = new FormData()
      body.append('type', type)
      body.append('file', file)
      if (updateExisting !== undefined) body.append('options[update_existing]', updateExisting ? '1' : '0')
      return api.post<ImportRecord>('/imports', body).then((r) => r.data)
    },
    onSuccess: (record) => {
      queryClient.setQueryData(importKeys.detail(record.id), record)
      void queryClient.invalidateQueries({ queryKey: [...importKeys.all, 'list'] })
    },
  })
}

function useImportAction(action: 'run' | 'cancel') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<ImportRecord>(`/imports/${id}/${action}`).then((r) => r.data),
    onSuccess: (record) => {
      queryClient.setQueryData(importKeys.detail(record.id), record)
      void queryClient.invalidateQueries({ queryKey: [...importKeys.all, 'list'] })
    },
    onError: (_e, id) => queryClient.invalidateQueries({ queryKey: importKeys.detail(id) }),
  })
}

export const useRunImportMutation = () => useImportAction('run')
export const useCancelImportMutation = () => useImportAction('cancel')

export const downloadTemplate = (type: ImportTypeKey, format: 'xlsx' | 'csv') =>
  downloadFile(`/imports/templates/${type}`, { query: { format }, fallbackFilename: `${type}-template.${format}` })

export const downloadErrors = (id: string) => downloadFile(`/imports/${id}/errors.csv`, { fallbackFilename: 'import-errors.csv' })
