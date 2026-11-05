import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { exportErrorMessage } from '@/features/exports/errors'
import { EXPORTABLE_LISTS, exportEndpoint, fallbackExportFilename, type ExportFormat, type ExportListKey } from '@/features/exports/lists'
import { downloadFile, type DownloadQuery } from '@/lib/api/download'

/** Paging belongs to the screen; an export always covers every matching row. */
const PAGING_KEYS = new Set(['page', 'per_page'])

export type ExportMenuProps = {
  /** Which list (key of EXPORTABLE_LISTS) — decides the endpoint. */
  list: ExportListKey
  /** The list's current query (filters, search, sort), exactly as the list request sends it. */
  query?: DownloadQuery
  /** Values for `:param` segments of the endpoint (e.g. a customer id for a statement). */
  pathParams?: Record<string, string>
  /** True while the list is loading or has no rows. */
  disabled?: boolean
  size?: 'default' | 'sm'
}

/** "Export" button with Excel / PDF downloads of the list as currently filtered. */
export function ExportMenu({ list, query, pathParams, disabled = false, size = 'default' }: ExportMenuProps) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const controller = useRef<AbortController | null>(null)
  const { label } = EXPORTABLE_LISTS[list]

  useEffect(() => () => controller.current?.abort(), [])

  async function run(format: ExportFormat) {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setBusy(format)

    const params: DownloadQuery = {}
    for (const [key, value] of Object.entries(query ?? {})) if (!PAGING_KEYS.has(key)) params[key] = value
    params.export = format

    try {
      const file = await downloadFile(exportEndpoint(list, pathParams), { query: params, signal: abort.signal, fallbackFilename: fallbackExportFilename(list, format) })
      toast.success(`Downloaded ${file.filename}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(exportErrorMessage(error, format))
    } finally {
      if (controller.current === abort) {
        controller.current = null
        setBusy(null)
      }
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} data-export-list={list} disabled={disabled || busy !== null} aria-busy={busy !== null} title={disabled && busy === null ? 'Nothing to export' : undefined}>
          {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden /> : <DownloadIcon data-icon="inline-start" aria-hidden />}
          {busy ? 'Exporting…' : 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label} — all matching rows</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run('xlsx')}>
          <FileSpreadsheetIcon aria-hidden /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('pdf')}>
          <FileTextIcon aria-hidden /> PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
