import { useId, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangleIcon, CheckIcon, SearchIcon, XIcon } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { ApiError } from '@/lib/api/client'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import {
  useAiBatchesQuery,
  useAiDraftsQuery,
  useApproveDraftMutation,
  useApproveManyMutation,
  useRejectDraftMutation,
  type AiBatch,
  type AiDraft,
  type DraftFilters,
  type DraftStatus,
} from './api'
import { approveSkipText, describeAiHelpError, draftErrorText, fieldLabel, fieldLimit, htmlToPlain, LANGUAGE_LABELS, MAX_APPROVE_MANY, plural, SUBJECT_LABELS, type AiSubject } from './model'
import { AiHelpErrorAlert } from './parts'

const ALL = 'all'

const STATUS_WORDS: Record<DraftStatus, { label: string; variant: 'warning' | 'success' | 'outline' | 'destructive' | 'info' }> = {
  pending: { label: 'Waiting for review', variant: 'warning' },
  stale: { label: 'Listing changed', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'outline' },
  failed: { label: 'Could not write', variant: 'destructive' },
}

const reviewable = (d: AiDraft) => d.status === 'pending' || d.status === 'stale'

/** Product / category description is HTML (edited with the rich text editor); everything else is plain text. */
const isHtmlField = (subject: AiSubject, field: string) => field === 'description_html' || (field === 'description' && subject !== 'brand')

const dateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const batchLabel = (b: AiBatch) => `${SUBJECT_LABELS[b.subject].many} · ${b.created_at ? dateTime.format(new Date(b.created_at)) : b.id.slice(0, 8)}`

/** Drafts the AI wrote: filters, search, bulk approve and the review drawer. */
export function DraftsList({ canManage, batchFilter, onBatchFilter }: { canManage: boolean; batchFilter: string | null; onBatchFilter: (id: string | null) => void }) {
  const id = useId()
  const [status, setStatus] = useState<DraftFilters['status']>('pending')
  const [subject, setSubject] = useState<DraftFilters['subject']>(ALL)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [open, setOpen] = useState<AiDraft | null>(null)
  const term = useDebouncedValue(search.trim())
  const filters: DraftFilters = { status, subject, batch_id: batchFilter, search: term, page }
  const drafts = useAiDraftsQuery(filters)
  const batches = useAiBatchesQuery()
  const approveMany = useApproveManyMutation()

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setPage(1)
    setSelected([])
  }

  const rows = drafts.data?.items ?? []
  const selectable = canManage ? rows.filter((d) => d.status === 'pending') : []
  const allSelected = selectable.length > 0 && selectable.every((d) => selected.includes(d.id))

  const runApproveMany = () => {
    const ids = selected.slice(0, MAX_APPROVE_MANY)
    approveMany.mutate(ids, {
      onSuccess: (result) => {
        setConfirming(false)
        setSelected([])
        if (result.approved > 0) toast.success(`${plural(result.approved, 'draft')} approved and saved to the listings.`)
        if (result.skipped.length > 0) {
          const name = (draftId: string) => rows.find((d) => d.id === draftId)?.subject_name ?? 'A draft'
          toast.message(`${plural(result.skipped.length, 'draft was', 'drafts were')} left out`, {
            description: result.skipped.map((s) => `${name(s.id)}: ${approveSkipText(s.reason)}.`).join(' '),
          })
        }
      },
      onError: (error) => {
        setConfirming(false)
        toast.error(describeAiHelpError(error).message)
      },
    })
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-base font-semibold">Drafts</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search drafts by name" placeholder="Search by name" className="pl-8" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => reset(setStatus)(v as DraftFilters['status'])}>
          <SelectTrigger aria-label="Filter by status" className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(STATUS_WORDS) as DraftStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_WORDS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={subject} onValueChange={(v) => reset(setSubject)(v as DraftFilters['subject'])}>
          <SelectTrigger aria-label="Filter by kind" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everything</SelectItem>
            {(Object.keys(SUBJECT_LABELS) as AiSubject[]).map((s) => <SelectItem key={s} value={s}>{SUBJECT_LABELS[s].many}</SelectItem>)}
          </SelectContent>
        </Select>
        {(batches.data?.length ?? 0) > 0 && (
          <Select value={batchFilter ?? ALL} onValueChange={(v) => reset(onBatchFilter)(v === ALL ? null : v)}>
            <SelectTrigger aria-label="Filter by run" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All runs</SelectItem>
              {batches.data?.map((b) => <SelectItem key={b.id} value={b.id}>{batchLabel(b)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2" role="region" aria-label="Bulk actions">
          <span className="px-1 text-sm font-medium" aria-live="polite">{selected.length} selected</span>
          <Button size="sm" onClick={() => setConfirming(true)}><CheckIcon data-icon="inline-start" /> Approve selected</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      {drafts.isPending ? (
        <LoadingState rows={4} label="Loading drafts" />
      ) : drafts.isError ? (
        <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={status === 'pending' ? 'No drafts waiting for review' : 'No drafts found'}
          description={term ? 'Try another name.' : canManage && status === 'pending' ? 'Use “Write drafts” above to let the AI write texts for you.' : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="AI drafts">
              <TableHeader>
                <TableRow>
                  {canManage && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all drafts waiting for review on this page"
                        disabled={selectable.length === 0}
                        checked={allSelected ? true : selectable.some((d) => selected.includes(d.id)) ? 'indeterminate' : false}
                        onCheckedChange={(v) => setSelected(v === true ? [...new Set([...selected, ...selectable.map((d) => d.id)])] : selected.filter((x) => !selectable.some((d) => d.id === x)))}
                      />
                    </TableHead>
                  )}
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Language</TableHead>
                  <TableHead className="hidden md:table-cell">Texts</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const isSelected = selected.includes(d.id)
                  return (
                    <TableRow key={d.id} data-state={isSelected ? 'selected' : undefined} data-testid={`draft-${d.id}`}>
                      {canManage && (
                        <TableCell>
                          {d.status === 'pending' && (
                            <Checkbox aria-label={`Select ${d.subject_name} (${LANGUAGE_LABELS[d.language]})`} checked={isSelected} onCheckedChange={(v) => setSelected(v === true ? [...selected, d.id] : selected.filter((x) => x !== d.id))} />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="font-medium">{d.subject_name}</span>
                        <span className="block text-xs text-muted-foreground">{SUBJECT_LABELS[d.subject].one}<span className="sm:hidden"> · {LANGUAGE_LABELS[d.language]}</span></span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{LANGUAGE_LABELS[d.language]}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{d.fields.map((f) => fieldLabel(f.field)).join(', ') || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_WORDS[d.status].variant}>
                          {d.status === 'stale' && <AlertTriangleIcon aria-hidden data-icon="inline-start" />}
                          {STATUS_WORDS[d.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setOpen(d)} aria-label={`${canManage && reviewable(d) ? 'Review' : 'View'} ${d.subject_name} (${LANGUAGE_LABELS[d.language]})`}>
                          {canManage && reviewable(d) ? 'Review' : 'View'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {drafts.data.pagination && <PaginationBar pagination={drafts.data.pagination} onPageChange={(p) => { setPage(p); setSelected([]) }} />}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Approve ${plural(Math.min(selected.length, MAX_APPROVE_MANY), 'draft')}?`}
        description={`Their texts replace the current ones on the listings, as the AI wrote them. Nothing is published or unpublished. Drafts whose listing changed in the meantime are left out.${selected.length > MAX_APPROVE_MANY ? ` Only the first ${MAX_APPROVE_MANY} are approved at once.` : ''}`}
        confirmLabel="Approve"
        destructive={false}
        pending={approveMany.isPending}
        onConfirm={runApproveMany}
      />

      {open && <DraftReviewSheet key={open.id} draft={open} canManage={canManage} onClose={() => setOpen(null)} />}
    </section>
  )
}

type FieldState = { use: boolean; value: string; edited: boolean }

/** One draft side by side with the current texts: each text can be edited or left out; Approve / Reject. */
export function DraftReviewSheet({ draft, canManage, onClose }: { draft: AiDraft; canManage: boolean; onClose: () => void }) {
  const id = useId()
  const editable = canManage && reviewable(draft)
  const [fields, setFields] = useState<Record<string, FieldState>>(() =>
    Object.fromEntries(draft.fields.map((f) => [f.field, { use: f.proposed.trim() !== '', value: f.proposed, edited: false }])),
  )
  const [stale, setStale] = useState(draft.stale)
  const approve = useApproveDraftMutation()
  const reject = useRejectDraftMutation()
  const lang = draft.language
  const busy = approve.isPending || reject.isPending

  const over = draft.fields.filter((f) => {
    const limit = fieldLimit(draft.subject, f.field)
    const state = fields[f.field]
    return limit !== null && state?.use && state.value.length > limit
  })
  const chosen = draft.fields.filter((f) => fields[f.field]?.use && fields[f.field]!.value.trim() !== '')

  const runApprove = (force: boolean) => {
    const payload = Object.fromEntries(chosen.map((f) => [f.field, fields[f.field]!.value]))
    approve.mutate(
      { id: draft.id, fields: payload, force },
      {
        onSuccess: () => {
          toast.success(`${plural(chosen.length, 'text')} saved to ${draft.subject_name}.`)
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'DRAFT_STALE') setStale(true)
        },
      },
    )
  }

  const runReject = () =>
    reject.mutate(draft.id, {
      onSuccess: () => {
        toast.success(`Draft for ${draft.subject_name} rejected.`)
        onClose()
      },
    })

  const error = approve.error ?? reject.error
  const showError = error && !(error instanceof ApiError && error.code === 'DRAFT_STALE')

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{draft.subject_name}</SheetTitle>
          <SheetDescription>
            {SUBJECT_LABELS[draft.subject].one} · {LANGUAGE_LABELS[draft.language]} · {STATUS_WORDS[draft.status].label}.{' '}
            {editable ? 'Compare each text with the current one, edit it if you like, and approve the ones to keep. Approving saves them to the listing; it does not publish anything.' : 'Written by AI.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4">
          {draft.status === 'failed' && (
            <p role="note" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{draftErrorText(draft.error)}</p>
          )}
          {editable && stale && (
            <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="stale-warning">
              <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex flex-col gap-2">
                <p className="font-medium">This text changed since the draft was written</p>
                <p className="text-muted-foreground">Someone edited the listing after the AI wrote this. Check the current text below; approving anyway replaces it.</p>
              </div>
            </div>
          )}

          {draft.fields.map((f) => {
            const state = fields[f.field] ?? { use: false, value: f.proposed, edited: false }
            const limit = fieldLimit(draft.subject, f.field)
            const html = isHtmlField(draft.subject, f.field)
            const label = fieldLabel(f.field)
            const tooLong = limit !== null && state.value.length > limit
            const update = (value: string) => setFields((all) => ({ ...all, [f.field]: { ...state, value, edited: true } }))
            const fid = `${id}-${f.field}`
            return (
              <fieldset key={f.field} className="flex flex-col gap-2 rounded-lg border p-3" data-testid={`review-field-${f.field}`}>
                <legend className="px-1 text-sm font-semibold">{label}</legend>
                {editable && (
                  <div className="flex items-center gap-2">
                    <Checkbox id={`${fid}-use`} checked={state.use} onCheckedChange={(v) => setFields((all) => ({ ...all, [f.field]: { ...state, use: v === true } }))} />
                    <Label htmlFor={`${fid}-use`} className="font-normal">Use the new {label.toLowerCase()}</Label>
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground" id={`${fid}-current-label`}>Now{f.changed && ' (changed since the draft)'}</span>
                    <div aria-labelledby={`${fid}-current-label`} role="group" lang={lang} className="min-h-10 rounded-md bg-muted/50 p-2 text-sm whitespace-pre-line">
                      {f.current && f.current.trim() !== '' ? (html ? htmlToPlain(f.current) : f.current) : <span className="text-muted-foreground" lang="en">Empty</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${fid}-proposed`} className="text-xs font-medium text-muted-foreground">Written by AI{state.edited && ' (edited)'}</Label>
                    {editable && html ? (
                      <RichTextEditor id={`${fid}-proposed`} label={`New ${label.toLowerCase()}`} value={state.value} onChange={update} lang={lang} />
                    ) : editable ? (
                      <Textarea
                        id={`${fid}-proposed`}
                        lang={lang}
                        rows={f.field === 'seo_title' ? 2 : 4}
                        value={state.value}
                        aria-invalid={tooLong ? true : undefined}
                        aria-describedby={limit !== null ? `${fid}-count` : undefined}
                        onChange={(e) => update(e.target.value)}
                      />
                    ) : (
                      <div id={`${fid}-proposed`} lang={lang} className="min-h-10 rounded-md border p-2 text-sm whitespace-pre-line">{html ? htmlToPlain(state.value) : state.value}</div>
                    )}
                    {limit !== null && (
                      <p id={`${fid}-count`} className={tooLong ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
                        {state.value.length} / {limit} characters{tooLong && ' — too long, shorten it'}
                      </p>
                    )}
                  </div>
                </div>
              </fieldset>
            )
          })}

          {draft.missing_info.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-dashed p-3 text-sm">
              <p className="font-medium">Things to add</p>
              <p className="text-muted-foreground">The AI did not know these. Adding them to the product makes the texts better:</p>
              <ul className="list-disc pl-5">{draft.missing_info.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}

          {showError && <AiHelpErrorAlert error={error} />}
        </div>

        {editable && (
          <SheetFooter className="flex-row flex-wrap justify-end gap-2">
            {over.length > 0 && <p className="w-full text-sm text-destructive">{fieldLabel(over[0]!.field)} is too long.</p>}
            <Button variant="outline" disabled={busy} onClick={runReject}><XIcon data-icon="inline-start" /> Reject</Button>
            <Button disabled={busy || chosen.length === 0 || over.length > 0} onClick={() => runApprove(stale)}>
              <CheckIcon data-icon="inline-start" /> {stale ? 'Approve anyway' : chosen.length === draft.fields.length ? 'Approve' : `Approve ${plural(chosen.length, 'text')}`}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
