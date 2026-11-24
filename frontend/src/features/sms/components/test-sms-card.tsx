import { useId, useState, type FormEvent } from 'react'
import { Loader2Icon, SendIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSendTestSmsMutation, type SmsSettings, type SmsTestResult } from '@/features/sms/api'
import { analyzeSms, describeSms } from '@/features/sms/sms-text'
import { ApiError } from '@/lib/api/client'
import { BD_MOBILE, normalizeBdPhone } from '@/storefront/account/schemas'

const DEFAULT_MESSAGE = '{shop}: test message from your POS.'
const MAX_MESSAGE = 480

/** SMS → Send a test SMS (sms.manage): sends synchronously and shows the provider's answer. */
export function TestSmsCard({ settings }: { settings: SmsSettings }) {
  const id = useId()
  const send = useSendTestSmsMutation()
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<SmsTestResult | null>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const normalized = normalizeBdPhone(phone.trim())
    if (!BD_MOBILE.test(normalized)) {
      setPhoneError('Enter a Bangladeshi mobile number, e.g. 01712345678.')
      return
    }
    setPhoneError(null)
    setFormError(null)
    setResult(null)
    send.mutate(
      { phone: normalized, ...(message.trim() !== '' ? { message: message.trim() } : {}) },
      {
        onSuccess: setResult,
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'SMS_UNAVAILABLE') setFormError('SMS is not ready: switch it on and choose a gateway, then save.')
          else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            setPhoneError(error.fieldErrors.phone?.[0] ?? null)
            setFormError(error.fieldErrors.message?.[0] ?? (error.fieldErrors.phone ? null : error.message))
          } else if (error instanceof ApiError && error.status === 429) setFormError('Too many test messages. Wait a minute and try again.')
          else setFormError(error instanceof Error ? error.message : 'Could not send the test message.')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Send a test SMS</h2>
        </CardTitle>
        <CardDescription>Check the gateway with your own phone. Saved settings are used — save changes first.</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} aria-label="Send a test SMS" className="flex flex-col gap-4">
          {!settings.ready && (
            <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              Switch SMS on and choose a gateway first.
            </p>
          )}
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor={`${id}-phone`}>Mobile number</Label>
            <Input
              id={`${id}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="01712345678"
              value={phone}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? `${id}-phone-error` : undefined}
              onChange={(e) => setPhone(e.target.value)}
            />
            {phoneError && <p id={`${id}-phone-error`} className="text-sm text-destructive">{phoneError}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-message`}>Message</Label>
            <Textarea
              id={`${id}-message`}
              rows={2}
              maxLength={MAX_MESSAGE}
              placeholder={DEFAULT_MESSAGE}
              value={message}
              aria-describedby={`${id}-message-count`}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p id={`${id}-message-count`} className="text-xs text-muted-foreground" data-testid="sms-test-counter">
              {message.trim() === '' ? 'Leave empty to send the default test message.' : describeSms(analyzeSms(message))}
            </p>
          </div>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={send.isPending || !settings.ready}>
              {send.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />}
              Send test SMS
            </Button>
          </div>
          {result && <TestResult result={result} />}
        </form>
      </CardContent>
    </Card>
  )
}

function TestResult({ result }: { result: SmsTestResult }) {
  return (
    <section aria-label="Test result" className="flex flex-col gap-2 rounded-md border p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        {result.status === 'sent' ? <Badge variant="success">Sent</Badge> : <Badge variant="destructive">Failed</Badge>}
        <span className="text-muted-foreground">
          {result.segments} SMS · {result.encoding === 'gsm' ? 'GSM' : 'Unicode'}
        </span>
      </div>
      {result.error && <p className="text-destructive">{result.error}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Provider status</dt>
        <dd className="font-mono">{result.provider_status ?? '—'}</dd>
        <dt className="text-muted-foreground">Provider response</dt>
        <dd className="font-mono text-xs break-all whitespace-pre-wrap">{result.provider_response || '—'}</dd>
      </dl>
    </section>
  )
}
