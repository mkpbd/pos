import { useId, useState, type FormEvent } from 'react'
import { CopyIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyText } from '@/features/marketing/clipboard'
import { useSaveSocialSettingsMutation, type SocialMode, type SocialSettings, type SocialSettingsInput } from '@/features/marketing/social-api'
import { fieldErrorMap } from '@/lib/forms'

const MODES: { value: SocialMode; label: string; hint: string }[] = [
  { value: 'sandbox', label: 'Practice mode (sandbox)', hint: 'Nothing is sent to Facebook or Instagram. Use it to learn and to test.' },
  { value: 'live', label: 'Live', hint: 'Posts go to your real Facebook Page and Instagram account. Needs the app ID and secret below.' },
]

type Errors = Partial<Record<'mode' | 'meta_app_id' | 'meta_app_secret' | 'graph_version' | 'form', string>>

/**
 * Social → Meta app (social.manage): practice or live mode, the Meta app id, the write-only app
 * secret and the Graph API version. Changing the mode disconnects the account, so it asks first.
 */
export function MetaAppCard({ settings, connectedPage }: { settings: SocialSettings; connectedPage: string | null }) {
  const id = useId()
  const save = useSaveSocialSettingsMutation()
  const [mode, setMode] = useState<SocialMode>(settings.mode)
  const [appId, setAppId] = useState(settings.meta_app_id ?? '')
  const [secret, setSecret] = useState('')
  const [version, setVersion] = useState(settings.graph_version)
  const [errors, setErrors] = useState<Errors>({})
  const [confirming, setConfirming] = useState(false)

  const modeChanged = mode !== settings.mode
  const dirty = modeChanged || appId.trim() !== (settings.meta_app_id ?? '') || secret.trim() !== '' || version.trim() !== settings.graph_version

  const check = (): Errors => {
    const found: Errors = {}
    const app = appId.trim()
    if (app !== '' && !/^\d{5,20}$/.test(app)) found.meta_app_id = 'The app ID is a number, e.g. 1234567890123456.'
    if (!/^v\d{1,2}\.\d$/.test(version.trim())) found.graph_version = 'Like v21.0.'
    if (mode === 'live') {
      if (app === '') found.meta_app_id = 'Live mode needs the app ID.'
      if (secret.trim() === '' && !settings.secret_set) found.meta_app_secret = 'Live mode needs the app secret.'
    }
    return found
  }

  const send = () => {
    const input: SocialSettingsInput = {}
    if (modeChanged) input.mode = mode
    if (appId.trim() !== (settings.meta_app_id ?? '')) input.meta_app_id = appId.trim() || null
    if (secret.trim() !== '') input.meta_app_secret = secret.trim()
    if (version.trim() !== settings.graph_version) input.graph_version = version.trim()
    save.mutate(input, {
      onSuccess: (saved) => {
        setSecret('')
        setErrors({})
        toast.success(
          !modeChanged
            ? 'Meta app settings saved.'
            : saved.mode === 'live'
              ? 'Live mode is on. Connect your Facebook Page to post for real.'
              : 'Practice mode is on. Nothing is sent to Facebook or Instagram.',
        )
      },
      onError: (error) => {
        const map = fieldErrorMap(error)
        setErrors({ mode: map.mode, meta_app_id: map.meta_app_id, meta_app_secret: map.meta_app_secret, graph_version: map.graph_version, form: map.form })
      },
      onSettled: () => setConfirming(false),
    })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const found = check()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (modeChanged && connectedPage) setConfirming(true)
    else send()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Meta app</h2>
        </CardTitle>
        <CardDescription>
          Facebook and Instagram only take posts from a registered app. Until you have one, keep practice mode: everything works, nothing is posted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} aria-label="Meta app settings" className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-3" aria-describedby={errors.mode ? `${id}-mode-error` : undefined}>
            <legend className="mb-1 text-sm font-medium">Mode</legend>
            {MODES.map((m) => (
              <div key={m.value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  id={`${id}-mode-${m.value}`}
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  aria-describedby={`${id}-mode-${m.value}-hint`}
                  className="mt-0.5 size-4 accent-primary"
                />
                <div className="flex flex-col">
                  <Label htmlFor={`${id}-mode-${m.value}`}>{m.label}</Label>
                  <span id={`${id}-mode-${m.value}-hint`} className="text-sm text-muted-foreground">{m.hint}</span>
                </div>
              </div>
            ))}
            {errors.mode && <p id={`${id}-mode-error`} className="text-sm text-destructive">{errors.mode}</p>}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="App ID" error={errors.meta_app_id} hint="A long number from the app’s Basic settings.">
              <Input inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={20} value={appId} onChange={(e) => setAppId(e.target.value)} />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`${id}-secret`}>App secret</Label>
                {settings.secret_set && <Badge variant="success">Saved</Badge>}
              </div>
              <Input
                id={`${id}-secret`}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={settings.secret_set ? 'Type a new secret to replace it' : 'Paste the app secret'}
                value={secret}
                aria-invalid={errors.meta_app_secret ? true : undefined}
                aria-describedby={`${id}-secret-help`}
                onChange={(e) => setSecret(e.target.value)}
              />
              <p id={`${id}-secret-help`} className={errors.meta_app_secret ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {errors.meta_app_secret ?? 'Kept encrypted and never shown again. Leave empty to keep the saved one.'}
              </p>
            </div>
          </div>

          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Advanced: Graph API version</summary>
            <div className="mt-3 max-w-48">
              <FormField label="Graph API version" error={errors.graph_version} hint="Leave as it is unless Meta asks you to change it.">
                <Input spellCheck={false} maxLength={6} value={version} onChange={(e) => setVersion(e.target.value)} />
              </FormField>
            </div>
          </details>

          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">How do I get an app ID and secret?</summary>
            <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5">
              <li>
                Open{' '}
                <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                  Meta for Developers <ExternalLinkIcon className="size-3.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>{' '}
                and log in with the Facebook account that manages your Page.
              </li>
              <li>Choose “Create app”, pick the “Business” type and give it your shop’s name.</li>
              <li>Add “Facebook Login for Business” and “Instagram” to the app.</li>
              <li>
                In Facebook Login → Settings, add this address under “Valid OAuth Redirect URIs”:
                {settings.redirect_uri ? (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all" data-testid="social-redirect-uri">{settings.redirect_uri}</code>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void copyText(settings.redirect_uri ?? '', 'Address copied.')}>
                      <CopyIcon data-icon="inline-start" /> Copy
                    </Button>
                  </span>
                ) : null}
              </li>
              <li>In App settings → Basic, copy the App ID and the App secret into the fields above.</li>
              <li>Choose Live, save, then press “Connect Facebook”.</li>
            </ol>
            <p className="mt-2 text-muted-foreground">
              Instagram copies post photos from your store’s web address, so the store must be online at a public https:// address. While the app is in development,
              only people with a role in the app can connect.
            </p>
          </details>

          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setMode(settings.mode)
                setAppId(settings.meta_app_id ?? '')
                setSecret('')
                setVersion(settings.graph_version)
                setErrors({})
              }}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save Meta app settings
            </Button>
          </div>
        </form>
      </CardContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={mode === 'live' ? 'Switch to live mode?' : 'Switch to practice mode?'}
        description={`Changing the mode disconnects ${connectedPage ?? 'the connected Page'}. Connect ${mode === 'live' ? 'your real Facebook Page' : 'the demo Page'} afterwards; scheduled posts fail while nothing is connected.`}
        confirmLabel={mode === 'live' ? 'Switch to live' : 'Switch to practice'}
        destructive={false}
        pending={save.isPending}
        onConfirm={send}
      />
    </Card>
  )
}
