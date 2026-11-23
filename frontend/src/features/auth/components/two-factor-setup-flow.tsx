import { useState, type FormEvent } from 'react'
import { CopyIcon, Loader2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecoveryCodesPanel } from '@/features/auth/components/recovery-codes-panel'
import { TwoFactorQr } from '@/features/auth/components/two-factor-qr'
import { CODE_INPUT_PROPS, groupKey, isSixDigitCode, sanitizeCode, serverMessage } from '@/features/auth/two-factor'
import { useConfirmTwoFactorMutation, useStartTwoFactorSetupMutation } from '@/features/auth/two-factor-api'
import { copyText } from '@/features/marketing/clipboard'
import { ApiError } from '@/lib/api/client'

type Stage = { name: 'password' } | { name: 'scan'; secret: string; uri: string } | { name: 'codes'; codes: string[] }

/**
 * Turning two-factor sign-in on: password → scan the QR code (or type the key) → confirm a code →
 * recovery codes, shown once. Used on the profile page and on the setup-required screen.
 */
export function TwoFactorSetupFlow({ onCancel, onDone, doneLabel }: { onCancel?: () => void; onDone: () => void; doneLabel: string }) {
  const [stage, setStage] = useState<Stage>({ name: 'password' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [passwordError, setPasswordError] = useState<string>()
  const [codeError, setCodeError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const start = useStartTwoFactorSetupMutation()
  const confirm = useConfirmTwoFactorMutation()

  const submitPassword = (event: FormEvent) => {
    event.preventDefault()
    setFormError(undefined)
    if (!password) {
      setPasswordError('Enter your password.')
      return
    }
    setPasswordError(undefined)
    start.mutate(
      { password },
      {
        onSuccess: ({ secret, otpauth_uri }) => {
          setPassword('')
          setCode('')
          setStage({ name: 'scan', secret, uri: otpauth_uri })
        },
        onError: (error) => {
          if (error instanceof ApiError && (error.code === 'INVALID_PASSWORD' || error.code === 'VALIDATION_FAILED')) setPasswordError(serverMessage(error, 'password'))
          else setFormError(serverMessage(error))
        },
      },
    )
  }

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    if (!isSixDigitCode(code)) {
      setCodeError('Enter the 6-digit code from your app.')
      return
    }
    setCodeError(undefined)
    confirm.mutate(
      { code },
      {
        onSuccess: ({ recovery_codes }) => setStage({ name: 'codes', codes: recovery_codes }),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'TWO_FACTOR_NOT_STARTED') {
            // The unconfirmed key is gone (e.g. replaced from another tab): start again.
            setStage({ name: 'password' })
            setFormError(error.message)
            return
          }
          setCode('')
          setCodeError(serverMessage(error, 'code'))
        },
      },
    )
  }

  if (stage.name === 'codes') return <RecoveryCodesPanel codes={stage.codes} doneLabel={doneLabel} onDone={onDone} />

  if (stage.name === 'scan') {
    return (
      <form onSubmit={submitCode} noValidate className="flex flex-col gap-4">
        <p className="text-sm">
          <span className="font-medium">1. Scan this QR code</span> with an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.
        </p>
        <TwoFactorQr uri={stage.uri} className="mx-auto w-full max-w-52 rounded-md border" />
        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium" id="two-factor-key-label">Can’t scan? Enter this key</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code aria-labelledby="two-factor-key-label" className="font-mono text-sm break-all">{groupKey(stage.secret)}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyText(stage.secret, 'Key copied.')}>
              <CopyIcon data-icon="inline-start" /> Copy key
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Choose “time-based” if your app asks.</p>
        </div>
        <FormField label="2. Enter the 6-digit code from the app" error={codeError}>
          <Input {...CODE_INPUT_PROPS} autoFocus value={code} onChange={(e) => setCode(sanitizeCode(e.target.value))} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={confirm.isPending}>
            {confirm.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Turn on two-factor
          </Button>
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submitPassword} noValidate className="flex flex-col gap-4">
      {formError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p>
      )}
      <p className="text-sm text-muted-foreground">
        After your password, signing in will also ask for a 6-digit code from an authenticator app on your phone. Confirm your password to start.
      </p>
      <FormField label="Password" error={passwordError}>
        <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={start.isPending}>
          {start.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Continue
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}
