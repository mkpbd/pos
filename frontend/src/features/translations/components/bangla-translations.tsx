import { lazy, Suspense, useId, useState } from 'react'
import { ChevronDownIcon, LanguagesIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BANGLA_HELP, bnLabel, countTranslated, plainText, type BnValues, type TranslationField } from '@/features/translations/translations'
import { cn } from '@/lib/utils'

/** Loaded on demand: editors without rich-text fields (promotions, shipping, payments) skip TipTap. */
const RichTextEditor = lazy(() => import('@/features/content/components/rich-text-editor').then((m) => ({ default: m.RichTextEditor })))

type Props = {
  /** The entity's translatable fields with their English values. */
  fields: readonly TranslationField[]
  value: BnValues
  onChange: (next: BnValues) => void
  /** Keyed by field name ("title"), e.g. from bnErrors() or rhfBnErrors(). */
  errors?: Record<string, string | undefined>
  disabled?: boolean
  /** Starts expanded; by default only when something is translated already. */
  defaultOpen?: boolean
  className?: string
}

function counter(value: string, max: number | undefined): string | undefined {
  return max === undefined ? undefined : `${value.length}/${max}`
}

/**
 * The "বাংলা (Bangla)" section of a content editor: one Bangla input per translatable field, with
 * the English text as placeholder (or hint for rich text), the base field's limits and counters,
 * and `lang="bn"` so browsers pick Bangla fonts, keyboards and spelling. Collapsed until opened,
 * unless something is translated already; opens by itself when a Bangla field has an error.
 */
export function BanglaTranslations({ fields, value, onChange, errors = {}, disabled = false, defaultOpen, className }: Props) {
  const ids = useId()
  const names = fields.map((f) => f.name)
  const translated = countTranslated(value, names)
  const [open, setOpen] = useState(defaultOpen ?? translated > 0)
  const errorSignature = names.filter((n) => errors[n]).join(',')
  const [seenErrors, setSeenErrors] = useState('')
  if (errorSignature !== seenErrors) {
    setSeenErrors(errorSignature)
    if (errorSignature) setOpen(true)
  }
  const set = (name: string, text: string) => onChange({ ...value, [name]: text })
  const panelId = `${ids}-panel`
  const status = translated === 0 ? 'Not translated' : translated === fields.length ? 'Translated' : `${translated} of ${fields.length} translated`

  return (
    <section aria-labelledby={`${ids}-heading`} className={cn('rounded-md border', errorSignature && 'border-destructive/60', className)}>
      <h3 id={`${ids}-heading`} className="text-sm font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-md p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LanguagesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1">
            <span lang="bn">বাংলা</span> (Bangla)
          </span>
          <Badge variant={translated === 0 ? 'outline' : 'soft'} className="font-normal">{status}</Badge>
          <ChevronDownIcon className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && (
        <div id={panelId} className="flex flex-col gap-4 border-t p-3">
          <p className="text-sm text-muted-foreground">
            Shown to shoppers who switch the store to <span lang="bn">বাংলা</span>. {BANGLA_HELP}
          </p>
          {fields.map((field) => {
            const id = `${ids}-${field.name}`
            const text = value[field.name] ?? ''
            const error = errors[field.name]
            const label = bnLabel(field.label)
            const base = field.base?.trim() ? field.base : null

            if (field.kind === 'rich') {
              const english = plainText(base)
              const hintId = `${id}-hint`
              return (
                <div key={field.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={id}>{label}</Label>
                  <Suspense fallback={<div className="min-h-48 animate-pulse rounded-md border bg-muted/40" aria-hidden />}>
                    <RichTextEditor id={id} lang="bn" label={label} value={text} onChange={(html) => set(field.name, html)} invalid={!!error} disabled={disabled} />
                  </Suspense>
                  {error ? (
                    <p id={hintId} className="text-sm text-destructive">{error}</p>
                  ) : (
                    <p id={hintId} className="text-sm text-muted-foreground">{english ? <>English: <span className="italic">{english}</span></> : 'No English text yet.'}</p>
                  )}
                </div>
              )
            }

            const hint = [counter(text, field.max), base ? null : 'No English text yet.'].filter(Boolean).join(' · ') || undefined
            const common = {
              lang: 'bn',
              value: text,
              placeholder: base ?? undefined,
              maxLength: field.max,
              disabled,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field.name, e.target.value),
            }
            return (
              <FormField key={field.name} label={label} error={error} hint={hint}>
                {field.kind === 'textarea' ? <Textarea rows={field.rows ?? 2} {...common} /> : <Input {...common} />}
              </FormField>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** A single Bangla input for compact editors (menu item labels). */
export function BanglaInput({ label, base, value, onChange, max, error, disabled, className }: {
  /** Accessible name, e.g. "Item 1 Bangla label". */
  label: string
  base?: string | null
  value: string
  onChange: (value: string) => void
  max?: number
  error?: string
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Input
        id={id}
        lang="bn"
        aria-label={label}
        placeholder={base?.trim() ? `বাংলা: ${base}` : 'বাংলা'}
        title={`${label}. ${BANGLA_HELP}`}
        value={value}
        maxLength={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
