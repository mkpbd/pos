import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowRightIcon, DownloadIcon, Loader2Icon, PencilIcon, PlusIcon, SearchCheckIcon, SignpostIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import {
  downloadRedirectsCsv,
  fromPathProblem,
  isFullUrl,
  normalizePath,
  REDIRECT_LIMITS,
  SOURCE_LABEL,
  testRedirectPath,
  toPathProblem,
  TYPE_HINT,
  TYPE_LABEL,
  useDeleteRedirectMutation,
  useRedirectsQuery,
  useSaveRedirectMutation,
  type RedirectSource,
  type RedirectTestResult,
  type RedirectType,
  type StoreRedirect,
} from '@/features/storefront/redirects'
import { formatDateTime } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/*
 * Online store → Redirects (B16 §5): old addresses that send shoppers (and search engines) on to a
 * new one. Automatic ones come from address changes of pages, posts, products, categories and
 * brands; staff add, change and delete their own (and may change or delete automatic ones).
 * Search, a source filter, "Test a path" and a CSV download of the filtered list.
 */

const ALL = 'all'
const PER_PAGE = 25

type Editing = { kind: 'new' } | { kind: 'edit'; redirect: StoreRedirect } | null

const countFormat = new Intl.NumberFormat('en-US')

function RedirectDialog({ editing, onClose }: { editing: Exclude<Editing, null>; onClose: () => void }) {
  const save = useSaveRedirectMutation()
  const current = editing.kind === 'edit' ? editing.redirect : null
  const [from, setFrom] = useState(current?.from_path ?? '')
  const [to, setTo] = useState(current?.to_path ?? '')
  const [type, setType] = useState<RedirectType>(current?.type ?? 301)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const typeName = useId()
  const fromPreview = normalizePath(from)
  const showPreview = from.trim() !== '' && fromPreview !== from.trim() && !fromPathProblem(from)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (save.isPending) return
    const client: Record<string, string> = {}
    const fromProblem = fromPathProblem(from)
    const toProblem = toPathProblem(to, from)
    if (fromProblem) client.from_path = fromProblem
    if (toProblem) client.to_path = toProblem
    setErrors(client)
    if (Object.keys(client).length > 0) return
    save.mutate(
      { id: current?.id, input: { from_path: normalizePath(from), to_path: isFullUrl(to) ? to.trim() : normalizePath(to), type } },
      {
        onSuccess: (saved) => {
          toast.success(current ? 'Redirect saved.' : `${saved.from_path} now goes to ${saved.to_path}.`)
          onClose()
        },
        onError: (error) => setErrors(fieldErrorMap(error)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? 'Edit redirect' : 'Add a redirect'}</DialogTitle>
          <DialogDescription>Shoppers who open the old address land on the new one. Old links in posts, ads and Google keep working.</DialogDescription>
        </DialogHeader>
        <form id="redirect-form" noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          {current?.source === 'auto' && (
            <p className="rounded-md border border-info/40 bg-info/10 p-3 text-sm">This redirect was added automatically when an address of your shop changed. You can still change or delete it.</p>
          )}
          <FormField label="Old address" error={errors.from_path} hint="The address that no longer works, e.g. /p/eid-2025. You can paste a full link too.">
            <Input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              maxLength={REDIRECT_LIMITS.path + 200}
              placeholder="/p/eid-2025"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </FormField>
          {showPreview && (
            <p className="-mt-2 text-xs text-muted-foreground" data-testid="redirect-from-preview">
              Saved as <span className="font-mono text-foreground">{fromPreview}</span>
            </p>
          )}
          <FormField label="New address" error={errors.to_path} hint="A page of your shop, e.g. /p/eid-2026, or a full link to another site starting with https://.">
            <Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={REDIRECT_LIMITS.path} placeholder="/p/eid-2026" autoCapitalize="none" autoComplete="off" spellCheck={false} />
          </FormField>
          {isFullUrl(to) && !toPathProblem(to, from) && (
            <p role="note" data-testid="redirect-external-warning" className="-mt-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              A full web address: if it belongs to another website, shoppers leave your shop. Check that the link is right and that you trust the site.
            </p>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Kind</legend>
            {([301, 302] as const).map((value) => (
              <label key={value} className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
                <input
                  type="radio"
                  name={typeName}
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  aria-labelledby={`${typeName}-${value}`}
                  aria-describedby={`${typeName}-${value}-hint`}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="flex flex-col gap-0.5">
                  <span id={`${typeName}-${value}`} className="font-medium">
                    {TYPE_LABEL[value]}
                  </span>
                  <span id={`${typeName}-${value}-hint`} className="text-muted-foreground">
                    {TYPE_HINT[value]}
                  </span>
                </span>
              </label>
            ))}
            {errors.type && <p className="text-sm text-destructive">{errors.type}</p>}
          </fieldset>
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="redirect-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {current ? 'Save redirect' : 'Add redirect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TestState = { status: 'idle' } | { status: 'busy' } | { status: 'done'; result: RedirectTestResult } | { status: 'error'; message: string }

/** "Test a path": which redirect an address follows, in words. */
function TestPath() {
  const [value, setValue] = useState('')
  const [state, setState] = useState<TestState>({ status: 'idle' })
  const [problem, setProblem] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const inputId = useId()
  const problemId = useId()

  useEffect(() => () => controller.current?.abort(), [])

  const run = async (event: FormEvent) => {
    event.preventDefault()
    const path = normalizePath(value)
    if (path === '' || /\s/.test(value.trim())) {
      setProblem(path === '' ? 'Enter an address to test, e.g. /p/eid-2025.' : 'An address cannot contain spaces.')
      return
    }
    setProblem(null)
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setState({ status: 'busy' })
    try {
      const result = await testRedirectPath(path, abort.signal)
      if (!abort.signal.aborted) setState({ status: 'done', result })
    } catch (error) {
      if (abort.signal.aborted) return
      setState({ status: 'error', message: error instanceof ApiError ? error.message : 'The test could not be run. Try again.' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SearchCheckIcon className="size-4" aria-hidden /> Test an address
        </CardTitle>
        <CardDescription>See where an old link from a post or an ad takes shoppers now.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={(e) => void run(e)} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={inputId}>Address to test</Label>
            <Input
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="/p/eid-2025"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!problem || undefined}
              aria-describedby={problem ? problemId : undefined}
            />
          </div>
          <Button type="submit" variant="outline" disabled={state.status === 'busy'}>
            {state.status === 'busy' && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Test
          </Button>
        </form>
        {problem && (
          <p id={problemId} className="text-sm text-destructive">
            {problem}
          </p>
        )}
        <div role="status" aria-live="polite" data-testid="redirect-test-result" className="text-sm">
          {state.status === 'done' &&
            (state.result.redirect ? (
              <div className="flex flex-col gap-1 rounded-md border p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono break-all">{state.result.path}</span>
                  <ArrowRightIcon className="size-4 shrink-0" aria-label="goes to" />
                  <span className="font-mono break-all">{state.result.redirect.to_path}</span>
                </p>
                {state.result.live && <p className="text-muted-foreground">This address is a live page again, so shoppers see the page and the redirect is not used.</p>}
                <p className="text-muted-foreground">
                  {TYPE_LABEL[state.result.redirect.type]} · {SOURCE_LABEL[state.result.redirect.source]}
                  {state.result.final_path && state.result.final_path !== state.result.redirect.to_path ? ` · ends at ${state.result.final_path}` : ''}
                </p>
              </div>
            ) : (
              <p className="rounded-md border p-3">
                No redirect: <span className="font-mono break-all">{state.result.path}</span>{' '}
                {state.result.live === true
                  ? 'is a live page of your shop and opens as it is.'
                  : state.result.live === false
                    ? 'shows “Page not found”. Add a redirect to send shoppers somewhere useful.'
                    : 'opens as it is — or shows “Page not found” if nothing lives there.'}
              </p>
            ))}
          {state.status === 'error' && <p className="text-destructive">{state.message}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/** Online store → Redirects (B16 §5). */
export function RedirectsPage() {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<RedirectSource | typeof ALL>(ALL)
  const term = useDebouncedValue(search.trim())
  const filters = { ...(term ? { search: term } : {}), ...(source !== ALL ? { source } : {}) }
  const redirects = useRedirectsQuery({ page, per_page: PER_PAGE, ...filters })
  const remove = useDeleteRedirectMutation()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<StoreRedirect | null>(null)
  const [downloading, setDownloading] = useState(false)
  const rows = redirects.data?.items ?? []
  const filtered = term !== '' || source !== ALL

  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    if (p === 1) next.delete('page')
    else next.set('page', String(p))
    setSearchParams(next, { replace: true })
  }

  const download = async () => {
    setDownloading(true)
    try {
      const file = await downloadRedirectsCsv(filters)
      toast.success(`Downloaded ${file.filename}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The file could not be downloaded.')
    } finally {
      setDownloading(false)
    }
  }

  const addButton = (
    <Button onClick={() => setEditing({ kind: 'new' })}>
      <PlusIcon data-icon="inline-start" /> Add redirect
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <CardTitle>Redirects</CardTitle>
            <CardDescription>
              When an address of your shop changes, the old address sends shoppers — and Google — on to the new one, so links in old posts and ads keep
              working. When you change the address of a page, blog post, product, category or brand, the redirect is added for you.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void download()} disabled={downloading || redirects.isPending || rows.length === 0} aria-busy={downloading}>
              {downloading ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <DownloadIcon data-icon="inline-start" />}
              {downloading ? 'Downloading…' : 'Download CSV'}
            </Button>
            {addButton}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="search"
              aria-label="Search redirects"
              placeholder="Search old or new address"
              className="w-full sm:max-w-xs"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                if (page !== 1) setPage(1)
              }}
            />
            <Select
              value={source}
              onValueChange={(value) => {
                setSource(value as RedirectSource | typeof ALL)
                if (page !== 1) setPage(1)
              }}
            >
              <SelectTrigger aria-label="Show" className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All redirects</SelectItem>
                <SelectItem value="auto">Automatic only</SelectItem>
                <SelectItem value="manual">Added by you only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {redirects.isPending ? (
            <LoadingState rows={4} label="Loading redirects" />
          ) : redirects.error ? (
            <ErrorState error={redirects.error} onRetry={() => void redirects.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? 'No redirects match' : 'No redirects yet'}
              description={filtered ? 'Try other words or show all redirects.' : 'They appear here when an address of your shop changes. You can add your own too, e.g. for an old campaign page.'}
              action={filtered ? undefined : addButton}
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table aria-label="Redirects">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Old address</TableHead>
                      <TableHead>New address</TableHead>
                      <TableHead className="hidden lg:table-cell">Kind</TableHead>
                      <TableHead className="hidden md:table-cell">Added</TableHead>
                      <TableHead className="text-right">Used</TableHead>
                      <TableHead className="w-0">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} data-testid={`redirect-${r.id}`}>
                        <TableCell className="max-w-64">
                          <span className="font-mono text-sm break-all">{r.from_path}</span>
                          <span className="mt-1 block text-xs text-muted-foreground md:hidden">{SOURCE_LABEL[r.source]}</span>
                        </TableCell>
                        <TableCell className="max-w-64 font-mono text-sm break-all">{r.to_path}</TableCell>
                        <TableCell className="hidden text-sm whitespace-nowrap lg:table-cell">{TYPE_LABEL[r.type]}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant={r.source === 'auto' ? 'info' : 'outline'}>{SOURCE_LABEL[r.source]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono tabular-nums">{countFormat.format(r.hits)}</span>
                          <span className="sr-only"> {r.hits === 1 ? 'time' : 'times'}</span>
                          <div className="text-xs whitespace-nowrap text-muted-foreground">{r.last_hit_at ? `Last ${formatDateTime(r.last_hit_at, timeZone)}` : 'Not used yet'}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon-sm" aria-label={`Edit redirect ${r.from_path}`} onClick={() => setEditing({ kind: 'edit', redirect: r })}>
                              <PencilIcon />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Delete redirect ${r.from_path}`} onClick={() => setDeleting(r)}>
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PaginationBar pagination={redirects.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <TestPath />

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <SignpostIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Chains are shortened for you: if A goes to B and B later goes to C, A goes straight to C. A redirect stops on its own when its old address becomes a
        live page again.
      </p>

      {editing && <RedirectDialog key={editing.kind === 'edit' ? editing.redirect.id : 'new'} editing={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the redirect from ${deleting?.from_path ?? ''}?`}
        description="Shoppers who open the old address see “Page not found” again."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Redirect deleted.')
              setDeleting(null)
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
