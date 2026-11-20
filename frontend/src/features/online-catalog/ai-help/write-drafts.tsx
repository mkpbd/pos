import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2Icon, SparklesIcon, XCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api/client'
import { useWebBrandsQuery, useWebCategoriesQuery } from '@/features/online-catalog/api'
import { ProductSearchAdder } from '@/features/online-catalog/components/ordered-picker'
import { aiHelpKeys, isBatchActive, useAiBatchQuery, useCancelBatchMutation, useCreateBatchMutation, type AiBatch, type BatchInput } from './api'
import {
  describeAiHelpError,
  fieldLabel,
  LANGUAGE_CHOICES,
  LENGTHS,
  MAX_BATCH_SUBJECTS,
  MAX_NOTES,
  MISSING_CHOICES,
  plural,
  SUBJECT_FIELDS,
  SUBJECT_LABELS,
  TONES,
  type AiLength,
  type AiSubject,
  type AiTone,
  type MissingCriterion,
} from './model'
import { AiHelpErrorAlert, ChosenList, type ChosenItem } from './parts'

export type DraftsPrefill = { subject: AiSubject; items: ChosenItem[] }

type FormState = {
  subject: AiSubject
  which: 'missing' | 'chosen'
  missing: MissingCriterion[]
  chosen: ChosenItem[]
  fields: string[]
  language: 'en' | 'bn' | 'both'
  tone: AiTone
  length: AiLength
  notes: string
}

const initialForm = (prefill: DraftsPrefill | null): FormState => ({
  subject: prefill?.subject ?? 'product',
  which: prefill && prefill.items.length > 0 ? 'chosen' : 'missing',
  missing: ['description'],
  chosen: prefill?.items.slice(0, MAX_BATCH_SUBJECTS) ?? [],
  fields: SUBJECT_FIELDS[prefill?.subject ?? 'product'],
  language: 'en',
  tone: 'friendly',
  length: 'medium',
  notes: '',
})

/** Contract §2 request body from the form. */
function batchInput(form: FormState): BatchInput {
  const languages = LANGUAGE_CHOICES.find((c) => c.value === form.language)?.languages ?? ['en']
  const notes = form.notes.trim()
  return {
    subject: form.subject,
    ...(form.which === 'chosen' ? { ids: form.chosen.map((c) => c.id) } : { missing: form.missing }),
    fields: SUBJECT_FIELDS[form.subject].filter((f) => form.fields.includes(f)),
    languages,
    tone: form.tone,
    length: form.length,
    ...(notes ? { notes } : {}),
  }
}

/** "Write drafts": what (products / categories / brands), which ones, fields, languages, tone, length and notes. */
export function WriteDraftsPanel({ prefill, running, onStarted, onShowBatch }: {
  prefill: DraftsPrefill | null
  running: boolean
  onStarted: (batch: AiBatch) => void
  /** Shows a run's progress (the one already running when a new run is refused). */
  onShowBatch: (batchId: string) => void
}) {
  const id = useId()
  const [form, setForm] = useState<FormState>(() => initialForm(prefill))
  const create = useCreateBatchMutation()
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))
  const subjectWords = SUBJECT_LABELS[form.subject]

  const problem =
    form.fields.length === 0
      ? 'Choose at least one text to write.'
      : form.which === 'missing' && form.missing.length === 0
        ? 'Choose what is missing.'
        : form.which === 'missing' && form.missing.includes('bangla') && form.language === 'en'
          ? 'To fill missing Bangla texts, choose Bangla or Both as the language.'
          : form.which === 'chosen' && form.chosen.length === 0
          ? `Choose at least one ${subjectWords.one.toLowerCase()}.`
          : form.notes.length > MAX_NOTES
            ? `Notes can be up to ${MAX_NOTES} characters.`
            : null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (problem || running) return
    create.mutate(batchInput(form), {
      onSuccess: (batch) => {
        toast.success(`Writing drafts for ${plural(batch.total, subjectWords.one.toLowerCase(), subjectWords.many.toLowerCase())}.`)
        onStarted(batch)
      },
    })
  }

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`} className="flex flex-col gap-5 rounded-lg border p-4" noValidate>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-base font-semibold">Write drafts</h2>
        <p className="text-sm text-muted-foreground">
          The AI writes texts from your catalog facts (names, categories, brands, options and specifications — never prices, stock or customers). Each text is a draft: nothing changes on your store until you approve it.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(SUBJECT_LABELS) as AiSubject[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <input
                type="radio"
                id={`${id}-subject-${s}`}
                name={`${id}-subject`}
                className="size-4 accent-primary"
                checked={form.subject === s}
                onChange={() => set({ subject: s, chosen: [], fields: SUBJECT_FIELDS[s], which: form.which })}
              />
              <Label htmlFor={`${id}-subject-${s}`} className="font-normal">{SUBJECT_LABELS[s].many}</Label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Which {subjectWords.many.toLowerCase()}</legend>
        <div className="flex items-center gap-2">
          <input type="radio" id={`${id}-which-missing`} name={`${id}-which`} className="size-4 accent-primary" checked={form.which === 'missing'} onChange={() => set({ which: 'missing' })} />
          <Label htmlFor={`${id}-which-missing`} className="font-normal">Ones with missing texts</Label>
        </div>
        {form.which === 'missing' && (
          <div className="flex flex-col gap-2 pl-6" role="group" aria-label="Missing texts">
            {MISSING_CHOICES.map((m) => (
              <div key={m.value} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-missing-${m.value}`}
                  checked={form.missing.includes(m.value)}
                  onCheckedChange={(v) => set({ missing: v === true ? [...form.missing, m.value] : form.missing.filter((x) => x !== m.value) })}
                />
                <Label htmlFor={`${id}-missing-${m.value}`} className="font-normal">{m.label}</Label>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="radio" id={`${id}-which-chosen`} name={`${id}-which`} className="size-4 accent-primary" checked={form.which === 'chosen'} onChange={() => set({ which: 'chosen' })} />
          <Label htmlFor={`${id}-which-chosen`} className="font-normal">
            The ones I choose{form.chosen.length > 0 && ` (${form.chosen.length} chosen)`}
          </Label>
        </div>
        {form.which === 'chosen' && (
          <div className="flex flex-col gap-2 pl-6">
            <ChosenList label={`Chosen ${subjectWords.many.toLowerCase()}`} items={form.chosen} onRemove={(cid) => set({ chosen: form.chosen.filter((c) => c.id !== cid) })} />
            {form.chosen.length < MAX_BATCH_SUBJECTS && <SubjectAdder subject={form.subject} chosen={form.chosen} onPick={(item) => set({ chosen: [...form.chosen, item] })} />}
            <p className="text-xs text-muted-foreground">Up to {MAX_BATCH_SUBJECTS} in one run.</p>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Texts to write</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {SUBJECT_FIELDS[form.subject].map((f) => (
            <div key={f} className="flex items-center gap-2">
              <Checkbox id={`${id}-field-${f}`} checked={form.fields.includes(f)} onCheckedChange={(v) => set({ fields: v === true ? [...form.fields, f] : form.fields.filter((x) => x !== f) })} />
              <Label htmlFor={`${id}-field-${f}`} className="font-normal">{fieldLabel(f)}</Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-language`}>Language</Label>
          <Select value={form.language} onValueChange={(v) => set({ language: v as FormState['language'] })}>
            <SelectTrigger id={`${id}-language`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGUAGE_CHOICES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-tone`}>Tone</Label>
          <Select value={form.tone} onValueChange={(v) => set({ tone: v as AiTone })}>
            <SelectTrigger id={`${id}-tone`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-length`}>Length</Label>
          <Select value={form.length} onValueChange={(v) => set({ length: v as AiLength })}>
            <SelectTrigger id={`${id}-length`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{LENGTHS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-notes`}>Notes for the AI <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea
          id={`${id}-notes`}
          rows={3}
          value={form.notes}
          placeholder="What should shoppers know? Material, size, care…"
          aria-describedby={`${id}-notes-count`}
          aria-invalid={form.notes.length > MAX_NOTES ? true : undefined}
          onChange={(e) => set({ notes: e.target.value })}
        />
        <p id={`${id}-notes-count`} className="text-xs text-muted-foreground">{form.notes.length} / {MAX_NOTES} characters. The same notes go with every item.</p>
      </div>

      {create.isError && (
        <AiHelpErrorAlert
          error={create.error}
          action={
            create.error instanceof ApiError && create.error.code === 'BATCH_RUNNING' && typeof create.error.details.batch_id === 'string' ? (
              <Button type="button" variant="link" className="h-auto self-start p-0" onClick={() => { onShowBatch(String((create.error as ApiError).details.batch_id)); create.reset() }}>
                See the running batch
              </Button>
            ) : undefined
          }
        />
      )}
      {problem && <p className="text-sm text-muted-foreground" id={`${id}-problem`}>{problem}</p>}
      {running && <p className="text-sm text-muted-foreground">Drafts are being written. You can start another run when this one finishes.</p>}

      <div>
        <Button type="submit" disabled={create.isPending || running || problem !== null} aria-describedby={problem ? `${id}-problem` : undefined}>
          {create.isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
          {create.isPending ? 'Starting…' : 'Write drafts'}
        </Button>
      </div>
    </form>
  )
}

function SubjectAdder({ subject, chosen, onPick }: { subject: AiSubject; chosen: ChosenItem[]; onPick: (item: ChosenItem) => void }) {
  if (subject === 'product') return <ProductSearchAdder label="Add a product" exclude={chosen.map((c) => c.id)} onPick={(item) => onPick({ id: item.id, name: item.name })} />
  return subject === 'category' ? <CategoryAdder chosen={chosen} onPick={onPick} /> : <BrandAdder chosen={chosen} onPick={onPick} />
}

function OptionAdder({ label, options, onPick }: { label: string; options: ChosenItem[]; onPick: (item: ChosenItem) => void }) {
  if (options.length === 0) return null
  return (
    <Select value="" onValueChange={(v) => { const option = options.find((o) => o.id === v); if (option) onPick(option) }}>
      <SelectTrigger aria-label={label} className="w-full sm:w-72"><SelectValue placeholder={`${label}…`} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function CategoryAdder({ chosen, onPick }: { chosen: ChosenItem[]; onPick: (item: ChosenItem) => void }) {
  const categories = useWebCategoriesQuery()
  const options = (categories.data ?? []).filter((c) => !chosen.some((x) => x.id === c.id)).map((c) => ({ id: c.id, name: `${'— '.repeat(c.depth)}${c.name}` }))
  return <OptionAdder label="Add a category" options={options} onPick={(item) => onPick({ id: item.id, name: item.name.replace(/^(— )+/, '') })} />
}

function BrandAdder({ chosen, onPick }: { chosen: ChosenItem[]; onPick: (item: ChosenItem) => void }) {
  const brands = useWebBrandsQuery()
  const options = (brands.data ?? []).filter((b) => !chosen.some((x) => x.id === b.id)).map((b) => ({ id: b.id, name: b.name }))
  return <OptionAdder label="Add a brand" options={options} onPick={onPick} />
}

const STATUS_TEXT: Record<AiBatch['status'], string> = {
  queued: 'Waiting to start…',
  running: 'Writing drafts…',
  done: 'Finished.',
  cancelled: 'Cancelled.',
  budget_stopped: 'Stopped: your shop reached this month’s AI budget. The drafts written so far are kept below.',
}

/** A run's progress: polled every 3 s while it runs (see useAiBatchQuery); cancel while it runs. */
export function BatchProgress({ batchId, canManage, onDismiss }: { batchId: string; canManage: boolean; onDismiss: () => void }) {
  const queryClient = useQueryClient()
  const batch = useAiBatchQuery(batchId)
  const cancel = useCancelBatchMutation()
  const data = batch.data
  const active = isBatchActive(data)
  const seen = useRef<string>('')

  // New drafts appear in the list as the run writes them, and once more when it ends.
  useEffect(() => {
    if (!data) return
    const mark = `${data.status}:${data.done}:${data.failed}`
    if (seen.current && seen.current !== mark) void queryClient.invalidateQueries({ queryKey: aiHelpKeys.draftsAll })
    if (seen.current !== mark && !isBatchActive(data)) void queryClient.invalidateQueries({ queryKey: aiHelpKeys.batches })
    seen.current = mark
  }, [data, queryClient])

  if (!data) return null
  const processed = data.done + data.failed
  const percent = data.percent
  const words = SUBJECT_LABELS[data.subject]

  return (
    <section aria-label="Drafts run" className="flex flex-col gap-3 rounded-lg border p-4" data-testid="batch-progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium" role="status">
          {STATUS_TEXT[data.status]} {processed} of {data.total} {(data.total === 1 ? words.one : words.many).toLowerCase()} done
          {data.failed > 0 && ` · ${data.failed} could not be written`}
        </p>
        {active && canManage ? (
          <Button type="button" variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(batchId, { onError: (e) => toast.error(describeAiHelpError(e).message) })}>
            <XCircleIcon data-icon="inline-start" /> Cancel run
          </Button>
        ) : !active ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>Hide</Button>
        ) : null}
      </div>
      <div role="progressbar" aria-label="Drafts written" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${processed} of ${data.total}`} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </section>
  )
}
