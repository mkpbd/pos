import { useId, useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSaveStorefrontSettingsMutation, type StorefrontSettings } from '@/features/storefront/api'
import { fieldErrorMap } from '@/lib/forms'
import {
  ASSISTANT_LIMITS,
  assistantProblems,
  assistantServerErrors,
  HANDOFF_CHOICES,
  readAssistantSettings,
  toAssistantInput,
  type AssistantField,
  type AssistantSettings,
} from './model'

type Form = Omit<AssistantSettings, 'daily_conversation_limit'> & { daily_conversation_limit: string }

const toForm = (s: AssistantSettings): Form => ({ ...s, daily_conversation_limit: String(s.daily_conversation_limit) })
const fromForm = (f: Form): AssistantSettings => ({ ...f, daily_conversation_limit: f.daily_conversation_limit.trim() === '' ? NaN : Number(f.daily_conversation_limit) })

/**
 * AI2b assistant settings: on/off, name, greeting (English + Bangla), daily conversation limit and
 * hand-off. Saved together through the storefront settings endpoint's `assistant` key.
 * Render with `key` = settings.updated_at so a save from elsewhere refreshes the form.
 */
export function AssistantSettingsCard({ settings }: { settings: StorefrontSettings }) {
  const id = useId()
  const hasWhatsapp = Boolean(settings.whatsapp_number)
  const saved = readAssistantSettings(settings.assistant, hasWhatsapp)
  const [form, setForm] = useState<Form>(() => toForm(saved))
  const [errors, setErrors] = useState<Partial<Record<AssistantField | 'form', string>>>({})
  const [checked, setChecked] = useState(false)
  const save = useSaveStorefrontSettingsMutation()

  const values = fromForm(form)
  const problems = assistantProblems(values, hasWhatsapp)
  const shown: Partial<Record<AssistantField | 'form', string>> = { ...(checked ? problems : {}), ...errors }
  const dirty = JSON.stringify(toForm(saved)) !== JSON.stringify(form)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key as AssistantField] || errors.form) setErrors((e) => ({ ...e, [key]: undefined, form: undefined }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setChecked(true)
    setErrors({})
    if (Object.keys(problems).length > 0) {
      const first = Object.keys(problems)[0]
      document.getElementById(`${id}-${first}`)?.focus()
      return
    }
    save.mutate(
      { assistant: toAssistantInput(values) },
      {
        onSuccess: (s) => {
          const next = readAssistantSettings(s.assistant, Boolean(s.whatsapp_number))
          setForm(toForm(next))
          setChecked(false)
          toast.success(next.enabled ? 'Assistant settings saved. Shoppers can chat with it on your store.' : 'Assistant settings saved. The assistant is off.')
        },
        onError: (err) => {
          const mapped = assistantServerErrors(fieldErrorMap(err))
          setErrors(Object.keys(mapped).length > 0 ? mapped : { form: err.message })
        },
      },
    )
  }

  const describedBy = (field: AssistantField, hint: boolean) => (shown[field] || hint ? `${id}-${field}-message` : undefined)
  const message = (field: AssistantField, hint?: string) =>
    shown[field] ? (
      <p id={`${id}-${field}-message`} className="text-sm text-destructive">{shown[field]}</p>
    ) : hint ? (
      <p id={`${id}-${field}-message`} className="text-sm text-muted-foreground">{hint}</p>
    ) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Settings
          <Badge variant={saved.enabled ? 'success' : 'outline'} data-testid="assistant-state">{saved.enabled ? 'On' : 'Off'}</Badge>
        </CardTitle>
        <CardDescription>
          A chat button on your store where shoppers ask about products, delivery, payment, returns and — when signed in — their own orders. It answers only from your store’s information.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="Assistant settings">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Switch id={`${id}-enabled`} checked={form.enabled} aria-describedby={`${id}-enabled-help`} onCheckedChange={(on) => set('enabled', on)} />
              <Label htmlFor={`${id}-enabled`}>Show the assistant on my store</Label>
            </div>
            <p id={`${id}-enabled-help`} className="text-sm text-muted-foreground">
              Shoppers see a chat button in the bottom corner of every store page. Answers are written by AI and can be wrong; the chat says so. Try it on your live store after saving.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`}>Assistant name</Label>
              <Input
                id={`${id}-name`}
                value={form.name}
                aria-invalid={shown.name ? true : undefined}
                aria-describedby={describedBy('name', true)}
                onChange={(e) => set('name', e.target.value)}
              />
              {message('name', `Shown at the top of the chat (max. ${ASSISTANT_LIMITS.name} characters).`)}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-daily_conversation_limit`}>New chats per day</Label>
              <Input
                id={`${id}-daily_conversation_limit`}
                type="number"
                inputMode="numeric"
                min={ASSISTANT_LIMITS.dailyMin}
                max={ASSISTANT_LIMITS.dailyMax}
                step={1}
                className="w-full sm:w-40"
                value={form.daily_conversation_limit}
                aria-invalid={shown.daily_conversation_limit ? true : undefined}
                aria-describedby={describedBy('daily_conversation_limit', true)}
                onChange={(e) => set('daily_conversation_limit', e.target.value)}
              />
              {message('daily_conversation_limit', `After this many new chats in a day, shoppers are pointed to your hand-off instead (${ASSISTANT_LIMITS.dailyMin}–${ASSISTANT_LIMITS.dailyMax}). Keeps AI costs in check.`)}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-greeting`}>Greeting</Label>
              <Textarea
                id={`${id}-greeting`}
                rows={3}
                value={form.greeting}
                aria-invalid={shown.greeting ? true : undefined}
                aria-describedby={describedBy('greeting', true)}
                onChange={(e) => set('greeting', e.target.value)}
              />
              {message('greeting', `Optional. The first message shoppers see in the chat. ${form.greeting.trim().length} / ${ASSISTANT_LIMITS.greeting} characters.`)}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-greeting_bn`}>Greeting in Bangla</Label>
              <Textarea
                id={`${id}-greeting_bn`}
                rows={3}
                lang="bn"
                value={form.greeting_bn}
                placeholder={form.greeting}
                aria-invalid={shown.greeting_bn ? true : undefined}
                aria-describedby={describedBy('greeting_bn', true)}
                onChange={(e) => set('greeting_bn', e.target.value)}
              />
              {message('greeting_bn', `For shoppers using your store in Bangla. Leave empty to show the English greeting. ${form.greeting_bn.trim().length} / ${ASSISTANT_LIMITS.greeting} characters.`)}
            </div>
          </div>

          <fieldset className="flex flex-col gap-2" aria-describedby={shown.handoff ? `${id}-handoff-message` : undefined}>
            <legend className="mb-1 text-sm font-medium">When the assistant cannot help</legend>
            {HANDOFF_CHOICES.map((choice) => {
              const disabled = choice.value === 'whatsapp' && !hasWhatsapp && form.handoff !== 'whatsapp'
              return (
                <div key={choice.value} className="flex items-start gap-2">
                  <input
                    type="radio"
                    id={`${id}-handoff-${choice.value}`}
                    name={`${id}-handoff`}
                    value={choice.value}
                    className="mt-1 size-4 accent-primary"
                    checked={form.handoff === choice.value}
                    disabled={disabled}
                    aria-describedby={`${id}-handoff-${choice.value}-hint`}
                    onChange={() => set('handoff', choice.value)}
                  />
                  <div className="flex flex-col">
                    <Label htmlFor={`${id}-handoff-${choice.value}`} className={disabled ? 'text-muted-foreground' : undefined}>{choice.label}</Label>
                    <span id={`${id}-handoff-${choice.value}-hint`} className="text-sm text-muted-foreground">
                      {choice.hint}
                      {choice.value === 'whatsapp' && !hasWhatsapp && ' Add a WhatsApp number under Settings & domains to use this.'}
                    </span>
                  </div>
                </div>
              )
            })}
            {message('handoff')}
          </fieldset>

          {shown.form && <p role="alert" className="text-sm text-destructive">{shown.form}</p>}
          <Button type="submit" className="self-start" disabled={save.isPending || !dirty}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save assistant settings
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
