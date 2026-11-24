import { useId, useState, type FormEvent } from 'react'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  useSaveSmsSettingsMutation,
  type SmsDriver,
  type SmsHttpBody,
  type SmsHttpMethod,
  type SmsPhoneFormat,
  type SmsSettings,
  type SmsSettingsInput,
} from '@/features/sms/api'
import { fieldErrorMap } from '@/lib/forms'

export const MAX_EXTRA_PARAMS = 10
const PARAM_NAME = /^[A-Za-z0-9_.\-[\]]{1,40}$/
const PARAM_HINT = 'Letters, digits and _ . - [ ] only, up to 40.'

const DRIVERS: { value: SmsDriver; label: string; hint: string }[] = [
  { value: 'log', label: 'Test mode (write to the server log)', hint: 'Nothing reaches phones. Use it to try order messages before you have an SMS provider.' },
  { value: 'http', label: 'HTTP SMS gateway', hint: 'Your SMS provider’s web address. Works with most Bangladeshi bulk SMS providers.' },
]

const PHONE_FORMATS: { value: SmsPhoneFormat; label: string; example: string }[] = [
  { value: 'local', label: 'Local', example: '01712345678' },
  { value: '880', label: 'With country code', example: '8801712345678' },
  { value: 'plus880', label: 'With + and country code', example: '+8801712345678' },
]

type ExtraRow = { id: number; key: string; value: string }

type Draft = {
  is_enabled: boolean
  driver: SmsDriver
  http_url: string
  http_method: SmsHttpMethod
  http_body: SmsHttpBody
  param_to: string
  param_message: string
  param_sender: string
  param_api_key: string
  sender_id: string
  extra: ExtraRow[]
  success_contains: string
  phone_format: SmsPhoneFormat
  monthly_limit: string
}

type ErrorKey = 'http_url' | 'param_to' | 'param_message' | 'param_sender' | 'param_api_key' | 'api_key' | 'sender_id' | 'extra_params' | 'success_contains' | 'monthly_limit' | 'form'
type Errors = Partial<Record<ErrorKey, string>>
const ERROR_KEYS: ErrorKey[] = ['http_url', 'param_to', 'param_message', 'param_sender', 'param_api_key', 'api_key', 'sender_id', 'extra_params', 'success_contains', 'monthly_limit']

let rowId = 0
const toDraft = (s: SmsSettings): Draft => ({
  is_enabled: s.is_enabled,
  driver: s.driver,
  http_url: s.http_url ?? '',
  http_method: s.http_method,
  http_body: s.http_body,
  param_to: s.param_to,
  param_message: s.param_message,
  param_sender: s.param_sender ?? '',
  param_api_key: s.param_api_key ?? '',
  sender_id: s.sender_id ?? '',
  extra: Object.entries(s.extra_params).map(([key, value]) => ({ id: ++rowId, key, value })),
  success_contains: s.success_contains ?? '',
  phone_format: s.phone_format,
  monthly_limit: s.monthly_limit === null ? '' : String(s.monthly_limit),
})

const extraObject = (rows: ExtraRow[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.key.trim() !== '' || r.value.trim() !== '').map((r) => [r.key.trim(), r.value.trim()]))
const sameObject = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** The changed fields only; the API key only when a new one was typed. */
function changes(draft: Draft, s: SmsSettings, apiKey: string): SmsSettingsInput {
  const input: SmsSettingsInput = {}
  if (draft.is_enabled !== s.is_enabled) input.is_enabled = draft.is_enabled
  if (draft.driver !== s.driver) input.driver = draft.driver
  if (orNull(draft.http_url) !== s.http_url) input.http_url = orNull(draft.http_url)
  if (draft.http_method !== s.http_method) input.http_method = draft.http_method
  if (draft.http_body !== s.http_body) input.http_body = draft.http_body
  if (draft.param_to.trim() !== s.param_to) input.param_to = draft.param_to.trim()
  if (draft.param_message.trim() !== s.param_message) input.param_message = draft.param_message.trim()
  if (orNull(draft.param_sender) !== s.param_sender) input.param_sender = orNull(draft.param_sender)
  if (orNull(draft.param_api_key) !== s.param_api_key) input.param_api_key = orNull(draft.param_api_key)
  if (orNull(draft.sender_id) !== s.sender_id) input.sender_id = orNull(draft.sender_id)
  const extra = extraObject(draft.extra)
  if (!sameObject(extra, s.extra_params)) input.extra_params = extra
  if (orNull(draft.success_contains) !== s.success_contains) input.success_contains = orNull(draft.success_contains)
  if (draft.phone_format !== s.phone_format) input.phone_format = draft.phone_format
  const limit = draft.monthly_limit.trim() === '' ? null : Number(draft.monthly_limit.trim())
  if (limit !== s.monthly_limit) input.monthly_limit = limit
  if (apiKey.trim() !== '') input.api_key = apiKey.trim()
  return input
}

function validate(draft: Draft): Errors {
  const found: Errors = {}
  const url = draft.http_url.trim()
  if (url !== '') {
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol) || url.length > 500) found.http_url = 'Enter the full address, starting with https://.'
  } else if (draft.driver === 'http' && draft.is_enabled) {
    found.http_url = 'Enter your SMS provider’s address to use the HTTP gateway.'
  }
  if (!PARAM_NAME.test(draft.param_to.trim())) found.param_to = PARAM_HINT
  if (!PARAM_NAME.test(draft.param_message.trim())) found.param_message = PARAM_HINT
  if (draft.param_sender.trim() !== '' && !PARAM_NAME.test(draft.param_sender.trim())) found.param_sender = PARAM_HINT
  if (draft.param_api_key.trim() !== '' && !PARAM_NAME.test(draft.param_api_key.trim())) found.param_api_key = PARAM_HINT
  if (draft.sender_id.trim().length > 20) found.sender_id = 'Up to 20 characters.'
  const rows = draft.extra.filter((r) => r.key.trim() !== '' || r.value.trim() !== '')
  const keys = rows.map((r) => r.key.trim())
  if (rows.length > MAX_EXTRA_PARAMS) found.extra_params = `Up to ${MAX_EXTRA_PARAMS} extra parameters.`
  else if (keys.some((k) => !PARAM_NAME.test(k))) found.extra_params = `Every extra parameter needs a name. ${PARAM_HINT}`
  else if (new Set(keys).size !== keys.length) found.extra_params = 'Each parameter name can be used once.'
  else if (rows.some((r) => r.value.trim().length > 255)) found.extra_params = 'Values can be up to 255 characters.'
  if (draft.success_contains.trim().length > 100) found.success_contains = 'Up to 100 characters.'
  const limit = draft.monthly_limit.trim()
  if (limit !== '' && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 1_000_000)) found.monthly_limit = 'A whole number from 1 to 1,000,000, or empty for no limit.'
  return found
}

/** Whether SMS can go out now, in plain words (from the saved settings). */
export function ReadyState({ settings }: { settings: SmsSettings }) {
  const [badge, variant, text] = !settings.ready
    ? (['Not sending', 'warning', settings.is_enabled ? 'Add your SMS provider’s address to start sending.' : 'SMS is switched off. Customers get no order messages or sign-in codes.'] as const)
    : settings.driver === 'log'
      ? ([
          'Test mode',
          'info',
          settings.otp_ready
            ? 'Messages are written to the server log, not sent to phones. Sign-in and checkout codes also go to the log — fine for trying things out.'
            : 'Messages are written to the server log, not sent to phones. Sign-in and checkout codes cannot be sent in test mode on a live server — choose an HTTP SMS gateway.',
        ] as const)
      : ([
          'Sending',
          'success',
          settings.otp_ready ? 'Order messages and sign-in codes go out through your SMS gateway.' : 'Order messages go out through your SMS gateway. Sign-in codes are not available yet.',
        ] as const)
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3 text-sm" data-testid="sms-ready">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={variant}>{badge}</Badge>
        <Badge variant={settings.otp_ready ? 'success' : 'outline'}>{settings.otp_ready ? 'Codes can be sent' : 'Codes cannot be sent'}</Badge>
      </div>
      <p className="text-muted-foreground">{text}</p>
    </div>
  )
}

/** SMS → Gateway: switch, test mode or an HTTP gateway with its parameter names, write-only API key. */
export function GatewayCard({ settings, canManage }: { settings: SmsSettings; canManage: boolean }) {
  const id = useId()
  const save = useSaveSmsSettingsMutation()
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))
  const [apiKey, setApiKey] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [removing, setRemoving] = useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const input = changes(draft, settings, apiKey)
  const dirty = Object.keys(input).length > 0
  const http = draft.driver === 'http'

  const onError = (error: unknown) => {
    const map = fieldErrorMap(error)
    const next: Errors = {}
    for (const [key, message] of Object.entries(map)) {
      const root = key.split('.')[0] as ErrorKey
      if (ERROR_KEYS.includes(root)) next[root] ??= message
      else next.form ??= message
    }
    setErrors(next)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const found = validate(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate(input, {
      onSuccess: (saved) => {
        setApiKey('')
        setDraft(toDraft(saved))
        toast.success(saved.ready ? 'SMS settings saved.' : 'SMS settings saved. Nothing is sent until SMS is on and a gateway is set.')
      },
      onError,
    })
  }

  const removeKey = () =>
    save.mutate(
      { api_key: null },
      {
        onSuccess: () => toast.success('API key removed.'),
        onError,
        onSettled: () => setRemoving(false),
      },
    )

  const updateRow = (rid: number, patch: Partial<ExtraRow>) => set('extra', draft.extra.map((r) => (r.id === rid ? { ...r, ...patch } : r)))

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Gateway</h2>
        </CardTitle>
        <CardDescription>How messages leave the shop: your SMS provider’s web address, or test mode while you set things up.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ReadyState settings={settings} />
        <form noValidate onSubmit={onSubmit} aria-label="SMS gateway settings" className="flex flex-col gap-5">
          <fieldset disabled={!canManage} className="contents">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${id}-enabled`}>Send SMS</Label>
                <p className="text-sm text-muted-foreground" id={`${id}-enabled-hint`}>
                  Order messages to customers, and sign-in and checkout codes when the online store asks for them.
                </p>
              </div>
              <Switch id={`${id}-enabled`} checked={draft.is_enabled} disabled={!canManage} onCheckedChange={(on) => set('is_enabled', on)} aria-describedby={`${id}-enabled-hint`} />
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">Send through</legend>
              {DRIVERS.map((d) => (
                <div key={d.value} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`${id}-driver`}
                    id={`${id}-driver-${d.value}`}
                    value={d.value}
                    checked={draft.driver === d.value}
                    onChange={() => set('driver', d.value)}
                    aria-describedby={`${id}-driver-${d.value}-hint`}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <div className="flex flex-col">
                    <Label htmlFor={`${id}-driver-${d.value}`}>{d.label}</Label>
                    <span id={`${id}-driver-${d.value}-hint`} className="text-sm text-muted-foreground">{d.hint}</span>
                  </div>
                </div>
              ))}
            </fieldset>

            {http && (
              <div className="flex flex-col gap-5 rounded-md border p-4">
                <FormField label="Gateway address" error={errors.http_url} hint="From your SMS provider’s API page, e.g. https://api.provider.com.bd/sms/send">
                  <Input type="url" inputMode="url" spellCheck={false} autoComplete="off" maxLength={500} value={draft.http_url} onChange={(e) => set('http_url', e.target.value)} />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-method`}>Request method</Label>
                    <Select value={draft.http_method} onValueChange={(v) => set('http_method', v as SmsHttpMethod)} disabled={!canManage}>
                      <SelectTrigger id={`${id}-method`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="GET">GET (values in the address)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-body`}>Body format</Label>
                    <Select value={draft.http_body} onValueChange={(v) => set('http_body', v as SmsHttpBody)} disabled={!canManage || draft.http_method === 'GET'}>
                      <SelectTrigger id={`${id}-body`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="form">Form fields</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 text-sm font-medium">Parameter names</legend>
                  <p className="text-sm text-muted-foreground">What your provider calls each value. Copy them from its API page.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Phone number parameter" error={errors.param_to}>
                      <Input spellCheck={false} autoComplete="off" maxLength={40} value={draft.param_to} onChange={(e) => set('param_to', e.target.value)} />
                    </FormField>
                    <FormField label="Message parameter" error={errors.param_message}>
                      <Input spellCheck={false} autoComplete="off" maxLength={40} value={draft.param_message} onChange={(e) => set('param_message', e.target.value)} />
                    </FormField>
                    <FormField label="Sender ID parameter" error={errors.param_sender} hint="Leave empty if your provider has none.">
                      <Input spellCheck={false} autoComplete="off" maxLength={40} value={draft.param_sender} onChange={(e) => set('param_sender', e.target.value)} />
                    </FormField>
                    <FormField label="API key parameter" error={errors.param_api_key} hint="Leave empty if the key is part of the address.">
                      <Input spellCheck={false} autoComplete="off" maxLength={40} value={draft.param_api_key} onChange={(e) => set('param_api_key', e.target.value)} />
                    </FormField>
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`${id}-key`}>API key</Label>
                      {settings.api_key_set && <Badge variant="success">Saved</Badge>}
                      {settings.api_key_set && canManage && (
                        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setRemoving(true)}>
                          Remove
                        </Button>
                      )}
                    </div>
                    <Input
                      id={`${id}-key`}
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder={settings.api_key_set ? 'Type a new key to replace it' : 'Paste the API key'}
                      value={apiKey}
                      aria-invalid={errors.api_key ? true : undefined}
                      aria-describedby={`${id}-key-help`}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <p id={`${id}-key-help`} className={errors.api_key ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                      {errors.api_key ?? 'Kept encrypted and never shown again. Leave empty to keep the saved one.'}
                    </p>
                  </div>
                  <FormField label="Sender ID" error={errors.sender_id} hint="The name or number customers see, as approved by your provider.">
                    <Input spellCheck={false} autoComplete="off" maxLength={20} value={draft.sender_id} onChange={(e) => set('sender_id', e.target.value)} />
                  </FormField>
                </div>

                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 text-sm font-medium">Phone number format</legend>
                  {PHONE_FORMATS.map((f) => (
                    <div key={f.value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${id}-phone-format`}
                        id={`${id}-phone-format-${f.value}`}
                        value={f.value}
                        checked={draft.phone_format === f.value}
                        onChange={() => set('phone_format', f.value)}
                        className="size-4 accent-primary"
                      />
                      <Label htmlFor={`${id}-phone-format-${f.value}`}>
                        {f.label} <span className="font-mono font-normal text-muted-foreground">{f.example}</span>
                      </Label>
                    </div>
                  ))}
                </fieldset>

                <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-extra-help`}>
                  <legend className="mb-1 text-sm font-medium">Extra parameters</legend>
                  <p id={`${id}-extra-help`} className={errors.extra_params ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                    {errors.extra_params ?? `Fixed values some providers need, e.g. type = text. Not for secrets — use the API key field. Up to ${MAX_EXTRA_PARAMS}.`}
                  </p>
                  {draft.extra.map((row, index) => (
                    <div key={row.id} className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label={`Extra parameter ${index + 1} name`}
                        placeholder="Name"
                        spellCheck={false}
                        maxLength={40}
                        className="w-40 flex-1"
                        value={row.key}
                        onChange={(e) => updateRow(row.id, { key: e.target.value })}
                      />
                      <Input
                        aria-label={`Extra parameter ${index + 1} value`}
                        placeholder="Value"
                        spellCheck={false}
                        maxLength={255}
                        className="w-40 flex-1"
                        value={row.value}
                        onChange={(e) => updateRow(row.id, { value: e.target.value })}
                      />
                      {canManage && (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove extra parameter ${index + 1}`} onClick={() => set('extra', draft.extra.filter((r) => r.id !== row.id))}>
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  ))}
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={draft.extra.length >= MAX_EXTRA_PARAMS}
                      onClick={() => set('extra', [...draft.extra, { id: ++rowId, key: '', value: '' }])}
                    >
                      <PlusIcon data-icon="inline-start" /> Add parameter
                    </Button>
                  )}
                </fieldset>

                <FormField label="Success text" error={errors.success_contains} hint="Optional. Counted as sent only when the provider’s reply contains this text, e.g. SUCCESS or 1000.">
                  <Input spellCheck={false} autoComplete="off" maxLength={100} value={draft.success_contains} onChange={(e) => set('success_contains', e.target.value)} />
                </FormField>
              </div>
            )}

            <FormField label="Monthly limit (messages)" error={errors.monthly_limit} hint="Optional safety cap. Messages over it this month are skipped, not sent." className="sm:max-w-xs">
              <Input inputMode="numeric" autoComplete="off" value={draft.monthly_limit} onChange={(e) => set('monthly_limit', e.target.value)} />
            </FormField>
          </fieldset>

          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setDraft(toDraft(settings))
                  setApiKey('')
                  setErrors({})
                }}
              >
                Discard
              </Button>
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Save gateway settings
              </Button>
            </div>
          )}
        </form>
      </CardContent>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the saved API key?"
        description="Messages through the HTTP gateway will fail until you save a new key (unless your provider needs none)."
        confirmLabel="Remove key"
        pending={save.isPending}
        onConfirm={removeKey}
      />
    </Card>
  )
}
