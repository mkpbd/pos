import { useId, useState, type FormEvent } from 'react'
import { AlertTriangleIcon, Loader2Icon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { MarketingHeader } from '@/features/marketing/components/marketing-header'
import { useSaveTrackingSettingsMutation, useSendTrackingTestMutation, useTrackingSettingsQuery, type TrackingSettings, type TrackingTestResult } from '@/features/marketing/tracking-api'
import { CODE_MAX, TEST_EVENT_CODE_MAX, toTrackingDraft, trackingChanges, trackingServerErrors, validateTracking, type TrackingDraft, type TrackingErrors } from '@/features/marketing/tracking'
import { formatDateTime } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'

/** Meta → Send test event: one PageView server event with the saved test event code (Events Manager → Test events). */
function TestEventPanel({ settings, canManage, dirty }: { settings: TrackingSettings; canManage: boolean; dirty: boolean }) {
  const send = useSendTrackingTestMutation()
  const [result, setResult] = useState<TrackingTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ready = !!settings.meta_pixel_id && settings.meta_capi_token_set && !!settings.meta_test_event_code

  const run = () => {
    setResult(null)
    setError(null)
    send.mutate(undefined, {
      onSuccess: setResult,
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') setError(Object.values(e.fieldErrors)[0]?.[0] ?? e.message)
        else if (e instanceof ApiError && e.status === 429) setError('Too many test events. Wait a minute and try again.')
        else setError(e.message)
      },
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="capi-test">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={run} disabled={!canManage || !ready || send.isPending}>
          {send.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />} Send test event
        </Button>
        <span className="text-sm text-muted-foreground">
          {!ready ? 'Save the pixel ID, an access token and a test event code first.' : dirty ? 'Uses the saved settings — save your changes first.' : 'Shows up under Test events in Meta Events Manager.'}
        </span>
      </div>
      {result && (
        <p role="status" className={result.status === 'sent' ? 'text-sm text-success-soft-foreground' : 'text-sm text-destructive'} data-testid="capi-test-result">
          {result.status === 'sent' ? 'Test event sent. Check Test events in Meta Events Manager.' : `Meta refused the test event: ${result.error ?? 'unknown error'}`}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function LastSent({ settings }: { settings: TrackingSettings }) {
  const timeZone = useAuth().organization?.timezone
  if (!settings.capi_last_status) return <p className="text-sm text-muted-foreground" data-testid="capi-last">No server events sent yet.</p>
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="capi-last">
      <span className="text-muted-foreground">Last server event:</span>
      <Badge variant={settings.capi_last_status === 'sent' ? 'success' : 'destructive'}>{settings.capi_last_status === 'sent' ? 'Sent' : 'Failed'}</Badge>
      {settings.capi_last_sent_at && <span>{formatDateTime(settings.capi_last_sent_at, timeZone)}</span>}
      {settings.capi_last_status === 'failed' && settings.capi_last_error && <span className="text-destructive">{settings.capi_last_error}</span>}
    </p>
  )
}

function TrackingForm({ settings, canManage }: { settings: TrackingSettings; canManage: boolean }) {
  const id = useId()
  const save = useSaveTrackingSettingsMutation()
  const [draft, setDraft] = useState<TrackingDraft>(() => toTrackingDraft(settings))
  const [token, setToken] = useState('')
  const [errors, setErrors] = useState<TrackingErrors>({})
  const [removing, setRemoving] = useState(false)
  const set = <K extends keyof TrackingDraft>(key: K, value: TrackingDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const input = trackingChanges(draft, settings, token)
  const dirty = Object.keys(input).length > 0
  const readOnly = !canManage
  const codeReadOnly = readOnly || !settings.can_edit_code

  const onError = (error: unknown) => setErrors(trackingServerErrors(fieldErrorMap(error)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found = validateTracking(draft, settings, token)
    setErrors(found)
    if (Object.keys(found).length > 0 || !dirty) return
    save.mutate(input, {
      onSuccess: (saved) => {
        setToken('')
        setDraft(toTrackingDraft(saved))
        toast.success('Tracking settings saved.')
      },
      onError,
    })
  }

  const removeToken = () =>
    save.mutate(
      { meta_capi_token: null },
      {
        onSuccess: (saved) => {
          set('meta_capi_enabled', saved.meta_capi_enabled)
          toast.success('Access token removed.')
        },
        onError,
        onSettled: () => setRemoving(false),
      },
    )

  return (
    <>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6" aria-label="Tracking settings">
        <Card>
          <CardHeader>
            <CardTitle><h2>Meta (Facebook and Instagram) pixel</h2></CardTitle>
            <CardDescription>
              Counts visits, add-to-carts and purchases from your Facebook and Instagram ads. The Conversions API also reports each order from the server, so
              purchases are counted even when the browser blocks the pixel; both use the order number, so Meta counts each order once.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Pixel ID" error={errors.meta_pixel_id} hint="Events Manager → Data sources → your pixel → Settings.">
              <Input inputMode="numeric" spellCheck={false} autoComplete="off" className="w-full font-mono sm:w-72" maxLength={20} disabled={readOnly} value={draft.meta_pixel_id} onChange={(e) => set('meta_pixel_id', e.target.value)} />
            </FormField>
            <div className="flex items-start gap-2">
              <Switch id={`${id}-capi`} checked={draft.meta_capi_enabled} disabled={readOnly} onCheckedChange={(on) => set('meta_capi_enabled', on)} aria-describedby={`${id}-capi-hint`} />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-capi`}>Send purchases through the Conversions API</Label>
                <p id={`${id}-capi-hint`} className={errors.meta_capi_enabled ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                  {errors.meta_capi_enabled ?? 'Shop and campaign-page orders only; orders your staff enter are not reported.'}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`${id}-token`}>Conversions API access token</Label>
                {settings.meta_capi_token_set && <Badge variant="success">Saved</Badge>}
                {settings.meta_capi_token_set && canManage && (
                  <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setRemoving(true)}>Remove</Button>
                )}
              </div>
              <Input
                id={`${id}-token`}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                disabled={readOnly}
                placeholder={settings.meta_capi_token_set ? 'Saved — enter a new one to replace' : 'Paste the access token'}
                value={token}
                aria-invalid={errors.meta_capi_token ? true : undefined}
                aria-describedby={`${id}-token-help`}
                onChange={(e) => setToken(e.target.value)}
              />
              <p id={`${id}-token-help`} className={errors.meta_capi_token ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {errors.meta_capi_token ?? 'Events Manager → your pixel → Settings → Generate access token. Kept encrypted and never shown again.'}
              </p>
            </div>
            <FormField label="Test event code (optional)" error={errors.meta_test_event_code} hint="From Events Manager → Test events, e.g. TEST12345. While set, server events show there; remove it when you are done testing.">
              <Input spellCheck={false} autoComplete="off" className="w-full font-mono sm:w-56" maxLength={TEST_EVENT_CODE_MAX} disabled={readOnly} value={draft.meta_test_event_code} onChange={(e) => set('meta_test_event_code', e.target.value)} />
            </FormField>
            <TestEventPanel settings={settings} canManage={canManage} dirty={dirty} />
            <LastSent settings={settings} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle><h2>Google Analytics 4</h2></CardTitle>
              <CardDescription>Page views, product views, carts, checkouts and purchases in Google Analytics.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField label="Measurement ID" error={errors.ga4_measurement_id} hint="Admin → Data streams → your web stream.">
                <Input spellCheck={false} autoComplete="off" className="w-full font-mono sm:w-56" maxLength={22} placeholder="G-XXXXXXXXXX" disabled={readOnly} value={draft.ga4_measurement_id} onChange={(e) => set('ga4_measurement_id', e.target.value)} />
              </FormField>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle><h2>TikTok pixel</h2></CardTitle>
              <CardDescription>Visits, carts and purchases from your TikTok ads.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField label="TikTok pixel ID" error={errors.tiktok_pixel_id} hint="TikTok Ads Manager → Assets → Events → your pixel.">
                <Input spellCheck={false} autoComplete="off" className="w-full font-mono sm:w-72" maxLength={30} disabled={readOnly} value={draft.tiktok_pixel_id} onChange={(e) => set('tiktok_pixel_id', e.target.value)} />
              </FormField>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle><h2>Your own tracking code</h2></CardTitle>
            <CardDescription>For other tools (Microsoft Clarity, Hotjar, a chat widget…). Paste the snippet exactly as the tool gives it.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Pasted code runs on every page of your shop, for every visitor. Only paste code from tools you trust — wrong code can break the shop or leak your customers' data.</span>
            </p>
            {!settings.can_edit_code && (
              <p className="text-sm text-muted-foreground" data-testid="code-read-only">Only people allowed to add custom HTML to the store can change this code.</p>
            )}
            <FormField label="Code in <head>" error={errors.head_code} hint={`Added at the end of <head> on every shop page. Up to ${CODE_MAX.toLocaleString('en')} characters.`}>
              <Textarea rows={6} spellCheck={false} className="font-mono text-xs" maxLength={CODE_MAX} readOnly={codeReadOnly} value={draft.head_code} onChange={(e) => set('head_code', e.target.value)} />
            </FormField>
            <FormField label="Code before </body>" error={errors.body_code} hint="Added right before </body> on every shop page.">
              <Textarea rows={6} spellCheck={false} className="font-mono text-xs" maxLength={CODE_MAX} readOnly={codeReadOnly} value={draft.body_code} onChange={(e) => set('body_code', e.target.value)} />
            </FormField>
          </CardContent>
        </Card>

        {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        {canManage && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(toTrackingDraft(settings))
                setToken('')
                setErrors({})
              }}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save tracking settings
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the access token?"
        description="Purchases are no longer reported through the Conversions API until you save a new token. The browser pixel keeps working."
        confirmLabel="Remove token"
        pending={save.isPending}
        onConfirm={removeToken}
      />
    </>
  )
}

/** /marketing/tracking — ad pixels (Meta, GA4, TikTok), the Meta Conversions API and pasted tracking code for the shop. */
export function TrackingPage() {
  const canManage = useCan()('marketing.manage')
  const settings = useTrackingSettingsQuery()

  return (
    <div className="flex flex-col gap-6">
      <MarketingHeader />
      <p className="-mt-2 max-w-3xl text-sm text-muted-foreground">
        Measure what your ads bring in. The IDs below are public — they are added to every page of your online store (never the store builder previews).
        {!canManage && ' You can view these settings; changing them needs the permission to manage marketing.'}
      </p>
      {settings.isPending ? (
        <LoadingState rows={6} label="Loading tracking settings" />
      ) : settings.error ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <TrackingForm settings={settings.data} canManage={canManage} />
      )}
    </div>
  )
}
