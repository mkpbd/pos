/*
 * AI2a §5 "Write with AI" on the product / category / brand listing forms. Staff pick the texts,
 * languages, tone, length and add notes; the AI's suggestions are shown next to the current
 * texts (each with a checkbox, on for empty fields) and "Use selected" fills the form in one
 * change that can be undone. Nothing is saved until staff save the listing as usual.
 */

import { useId, useRef, useState, type RefObject } from 'react'
import { useFormState, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { Loader2Icon, RotateCwIcon, SparklesIcon, Undo2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUserQuery } from '@/features/auth/api'
import { useCan } from '@/features/auth/use-auth'
import {
  AI_LANGUAGES,
  AI_NOTES_MAX,
  asHtml,
  describeAiWriteError,
  htmlLines,
  isBlank,
  LENGTHS,
  listingAiOn,
  TONES,
  useListingAiWriteMutation,
  type AiField,
  type AiLanguage,
  type AiLanguageChoice,
  type AiLength,
  type AiSubject,
  type AiTone,
  type AiWriteAnswer,
  type AiWriteError,
} from '@/features/online-catalog/ai-writer'
import { cn } from '@/lib/utils'

/** One text the AI can write and where it lives in the form. */
export type AiTarget = {
  field: AiField
  /** As the form labels it, e.g. "Short description". */
  label: string
  /** Form path of the English text, e.g. "description_html". */
  path: string
  /** Form path of the Bangla text, e.g. "translations.bn.description_html". */
  bnPath: string
  /** Rich text (HTML) rather than plain text. */
  html?: boolean
  /** Character limit, shown as a counter. */
  max?: number
}

type Props<T extends FieldValues> = {
  subject: AiSubject
  id: string
  form: UseFormReturn<T>
  targets: readonly AiTarget[]
  /** Fields ticked when the dialog opens (default: all). */
  preset?: readonly AiField[]
  /** Accessible name of the button when there are several on the page. */
  buttonLabel?: string
  /** Called after texts were put in the form, with the languages they went to. */
  onApplied?: (languages: AiLanguage[]) => void
  className?: string
}

type Applied = { count: number; previous: { path: string; value: string }[]; seenDirty: boolean }

/** The "Write with AI" button, its dialog and the "not saved yet / Undo" note. Null when AI is off. */
export function ListingAiWriter<T extends FieldValues>({ subject, id, form, targets, preset, buttonLabel, onApplied, className }: Props<T>) {
  const { data: me } = useCurrentUserQuery()
  const can = useCan()
  const f = form as unknown as UseFormReturn<FieldValues>
  const { isDirty } = useFormState({ control: f.control })
  const [open, setOpen] = useState(false)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [status, setStatus] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)

  // Saving (or undoing everything) makes the form clean again: the note is no longer true.
  if (applied && isDirty && !applied.seenDirty) setApplied({ ...applied, seenDirty: true })
  if (applied?.seenDirty && !isDirty) setApplied(null)

  if (!listingAiOn(me) || !can('online_catalog.manage') || targets.length === 0) return null

  const read = (path: string) => {
    const v: unknown = f.getValues(path)
    return typeof v === 'string' ? v : ''
  }
  const write = (path: string, value: string) => f.setValue(path, value, { shouldDirty: true, shouldValidate: true })

  const apply = (items: { lang: AiLanguage; target: AiTarget; text: string }[]) => {
    const previous = items.map(({ lang, target }) => {
      const path = lang === 'en' ? target.path : target.bnPath
      return { path, value: read(path) }
    })
    for (const { lang, target, text } of items) write(lang === 'en' ? target.path : target.bnPath, target.html ? asHtml(text) : text)
    setApplied({ count: items.length, previous, seenDirty: false })
    setStatus('')
    setOpen(false)
    onApplied?.([...new Set(items.map((i) => i.lang))])
  }

  const undo = () => {
    if (!applied) return
    for (const { path, value } of applied.previous) write(path, value)
    setApplied(null)
    setStatus('Undone. The earlier texts are back.')
    // The Undo button disappears: keep the keyboard user next to it.
    trigger.current?.focus()
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Button ref={trigger} type="button" variant="outline" size="sm" className="self-start" aria-label={buttonLabel} onClick={() => setOpen(true)}>
        <SparklesIcon data-icon="inline-start" /> Write with AI
      </Button>
      <div role="status" aria-live="polite" className="text-sm">
        {applied ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2" data-testid="ai-writer-applied">
            <span>
              AI texts added to {applied.count === 1 ? '1 field' : `${applied.count} fields`}. <strong className="font-medium">Not saved yet:</strong> check them, then save the listing.
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={undo}>
              <Undo2Icon data-icon="inline-start" /> Undo
            </Button>
          </div>
        ) : (
          status && <span className="text-muted-foreground">{status}</span>
        )}
      </div>
      {open && <AiWriterDialog subject={subject} id={id} targets={targets} preset={preset} read={read} trigger={trigger} onClose={() => setOpen(false)} onApply={apply} />}
    </div>
  )
}

type Phase =
  | { step: 'ask' }
  | { step: 'working' }
  | { step: 'review'; answer: AiWriteAnswer; languages: AiLanguage[] }
  | { step: 'error'; error: AiWriteError }

type Row = { key: string; lang: AiLanguage; target: AiTarget; current: string; text: string }

const SUBJECT_NOUN: Record<AiSubject, string> = { product: 'product', category: 'category', brand: 'brand' }

function AiWriterDialog({ subject, id, targets, preset, read, trigger, onClose, onApply }: {
  subject: AiSubject
  /** Focus goes back to the button that opened the dialog. */
  trigger: RefObject<HTMLButtonElement | null>
  id: string
  targets: readonly AiTarget[]
  preset?: readonly AiField[]
  read: (path: string) => string
  onClose: () => void
  onApply: (items: { lang: AiLanguage; target: AiTarget; text: string }[]) => void
}) {
  const ids = useId()
  const write = useListingAiWriteMutation()
  const abort = useRef<AbortController | null>(null)
  const [languages, setLanguages] = useState<AiLanguageChoice>('en')
  const [tone, setTone] = useState<AiTone>('friendly')
  const [length, setLength] = useState<AiLength>('medium')
  const [notes, setNotes] = useState('')
  const [fields, setFields] = useState<Set<AiField>>(() => new Set(preset ?? targets.map((t) => t.field)))
  const [phase, setPhase] = useState<Phase>({ step: 'ask' })
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const rowsOf = (answer: AiWriteAnswer, langs: AiLanguage[]): Row[] =>
    langs.flatMap((lang) =>
      targets.flatMap((target) => {
        const text = answer.suggestions[lang]?.[target.field]
        return text === undefined ? [] : [{ key: `${lang}.${target.field}`, lang, target, current: read(lang === 'en' ? target.path : target.bnPath), text }]
      }),
    )

  const run = () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const langs = [...AI_LANGUAGES[languages]]
    const picked = targets.map((t) => t.field).filter((field) => fields.has(field))
    setPhase({ step: 'working' })
    write.mutate(
      { input: { subject, id, fields: picked, languages: langs, tone, length, notes }, signal: controller.signal },
      {
        onSuccess: (answer) => {
          if (controller.signal.aborted) return
          const rows = rowsOf(answer, langs)
          setChosen(new Set(rows.filter((r) => isBlank(r.current, !!r.target.html)).map((r) => r.key)))
          setPhase({ step: 'review', answer, languages: langs })
        },
        onError: (error) => {
          if (controller.signal.aborted) return
          setPhase({ step: 'error', error: describeAiWriteError(error) })
        },
      },
    )
  }

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const rows = phase.step === 'review' ? rowsOf(phase.answer, phase.languages) : []
  const selected = rows.filter((r) => chosen.has(r.key))
  const noun = SUBJECT_NOUN[subject]

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-3xl"
        data-testid="listing-ai-writer"
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" aria-hidden /> Write with AI
          </DialogTitle>
          <DialogDescription>
            The AI writes from this {noun}’s details and your notes. You check every text before it goes into the form, and nothing is saved until you save the listing.
          </DialogDescription>
        </DialogHeader>

        {phase.step === 'ask' && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Texts to write</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {targets.map((t) => {
                  const checkId = `${ids}-field-${t.field}`
                  return (
                    <div key={t.field} className="flex items-center gap-2">
                      <Checkbox
                        id={checkId}
                        checked={fields.has(t.field)}
                        onCheckedChange={(checked) =>
                          setFields((s) => {
                            const next = new Set(s)
                            if (checked === true) next.add(t.field)
                            else next.delete(t.field)
                            return next
                          })
                        }
                      />
                      <Label htmlFor={checkId} className="font-normal">{t.label}</Label>
                    </div>
                  )
                })}
              </div>
            </fieldset>
            <Choice
              name={`${ids}-language`}
              legend="Language"
              value={languages}
              onChange={setLanguages}
              options={[
                { value: 'en', label: 'English' },
                { value: 'bn', label: 'বাংলা', hint: 'Bangla', lang: 'bn' },
                { value: 'both', label: 'Both' },
              ]}
            />
            <Choice name={`${ids}-tone`} legend="Tone" value={tone} onChange={setTone} options={TONES.map(({ value, label }) => ({ value, label }))} hint={TONES.find((t) => t.value === tone)?.hint} />
            <Choice name={`${ids}-length`} legend="Length" value={length} onChange={setLength} options={LENGTHS} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-notes`}>Notes for the AI</Label>
              <Textarea
                id={`${ids}-notes`}
                rows={3}
                maxLength={AI_NOTES_MAX}
                value={notes}
                placeholder="What should shoppers know? Material, size, care…"
                aria-describedby={`${ids}-notes-hint`}
                onChange={(e) => setNotes(e.target.value)}
              />
              <p id={`${ids}-notes-hint`} className="text-xs text-muted-foreground">
                Optional. The AI only uses what it is told; it won’t make up sizes, materials or promises. Prices, stock and customer details are never sent. {notes.length}/{AI_NOTES_MAX}
              </p>
            </div>
          </div>
        )}

        {phase.step === 'working' && (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="listing-ai-working">
            <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Writing… This takes a few seconds.
          </p>
        )}

        {phase.step === 'error' && (
          <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="listing-ai-error">
            <p className="font-medium">{phase.error.title}</p>
            <p>{phase.error.message}</p>
          </div>
        )}

        {phase.step === 'review' && (
          <div className="flex flex-col gap-4" data-testid="listing-ai-review">
            {rows.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">The AI didn’t send back any text to use. Try again, perhaps with a few notes.</p>
            ) : (
              <p role="status" className="text-sm">
                {rows.length === 1 ? '1 suggestion' : `${rows.length} suggestions`}. Tick the ones to use; empty fields are ticked for you.
              </p>
            )}
            {phase.languages.map((lang) => {
              const group = rows.filter((r) => r.lang === lang)
              if (group.length === 0) return null
              return (
                <section key={lang} aria-labelledby={`${ids}-lang-${lang}`} className="flex flex-col gap-2">
                  <h3 id={`${ids}-lang-${lang}`} className="text-sm font-semibold">
                    {lang === 'bn' ? <><span lang="bn">বাংলা</span> (Bangla)</> : 'English'}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.map((row) => (
                      <ReviewRow
                        key={row.key}
                        row={row}
                        checkId={`${ids}-use-${row.key.replace('.', '-')}`}
                        checked={chosen.has(row.key)}
                        onCheckedChange={(on) =>
                          setChosen((s) => {
                            const next = new Set(s)
                            if (on) next.add(row.key)
                            else next.delete(row.key)
                            return next
                          })
                        }
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
            {phase.answer.missingInfo.length > 0 && (
              <section aria-labelledby={`${ids}-missing`} className="rounded-md border bg-muted/40 p-3 text-sm">
                <h3 id={`${ids}-missing`} className="font-semibold">Things to add</h3>
                <p className="text-xs text-muted-foreground">The AI could write better with these details. Add them to the notes or the specifications.</p>
                <ul className="mt-1 list-disc pl-5">
                  {phase.answer.missingInfo.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          {phase.step === 'ask' && (
            <Button type="button" disabled={fields.size === 0} onClick={run}>
              <SparklesIcon data-icon="inline-start" /> Write
            </Button>
          )}
          {(phase.step === 'review' || (phase.step === 'error' && !phase.error.final)) && (
            <Button type="button" variant="outline" onClick={() => setPhase({ step: 'ask' })}>
              <RotateCwIcon data-icon="inline-start" /> {phase.step === 'error' ? 'Try again' : 'Write again'}
            </Button>
          )}
          {phase.step === 'review' && rows.length > 0 && (
            <Button type="button" disabled={selected.length === 0} onClick={() => onApply(selected.map((r) => ({ lang: r.lang, target: r.target, text: r.text })))}>
              Use selected{selected.length > 0 ? ` (${selected.length})` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Choice<V extends string>({ name, legend, value, onChange, options, hint }: {
  name: string
  legend: string
  value: V
  onChange: (value: V) => void
  options: readonly { value: V; label: string; hint?: string; lang?: string }[]
  hint?: string
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-6 items-center gap-2 text-sm">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="size-4 accent-primary" />
            <span lang={o.lang}>{o.label}</span>
            {o.hint && <span className="text-muted-foreground">({o.hint})</span>}
          </label>
        ))}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  )
}

function Text({ value, html, lang }: { value: string; html: boolean; lang?: string }) {
  const lines = html ? htmlLines(value) : [value]
  return (
    <div lang={lang} className="flex flex-col gap-1 text-sm break-words whitespace-pre-line">
      {lines.map((line, i) => <p key={i}>{line}</p>)}
    </div>
  )
}

function Count({ value, max }: { value: string; max: number }) {
  const over = value.length > max
  return (
    <span className={cn('text-xs tabular-nums', over ? 'font-medium text-destructive' : 'text-muted-foreground')}>
      {value.length}/{max} characters{over ? ' (too long)' : ''}
    </span>
  )
}

function ReviewRow({ row, checkId, checked, onCheckedChange }: { row: Row; checkId: string; checked: boolean; onCheckedChange: (on: boolean) => void }) {
  const { target, lang } = row
  const html = !!target.html
  const empty = isBlank(row.current, html)
  const bnLang = lang === 'bn' ? 'bn' : undefined
  const seo = target.field === 'seo_title' || target.field === 'seo_description'
  return (
    <li className={cn('flex gap-3 rounded-md border p-3', !checked && 'bg-muted/30')} data-testid="listing-ai-row">
      <Checkbox id={checkId} checked={checked} className="mt-0.5" onCheckedChange={(c) => onCheckedChange(c === true)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Label htmlFor={checkId}>
          {`Use for ${target.label} `}
          <span className="sr-only">({lang === 'bn' ? 'Bangla' : 'English'})</span>
        </Label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Now</span>
            {empty ? <p className="text-sm text-muted-foreground italic">Empty</p> : <Text value={row.current} html={html} lang={bnLang} />}
            {seo && target.max !== undefined && !empty && <Count value={row.current} max={target.max} />}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Suggested</span>
            <div data-testid="listing-ai-suggested"><Text value={row.text} html={html} lang={bnLang} /></div>
            {seo && target.max !== undefined && <Count value={row.text} max={target.max} />}
          </div>
        </div>
      </div>
    </li>
  )
}

