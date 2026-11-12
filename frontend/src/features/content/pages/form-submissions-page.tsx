import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArchiveIcon, ArchiveRestoreIcon, MailIcon, MailOpenIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExportMenu } from '@/components/common/export-menu'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { ContentHeader } from '@/features/content/components/content-header'
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  formatSubmissionValue,
  replyMailto,
  submissionSummary,
  toListParams,
  type FormSubmissionFilters,
} from '@/features/content/form-submissions'
import {
  FORM_SUBMISSION_STATUS_LABELS,
  formKey,
  useDeleteFormSubmissionMutation,
  useFormSubmissionQuery,
  useFormSubmissionsQuery,
  useFormsQuery,
  useSetFormSubmissionStatusMutation,
  type FormSubmission,
  type FormSubmissionStatus,
  type FormSummary,
} from '@/features/content/forms-api'
import { formatDateTime } from '@/features/web-orders/orders'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
const STATUS_BADGE: Record<FormSubmissionStatus, 'info' | 'secondary' | 'outline'> = { new: 'info', read: 'secondary', archived: 'outline' }

function StatusBadge({ status }: { status: FormSubmissionStatus }) {
  return <Badge variant={STATUS_BADGE[status]}>{FORM_SUBMISSION_STATUS_LABELS[status]}</Badge>
}

// ── Forms list ───────────────────────────────────────────────────────────────

function FormsList({ forms, selected, onSelect }: { forms: FormSummary[]; selected: string; onSelect: (key: string) => void }) {
  const totalNew = forms.reduce((sum, f) => sum + f.new, 0)
  const item = (key: string, title: string, sub: string | null, counts: string, active: boolean) => (
    <li key={key || ALL}>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(key)}
        className={cn(
          'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          active && 'bg-accent font-medium',
        )}
      >
        <span className="w-full truncate">{title}</span>
        {sub && <span className="w-full truncate text-xs font-normal text-muted-foreground">{sub}</span>}
        <span className="text-xs font-normal text-muted-foreground">{counts}</span>
      </button>
    </li>
  )

  return (
    <ul className="flex flex-col gap-1" aria-label="Forms">
      {item('', 'All forms', null, `${totalNew} new`, selected === '')}
      {forms.map((f) => {
        const key = formKey(f)
        return item(key, f.title, f.document_title ?? null, `${f.new} new · ${f.total} total`, selected === key)
      })}
    </ul>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────

function SubmissionDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const can = useCan()
  const timeZone = useAuth().organization?.timezone
  const { data, error, isPending, refetch } = useFormSubmissionQuery(id)
  const setStatus = useSetFormSubmissionStatusMutation()
  const remove = useDeleteFormSubmissionMutation()
  const [confirming, setConfirming] = useState(false)

  if (isPending) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Form submission</SheetTitle>
          <SheetDescription className="sr-only">Loading the submission</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <LoadingState rows={4} label="Loading submission" />
        </div>
      </>
    )
  }
  if (error) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Form submission</SheetTitle>
          <SheetDescription className="sr-only">The submission could not be loaded</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <ErrorState error={error} onRetry={() => refetch()} title="Could not open this submission" />
        </div>
      </>
    )
  }

  const submission = data
  const mailto = replyMailto(submission)
  const received = formatDateTime(submission.created_at, timeZone)
  const change = (status: FormSubmissionStatus, message: string) =>
    setStatus.mutate({ id: submission.id, status }, { onSuccess: () => toast.success(message), onError: (e) => toast.error(e.message) })

  return (
    <>
      <SheetHeader>
        <SheetTitle>{submission.form_title}</SheetTitle>
        <SheetDescription>
          Received {received}
          {submission.document_title ? ` · ${submission.document_title}` : ''}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={submission.status} />
          {submission.read_at && submission.status !== 'new' && (
            <span className="text-xs text-muted-foreground">
              Read {formatDateTime(submission.read_at, timeZone)}
              {submission.read_by?.name ? ` by ${submission.read_by.name}` : ''}
            </span>
          )}
        </div>

        {submission.reply_to && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <span className="text-xs text-muted-foreground">Reply to</span>
            <span className="text-sm break-all select-all" data-testid="reply-to">{submission.reply_to}</span>
            {mailto && (
              <Button asChild variant="outline" size="sm" className="self-start">
                <a href={mailto}>
                  <MailIcon data-icon="inline-start" /> Reply by e-mail
                </a>
              </Button>
            )}
          </div>
        )}

        <dl className="flex flex-col gap-3" aria-label="Answers">
          {submission.fields.map((field) => (
            <div key={field.id} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
              <dd className="text-sm break-words whitespace-pre-line">{formatSubmissionValue(submission.values[field.id])}</dd>
            </div>
          ))}
        </dl>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          {submission.page_path && (
            <>
              <dt>Sent from</dt>
              <dd className="break-all">{submission.page_path}</dd>
            </>
          )}
          {submission.locale && (
            <>
              <dt>Language</dt>
              <dd>{submission.locale === 'bn' ? 'Bangla' : submission.locale === 'en' ? 'English' : submission.locale}</dd>
            </>
          )}
        </dl>

        {can('forms.manage') && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {submission.status === 'new' && (
              <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={() => change('read', 'Marked as read.')}>
                <MailOpenIcon data-icon="inline-start" /> Mark as read
              </Button>
            )}
            {submission.status === 'read' && (
              <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={() => change('new', 'Marked as new.')}>
                <MailIcon data-icon="inline-start" /> Mark as new
              </Button>
            )}
            {submission.status === 'archived' ? (
              <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={() => change('read', 'Moved back from the archive.')}>
                <ArchiveRestoreIcon data-icon="inline-start" /> Unarchive
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={() => change('archived', 'Submission archived.')}>
                <ArchiveIcon data-icon="inline-start" /> Archive
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
              <Trash2Icon data-icon="inline-start" /> Delete
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this submission?"
        description={`The answers sent with "${submission.form_title}" on ${received} are removed for good.`}
        confirmLabel="Delete submission"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(submission.id, {
            onSuccess: () => {
              setConfirming(false)
              toast.success('Submission deleted.')
              onDeleted()
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** /content/forms[/:submissionId] — what visitors sent with the forms of the store builder (B8b). */
export function FormSubmissionsPage() {
  const { submissionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const timeZone = useAuth().organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = filtersFromSearchParams(searchParams)
  const [search, setSearch] = useState(filters.search)
  const debounced = useDebouncedValue(search, 300)
  const params = toListParams(filters, debounced)
  const forms = useFormsQuery()
  const submissions = useFormSubmissionsQuery(params)

  const update = (patch: Partial<FormSubmissionFilters>) => setSearchParams(filtersToSearchParams({ ...filters, page: 1, ...patch }), { replace: true })

  // The typed search reaches the address once it settles (the list already uses it).
  useEffect(() => {
    if (debounced.trim() === filters.search) return
    setSearchParams(filtersToSearchParams({ ...filters, search: debounced.trim(), page: 1 }), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the settled search triggers this
  }, [debounced])

  const closeDetail = () => navigate(`/content/forms${location.search}`)
  const selectedForm = forms.data?.find((f) => formKey(f) === filters.form)
  const filtered = !!(filters.status || debounced.trim() || filters.from || filters.to)
  const statusCount = (s: FormSubmissionStatus) => submissions.data?.counts?.[s]
  const newCount = statusCount('new') ?? (filters.form ? selectedForm?.new : forms.data?.reduce((sum, f) => sum + f.new, 0))

  return (
    <div className="flex flex-col gap-6">
      <ContentHeader
        actions={
          <ExportMenu
            list="formSubmissions"
            query={params}
            title={selectedForm ? `${selectedForm.title} submissions` : undefined}
            disabled={!submissions.data?.items.length}
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Forms</CardTitle>
            <CardDescription>Choose a form to see only its answers. Its export has one column per field.</CardDescription>
          </CardHeader>
          <CardContent>
            {forms.isPending ? (
              <LoadingState rows={3} label="Loading forms" />
            ) : forms.error ? (
              <ErrorState error={forms.error} onRetry={() => forms.refetch()} />
            ) : (
              <FormsList forms={forms.data} selected={filters.form} onSelect={(form) => update({ form })} />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="flex flex-col gap-4">
            <Tabs value={filters.status ?? ALL} onValueChange={(v) => update({ status: v === ALL ? null : (v as FormSubmissionStatus) })}>
              <TabsList aria-label="Submission status">
                <TabsTrigger value={ALL}>All</TabsTrigger>
                <TabsTrigger value="new">New{newCount !== undefined ? ` (${newCount})` : ''}</TabsTrigger>
                <TabsTrigger value="read">Read</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative min-w-48 flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input className="pl-8" placeholder="Search the answers" aria-label="Search submissions" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="forms-from">Received from</Label>
                <Input id="forms-from" type="date" className="w-40" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="forms-to">To</Label>
                <Input id="forms-to" type="date" className="w-40" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
              </div>
              {filtered && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch('')
                    setSearchParams(filtersToSearchParams({ form: filters.form, status: null, search: '', from: '', to: '', page: 1 }), { replace: true })
                  }}
                >
                  <XIcon data-icon="inline-start" /> Clear filters
                </Button>
              )}
            </div>

            {submissions.isPending ? (
              <LoadingState rows={5} label="Loading submissions" />
            ) : submissions.error ? (
              <ErrorState error={submissions.error} onRetry={() => submissions.refetch()} />
            ) : submissions.data.items.length === 0 ? (
              <EmptyState
                title={filtered ? 'No submissions match these filters' : filters.form ? 'No submissions for this form yet' : 'No form submissions yet'}
                description={filtered || filters.form ? undefined : 'Add a Form element to a page or popup in the Page builder. What visitors send with it appears here.'}
              />
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <Table aria-label="Form submissions">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Received</TableHead>
                        <TableHead className="hidden md:table-cell">Form</TableHead>
                        <TableHead>Answers</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {submissions.data.items.map((s: FormSubmission) => (
                        <TableRow key={s.id} data-state={s.id === submissionId ? 'selected' : undefined}>
                          <TableCell className="text-sm whitespace-nowrap">{formatDateTime(s.created_at, timeZone)}</TableCell>
                          <TableCell className="hidden text-sm md:table-cell">{s.form_title}</TableCell>
                          <TableCell className="max-w-md">
                            <Link
                              to={`/content/forms/${s.id}${location.search}`}
                              className={cn('line-clamp-2 text-sm underline-offset-4 hover:underline', s.status === 'new' && 'font-medium')}
                            >
                              {submissionSummary(s)}
                            </Link>
                            <span className="text-xs text-muted-foreground md:hidden">{s.form_title}</span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={s.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar pagination={submissions.data.pagination} onPageChange={(page) => setSearchParams(filtersToSearchParams({ ...filters, page }), { replace: true })} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={submissionId !== undefined} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent className="w-full sm:max-w-lg">
          {submissionId && <SubmissionDetail key={submissionId} id={submissionId} onDeleted={closeDetail} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}
