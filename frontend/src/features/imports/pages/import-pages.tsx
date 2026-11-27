import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, DownloadIcon, FileSpreadsheetIcon, FileTypeIcon, HistoryIcon, Loader2Icon, PlusIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import {
  downloadErrors,
  downloadTemplate,
  fileProblem,
  IMPORT_ACCEPT,
  IMPORT_STATUS,
  IMPORT_TYPES,
  useCancelImportMutation,
  useImportQuery,
  useImportsQuery,
  useImportTypesQuery,
  useRunImportMutation,
  useUploadImportMutation,
  type ImportRecord,
  type ImportStatus,
  type ImportTypeInfo,
  type ImportTypeKey,
} from '@/features/imports/api'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

const ALL = 'all'

/** What each type does, in the words staff use. */
const TYPE_HINTS: Record<ImportTypeKey, string> = {
  products: 'Create products and their variants, or update them by SKU. Missing categories, brands and attributes are created.',
  price_update: 'Change selling, cost and wholesale prices by SKU or barcode. Blank cells keep the current price.',
  opening_stock: 'Put starting stock into your stores. Each store gets one stock adjustment with the reason "Opening stock". Serial-tracked products need the serials column: one serial number per unit, separated by commas.',
  customers: 'Add customers, or update them when the phone (or e-mail) is already registered.',
  suppliers: 'Add suppliers, or update them when the name and phone match one you have.',
}

/** Types where existing records may be updated (opening stock only adds; price updates only update). */
const HAS_UPDATE_OPTION: ImportTypeKey[] = ['products', 'customers', 'suppliers']

const typeLabel = (type: ImportTypeKey) => IMPORT_TYPES[type]?.label ?? type

const n = (value: number | null | undefined) => (value ?? 0).toLocaleString('en-US')

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

async function download(run: () => Promise<{ filename: string }>) {
  try {
    const file = await run()
    toast.success(`Downloaded ${file.filename}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'The download failed.')
  }
}

function StatusBadge({ status }: { status: ImportStatus }) {
  const s = IMPORT_STATUS[status] ?? { label: status, variant: 'outline' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

// ——— History ———

export function ImportsPage() {
  const [page, setPage] = useState(1)
  const [type, setType] = useState<string>(ALL)
  const [status, setStatus] = useState<string>(ALL)
  const { data, error, isPending, refetch } = useImportsQuery({
    page,
    type: type === ALL ? undefined : (type as ImportTypeKey),
    status: status === ALL ? undefined : (status as ImportStatus),
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Imports"
        description="Spreadsheets you uploaded to add or update products, stock, customers and suppliers."
        actions={<Button asChild><Link to="/imports/new"><PlusIcon data-icon="inline-start" /> New import</Link></Button>}
      />
      <div className="flex flex-wrap gap-3">
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1) }}>
          <SelectTrigger aria-label="Filter by type" className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {(Object.keys(IMPORT_TYPES) as ImportTypeKey[]).map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger aria-label="Filter by status" className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(IMPORT_STATUS) as ImportStatus[]).map((s) => <SelectItem key={s} value={s}>{IMPORT_STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <LoadingState rows={5} label="Loading imports" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No imports yet" description="Upload a spreadsheet to add many records at once." action={<Button asChild variant="outline"><Link to="/imports/new">Start an import</Link></Button>} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Imports">
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Rows</TableHead>
                  <TableHead className="hidden md:table-cell">Result</TableHead>
                  <TableHead className="hidden lg:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="max-w-[14rem]">
                      <Link to={`/imports/${record.id}`} className="block truncate font-medium underline-offset-4 hover:underline">{record.file_name}</Link>
                      <div className="text-xs text-muted-foreground">{typeLabel(record.type)} · {formatWhen(record.created_at)}</div>
                    </TableCell>
                    <TableCell><StatusBadge status={record.status} /></TableCell>
                    <TableCell className="hidden text-right font-mono text-sm sm:table-cell">{record.rows_total === null ? '—' : n(record.rows_total)}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {record.status === 'completed'
                        ? `${n(record.created)} new · ${n(record.updated)} updated${record.failed_rows ? ` · ${n(record.failed_rows)} failed` : ''}`
                        : record.status === 'validated'
                          ? `${n(record.rows_valid)} ready · ${n(record.rows_error)} with errors`
                          : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{record.created_by?.name ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

// ——— New import ———

function ColumnsTable({ info }: { info: ImportTypeInfo }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label={`Columns for ${info.label}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Column</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Example</TableHead>
            <TableHead className="min-w-[12rem]">What to enter</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {info.columns.map((c) => (
            <TableRow key={c.key}>
              <TableCell>
                <div className="font-mono text-xs">{c.key}</div>
                {c.label !== c.key && <div className="text-xs text-muted-foreground">{c.label}</div>}
              </TableCell>
              <TableCell>{c.required ? <Badge variant="soft">Required</Badge> : <span className="text-muted-foreground">Optional</span>}</TableCell>
              <TableCell className="font-mono text-xs">{c.example || '—'}</TableCell>
              <TableCell className="text-sm whitespace-normal">{c.help || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Header problems answered by `POST /imports` (422 IMPORT_BAD_HEADERS). */
function HeaderProblems({ error }: { error: ApiError }) {
  const list = (key: string) => (Array.isArray(error.details[key]) ? (error.details[key] as unknown[]).map(String) : [])
  const missing = list('missing')
  const unknown = list('unknown')
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p className="font-medium">The first row of your file does not have the right column names.</p>
      {missing.length > 0 && <p>Missing: <span className="font-mono">{missing.join(', ')}</span></p>}
      {unknown.length > 0 && <p>Not recognised: <span className="font-mono">{unknown.join(', ')}</span></p>}
      <p className="text-muted-foreground">Download the template and copy your data into it, keeping its first row.</p>
    </div>
  )
}

export function NewImportPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const types = useImportTypesQuery()
  const upload = useUploadImportMutation()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [updateExisting, setUpdateExisting] = useState(true)

  const requested = params.get('type')
  const selected = types.data?.find((t) => t.type === requested) ?? null
  const uploadError = upload.error instanceof ApiError ? upload.error : null

  const choose = (type: ImportTypeKey) => {
    setParams({ type }, { replace: true })
    upload.reset()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!selected) return
    if (!file) {
      setFileError('Choose the file to import.')
      return
    }
    const problem = fileProblem(file)
    if (problem) {
      setFileError(problem)
      return
    }
    upload.mutate(
      { type: selected.type, file, updateExisting: HAS_UPDATE_OPTION.includes(selected.type) ? updateExisting : undefined },
      {
        onSuccess: (record) => navigate(`/imports/${record.id}`),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') setFileError(err.fieldErrors.file?.[0] ?? err.fieldErrors.type?.[0] ?? err.message)
        },
      },
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Import from a spreadsheet"
        description="Add or update many records at once from an Excel or CSV file. Nothing changes until you confirm."
        actions={<Button asChild variant="outline"><Link to="/imports"><HistoryIcon data-icon="inline-start" /> Past imports</Link></Button>}
      />

      <Card>
        <CardHeader>
          <CardTitle>1. What are you importing?</CardTitle>
        </CardHeader>
        <CardContent>
          {types.isPending ? (
            <LoadingState rows={2} label="Loading import types" />
          ) : types.error ? (
            <ErrorState error={types.error} onRetry={() => types.refetch()} />
          ) : types.data.length === 0 ? (
            <EmptyState title="Nothing you can import" description="Your role has no permission to import data." />
          ) : (
            <div role="radiogroup" aria-label="Import type" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {types.data.map((t) => {
                const active = selected?.type === t.type
                return (
                  <label
                    key={t.type}
                    className={cn('flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input type="radio" name="import-type" className="accent-primary" aria-label={t.label} aria-describedby={`import-type-${t.type}`} checked={active} onChange={() => choose(t.type)} />
                      {t.label}
                    </span>
                    <span id={`import-type-${t.type}`} className="text-muted-foreground">{TYPE_HINTS[t.type] ?? ''}</span>
                  </label>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Get the template</CardTitle>
              <CardDescription>
                Fill in one row per record, keeping the first row as it is. Up to {selected.max_rows.toLocaleString('en-US')} rows per file. Column names may also be written as the labels below.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => download(() => downloadTemplate(selected.type, 'xlsx'))}><FileSpreadsheetIcon data-icon="inline-start" /> Excel template</Button>
                <Button variant="outline" onClick={() => download(() => downloadTemplate(selected.type, 'csv'))}><FileTypeIcon data-icon="inline-start" /> CSV template</Button>
              </div>
              <ColumnsTable info={selected} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Upload your file</CardTitle>
              <CardDescription>We check every row first and show you what will change.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-file">File (.xlsx or .csv, max. 10 MB)</Label>
                  <Input
                    id="import-file"
                    type="file"
                    accept={IMPORT_ACCEPT}
                    aria-invalid={fileError ? true : undefined}
                    aria-describedby={fileError ? 'import-file-error' : undefined}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null)
                      setFileError(null)
                      upload.reset()
                    }}
                  />
                  {fileError && <p id="import-file-error" className="text-sm text-destructive">{fileError}</p>}
                </div>
                {HAS_UPDATE_OPTION.includes(selected.type) && (
                  <div className="flex items-start gap-2">
                    <Switch id="update-existing" checked={updateExisting} onCheckedChange={setUpdateExisting} />
                    <div className="flex flex-col">
                      <Label htmlFor="update-existing" className="font-normal">Update records that already exist</Label>
                      <span className="text-xs text-muted-foreground">Off: rows that match an existing record are skipped.</span>
                    </div>
                  </div>
                )}
                {uploadError?.code === 'IMPORT_BAD_HEADERS' && <HeaderProblems error={uploadError} />}
                {upload.error && !(uploadError && ['IMPORT_BAD_HEADERS', 'VALIDATION_FAILED'].includes(uploadError.code)) && (
                  <p role="alert" className="text-sm text-destructive">{upload.error.message}</p>
                )}
                <div>
                  <Button type="submit" disabled={upload.isPending}>
                    {upload.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <UploadIcon data-icon="inline-start" />}
                    Upload and check
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ——— One import ———

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: 'error' }) {
  return (
    <div className="flex flex-col rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-mono text-xl font-semibold', tone === 'error' && value ? 'text-destructive' : undefined)}>{n(value)}</dd>
    </div>
  )
}

function ErrorsTable({ record }: { record: ImportRecord }) {
  const errors = record.errors ?? []
  if (errors.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rows with errors</CardTitle>
        <CardDescription>
          {record.errors_truncated ? `The first ${errors.length} problems.` : 'Fix these in your file and upload it again.'} The CSV has every problem next to the row as you wrote it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button variant="outline" size="sm" onClick={() => download(() => downloadErrors(record.id))}><DownloadIcon data-icon="inline-start" /> Download all errors (CSV)</Button>
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-md border">
          <Table aria-label="Errors">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-right">Row</TableHead>
                <TableHead>Column</TableHead>
                <TableHead className="min-w-[12rem]">Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="text-right font-mono">{e.row}</TableCell>
                  <TableCell className="font-mono text-xs">{e.column ?? '—'}</TableCell>
                  <TableCell className="text-sm whitespace-normal">{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Lists the import changes once it has finished (products, stock, customers, suppliers). */
const AFFECTED_KEYS = ['products', 'inventory', 'customers', 'suppliers', 'variant-picker', 'catalog']

export function ImportPage() {
  const { importId } = useParams()
  const can = useCan()
  const queryClient = useQueryClient()
  const { data, error, isPending, refetch } = useImportQuery(importId)
  const run = useRunImportMutation()
  const cancel = useCancelImportMutation()
  const [confirm, setConfirm] = useState<'run' | 'cancel' | null>(null)
  const status = data?.status

  useEffect(() => {
    if (status === 'completed') void queryClient.invalidateQueries({ predicate: (q) => AFFECTED_KEYS.includes(String(q.queryKey[0])) })
  }, [status, queryClient])

  if (isPending) return <LoadingState rows={5} label="Loading import" />
  if (!data) return <ErrorState error={error} onRetry={() => refetch()} />

  const label = typeLabel(data.type)
  const mayRun = can(IMPORT_TYPES[data.type]?.permission ?? '')
  const planned = (data.to_create ?? 0) + (data.to_update ?? 0) + (data.to_skip ?? 0) || data.rows_valid || 0
  const processed = (data.created ?? 0) + (data.updated ?? 0) + (data.skipped ?? 0) + (data.failed_rows ?? 0)
  const percent = planned > 0 ? Math.min(100, Math.round((processed / planned) * 100)) : 0
  const done = IMPORT_TYPES[data.type]?.done

  const act = (action: 'run' | 'cancel') =>
    (action === 'run' ? run : cancel).mutate(data.id, {
      onSuccess: () => {
        setConfirm(null)
        toast.success(action === 'run' ? 'Import started.' : 'Import cancelled.')
      },
      onError: (e) => {
        setConfirm(null)
        toast.error(e instanceof ApiError && e.code === 'IMPORT_NOT_READY' ? 'This import cannot be started any more. The page shows where it stands now.' : e.message)
      },
    })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to imports"><Link to="/imports"><ArrowLeftIcon /></Link></Button>
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{label} import</h1>
            <p className="truncate text-sm text-muted-foreground">{data.file_name} · {data.created_by?.name ?? '—'} · {formatWhen(data.created_at)}</p>
          </div>
        </div>
        <StatusBadge status={data.status} />
      </div>

      {data.status === 'validating' && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6" role="status">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">Checking your file…</p>
              <p className="text-sm text-muted-foreground">Big files take a little while. You can leave this page; the check carries on.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {data.status === 'validated' && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to import</CardTitle>
            <CardDescription>{n(data.rows_total)} rows checked. Nothing has changed yet.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Check result">
              <Stat label="New" value={data.to_create} />
              <Stat label="Updated" value={data.to_update} />
              <Stat label="Skipped" value={data.to_skip} />
              <Stat label="With errors" value={data.rows_error} tone="error" />
            </dl>
            {!data.rows_valid ? (
              <p role="alert" className="text-sm text-destructive">No row can be imported. Fix the errors below and upload the file again.</p>
            ) : data.rows_error ? (
              <p className="text-sm text-muted-foreground">Rows with errors are left out. You can import the others now, or fix the file and upload it again.</p>
            ) : null}
            {mayRun && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={!data.rows_valid || run.isPending} onClick={() => setConfirm('run')}>
                  <UploadIcon data-icon="inline-start" /> Import {n(data.rows_valid)} {data.rows_valid === 1 ? 'row' : 'rows'}
                </Button>
                <Button variant="outline" asChild><Link to={`/imports/new?type=${data.type}`}>Upload a corrected file</Link></Button>
                <Button variant="ghost" disabled={cancel.isPending} onClick={() => setConfirm('cancel')}>Cancel import</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.status === 'importing' && (
        <Card>
          <CardHeader>
            <CardTitle>Importing…</CardTitle>
            <CardDescription>{n(processed)} of {n(planned)} rows done. You can leave this page; the import carries on.</CardDescription>
          </CardHeader>
          <CardContent>
            <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${processed} of ${planned}`} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {data.status === 'completed' && (
        <Card>
          <CardHeader>
            <CardTitle>Import finished</CardTitle>
            <CardDescription>{formatWhen(data.finished_at)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Import result">
              <Stat label="Created" value={data.created} />
              <Stat label="Updated" value={data.updated} />
              <Stat label="Skipped" value={data.skipped} />
              <Stat label="Failed" value={data.failed_rows} tone="error" />
            </dl>
            {!!data.failed_rows && <p className="text-sm text-muted-foreground">Some rows could not be saved when importing (for example a SKU taken in the meantime). They are listed below.</p>}
            <div className="flex flex-wrap gap-2">
              {done && <Button asChild><Link to={done.to}>{done.label}</Link></Button>}
              <Button asChild variant="outline"><Link to={`/imports/new?type=${data.type}`}>Import another file</Link></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data.status === 'failed' && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p role="alert" className="text-sm"><span className="font-medium text-destructive">The import failed.</span> {data.message ?? 'Please try again.'}</p>
            <div><Button asChild variant="outline"><Link to={`/imports/new?type=${data.type}`}>Try again</Link></Button></div>
          </CardContent>
        </Card>
      )}

      {data.status === 'cancelled' && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="text-sm">This import was cancelled; nothing was changed.</p>
            <div><Button asChild variant="outline"><Link to={`/imports/new?type=${data.type}`}>Start again</Link></Button></div>
          </CardContent>
        </Card>
      )}

      {data.status !== 'validating' && <ErrorsTable record={data} />}

      <ConfirmDialog
        open={confirm === 'run'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Import ${n(data.rows_valid)} ${data.rows_valid === 1 ? 'row' : 'rows'}?`}
        description={
          `${n(data.to_create)} to create, ${n(data.to_update)} to update.` +
          (data.rows_error ? ` The ${n(data.rows_error)} rows with errors are left out.` : '') +
          (data.type === 'opening_stock' ? ' Stock is posted as one adjustment per store.' : '')
        }
        confirmLabel="Import"
        destructive={false}
        pending={run.isPending}
        onConfirm={() => act('run')}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancel this import?"
        description="Nothing from this file is imported. You can upload it again later."
        confirmLabel="Cancel import"
        pending={cancel.isPending}
        onConfirm={() => act('cancel')}
      />
    </div>
  )
}
