import { useId, useRef, useState, type FormEvent } from 'react'
import { Loader2Icon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/use-auth'
import { SALE_RECEIPT_EVENT, templateEvents, useSaveSmsSettingsMutation, type SmsSettings, type SmsTemplate, type SmsTemplates, type TemplateEvent } from '@/features/sms/api'
import { analyzeSms, describeSms, EXAMPLE_VALUES, insertAt, renderSmsTemplate } from '@/features/sms/sms-text'
import { fieldErrorMap } from '@/lib/forms'

export const MAX_TEMPLATE = 480

const EVENTS: Record<TemplateEvent, { title: string; hint: string }> = {
  order_placed: { title: 'Order placed', hint: 'Right after the customer places an online order.' },
  order_confirmed: { title: 'Payment received', hint: 'When an online payment for an order is confirmed.' },
  order_shipped: { title: 'Order shipped', hint: 'When the parcel is handed to the courier.' },
  order_delivered: { title: 'Order delivered', hint: 'When the order is marked delivered.' },
  order_cancelled: { title: 'Order cancelled', hint: 'When the order is cancelled.' },
  sale_receipt: { title: 'Sale receipt', hint: 'When a shop sale’s receipt is sent by SMS from the till or the sale’s page.' },
}

/** POS1d: the sale receipt knows the invoice, not an order or a courier. */
const SALE_RECEIPT_PLACEHOLDERS = ['shop', 'name', 'invoice', 'total', 'link']
const SALE_RECEIPT_EXAMPLES = { invoice: 'INV-MAIN-000123', link: 'https://shop.example.com/receipt/k3Jx9QaZ' }

const EMPTY: SmsTemplate = { enabled: false, en: '', bn: '' }
const templateOf = (templates: SmsTemplates, event: TemplateEvent): SmsTemplate => templates[event] ?? EMPTY

type Lang = 'en' | 'bn'
const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'bn', label: 'Bangla' },
]

const sameTemplates = (a: SmsTemplates, b: SmsTemplates) =>
  templateEvents(a).every((e) => {
    const [x, y] = [templateOf(a, e), templateOf(b, e)]
    return x.enabled === y.enabled && x.en === y.en && x.bn === y.bn
  })

/** SMS → Message templates: one per order event, in English and Bangla, with a live SMS counter. */
export function TemplatesCard({ settings, canManage }: { settings: SmsSettings; canManage: boolean }) {
  const save = useSaveSmsSettingsMutation()
  const me = useAuth()
  const [draft, setDraft] = useState<SmsTemplates>(settings.templates)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = !sameTemplates(draft, settings.templates)
  const vars = { ...EXAMPLE_VALUES, shop: me.organization?.name ?? 'Your shop' }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const found: Record<string, string> = {}
    for (const event of templateEvents(draft)) {
      const template = templateOf(draft, event)
      for (const { value: lang } of LANGS) {
        if (template[lang].length > MAX_TEMPLATE) found[`templates.${event}.${lang}`] = `Up to ${MAX_TEMPLATE} characters.`
      }
      if (template.enabled && template.en.trim() === '') found[`templates.${event}.en`] = 'Write the English text, or switch this message off.'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate(
      { templates: draft },
      {
        onSuccess: (saved) => {
          setDraft(saved.templates)
          toast.success('Message templates saved.')
        },
        onError: (error) => setErrors(fieldErrorMap(error)),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Message templates</h2>
        </CardTitle>
        <CardDescription>
          Texts sent to customers about their online orders and shop receipts, in the language they shopped in. Bangla texts use Unicode, so fewer characters fit in one SMS — each SMS part is charged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} aria-label="Message templates" className="flex flex-col gap-6">
          {templateEvents(draft).map((event) => (
            <TemplateEditor
              key={event}
              event={event}
              value={templateOf(draft, event)}
              fallback={settings.default_templates[event] ?? templateOf(settings.templates, event)}
              placeholders={event === SALE_RECEIPT_EVENT ? SALE_RECEIPT_PLACEHOLDERS : settings.placeholders.filter((p) => p !== 'invoice')}
              vars={event === SALE_RECEIPT_EVENT ? { ...vars, ...SALE_RECEIPT_EXAMPLES } : vars}
              canManage={canManage}
              errors={errors}
              onChange={(next) => setDraft((d) => ({ ...d, [event]: next }))}
            />
          ))}
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => { setDraft(settings.templates); setErrors({}) }}>
                Discard
              </Button>
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Save templates
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

type EditorProps = {
  event: TemplateEvent
  value: SmsTemplate
  fallback: SmsTemplate
  placeholders: string[]
  vars: Record<string, string>
  canManage: boolean
  errors: Record<string, string>
  onChange: (value: SmsTemplate) => void
}

function TemplateEditor({ event, value, fallback, placeholders, vars, canManage, errors, onChange }: EditorProps) {
  const id = useId()
  const { title, hint } = EVENTS[event]
  const refs = { en: useRef<HTMLTextAreaElement>(null), bn: useRef<HTMLTextAreaElement>(null) }
  const [target, setTarget] = useState<Lang>('en')
  const isDefault = value.en === fallback.en && value.bn === fallback.bn

  const insert = (name: string) => {
    const el = refs[target].current
    const { value: text, caret } = insertAt(value[target], `{${name}}`, el?.selectionStart ?? null, el?.selectionEnd ?? null)
    if (text.length > MAX_TEMPLATE) return
    onChange({ ...value, [target]: text })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-md border p-4" data-testid={`template-${event}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id={`${id}-title`} className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`${id}-enabled`} checked={value.enabled} disabled={!canManage} onCheckedChange={(on) => onChange({ ...value, enabled: on })} />
          <Label htmlFor={`${id}-enabled`}>
            Send <span className="sr-only">“{title}”</span>
          </Label>
        </div>
      </div>

      {LANGS.map(({ value: lang, label }) => {
        const text = value[lang]
        const error = errors[`templates.${event}.${lang}`]
        const preview = renderSmsTemplate(text, vars, placeholders)
        const count = analyzeSms(preview)
        return (
          <div key={lang} className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-${lang}`}>
              {label} <span className="sr-only">text for “{title}”</span>
            </Label>
            <Textarea
              id={`${id}-${lang}`}
              ref={refs[lang]}
              rows={3}
              lang={lang}
              maxLength={MAX_TEMPLATE}
              readOnly={!canManage}
              placeholder={lang === 'bn' ? 'Empty: Bangla shoppers get the English text.' : undefined}
              value={text}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-${lang}-count`}
              onFocus={() => setTarget(lang)}
              onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
            />
            <p id={`${id}-${lang}-count`} className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} data-testid={`template-${event}-${lang}-count`}>
              {error ?? (text.trim() === '' ? (lang === 'bn' ? 'Uses the English text.' : 'Empty.') : `${describeSms(count)} with example values`)}
            </p>
          </div>
        )
      })}

      {canManage && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Insert into the {target === 'en' ? 'English' : 'Bangla'} text:</span>
          {placeholders.map((name) => (
            <Button
              key={name}
              type="button"
              variant="outline"
              size="xs"
              className="font-mono"
              aria-label={`Insert {${name}} into the ${target === 'en' ? 'English' : 'Bangla'} text of “${title}”`}
              // Keep the caret in the text area while clicking.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(name)}
            >
              {`{${name}}`}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            disabled={isDefault}
            aria-label={`Reset “${title}” to default`}
            onClick={() => onChange({ ...value, en: fallback.en, bn: fallback.bn })}
          >
            <RotateCcwIcon data-icon="inline-start" /> Reset to default
          </Button>
        </div>
      )}
    </section>
  )
}
