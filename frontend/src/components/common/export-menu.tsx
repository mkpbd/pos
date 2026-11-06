import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon, FileTypeIcon, Loader2Icon, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { exportErrorMessage } from '@/features/exports/errors'
import { DEFAULT_EXPORT_FORMATS, EXPORTABLE_LISTS, exportEndpoint, fallbackExportFilename, type ExportFormat, type ExportListKey } from '@/features/exports/lists'
import { downloadFile, type DownloadQuery } from '@/lib/api/download'

/** Paging belongs to the screen; an export always covers every matching row. */
const PAGING_KEYS = new Set(['page', 'per_page'])

const FORMAT_ITEMS: Record<ExportFormat, { label: string; icon: LucideIcon }> = {
  xlsx: { label: 'Excel (.xlsx)', icon: FileSpreadsheetIcon },
  csv: { label: 'CSV (.csv)', icon: FileTypeIcon },
  pdf: { label: 'PDF', icon: FileTextIcon },
}

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
  /** Formats offered, in menu order (default Excel, CSV and PDF). */
  formats?: readonly ExportFormat[]
  /** Overrides the list's name in the menu heading and fallback filename (e.g. a report's title). */
  title?: string
}

/** "Export" button with Excel / CSV / PDF downloads of the list as currently filtered. */
export function ExportMenu({ list, query, pathParams, disabled = false, size = 'default', formats = DEFAULT_EXPORT_FORMATS, title }: ExportMenuProps) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const controller = useRef<AbortController | null>(null)
  const label = title ?? EXPORTABLE_LISTS[list].label

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
      const file = await downloadFile(exportEndpoint(list, pathParams), { query: params, signal: abort.signal, fallbackFilename: fallbackExportFilename(list, format, title) })
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
        {formats.map((format) => {
          const { label: name, icon: Icon } = FORMAT_ITEMS[format]
          return (
            <DropdownMenuItem key={format} onSelect={() => void run(format)}>
              <Icon aria-hidden /> {name}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
