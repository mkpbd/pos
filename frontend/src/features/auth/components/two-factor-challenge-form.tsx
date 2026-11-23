import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTwoFactorChallengeMutation, type TwoFactorChallengeInput } from '@/features/auth/api'
import { CODE_INPUT_PROPS, isSixDigitCode, sanitizeCode, serverMessage } from '@/features/auth/two-factor'
import { ApiError } from '@/lib/api/client'

type Mode = 'totp' | 'recovery'

/**
 * Second sign-in step (G1a): the 6-digit authenticator code — submitted as soon as six digits are
 * typed — or a recovery code. An expired challenge goes back to the password step.
 */
export function TwoFactorChallengeForm({ onSignedIn, onExpired, onBack }: { onSignedIn: () => void; onExpired: (message: string) => void; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('totp')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const challenge = useTwoFactorChallengeMutation()

  const send = (input: TwoFactorChallengeInput) => {
    setFormError(undefined)
    setFieldError(undefined)
    challenge.mutate(input, {
      onSuccess: onSignedIn,
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'TWO_FACTOR_CHALLENGE_EXPIRED') {
          onExpired(error.message)
          return
        }
        if (error instanceof ApiError && (error.code === 'INVALID_TWO_FACTOR_CODE' || error.code === 'VALIDATION_FAILED')) {
          setFieldError(serverMessage(error, mode === 'totp' ? 'code' : 'recovery_code'))
        } else {
          // ACCOUNT_LOCKED and anything unexpected.
          setFormError(serverMessage(error))
        }
        setCode('')
      },
    })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (challenge.isPending) return
    if (mode === 'totp') {
      if (!isSixDigitCode(code)) setFieldError('Enter the 6-digit code from your app.')
      else send({ code })
      return
    }
    const value = recoveryCode.trim().toLowerCase()
    if (!value) setFieldError('Enter one of your recovery codes.')
    else send({ recovery_code: value })
  }

  const onCodeChange = (value: string) => {
    const next = sanitizeCode(value)
    setCode(next)
    // Auto-submit the moment the sixth digit arrives (typed or pasted).
    if (next.length === 6 && code.length !== 6 && !challenge.isPending) send({ code: next })
  }

  const switchMode = () => {
    setMode(mode === 'totp' ? 'recovery' : 'totp')
    setFieldError(undefined)
    setFormError(undefined)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p>
      )}
      {mode === 'totp' ? (
        <FormField label="Authentication code" error={fieldError} hint="Open your authenticator app and enter the 6-digit code it shows.">
          <Input key="totp" {...CODE_INPUT_PROPS} autoFocus value={code} onChange={(e) => onCodeChange(e.target.value)} />
        </FormField>
      ) : (
        <FormField label="Recovery code" error={fieldError} hint="One of the codes you saved when you turned two-factor on. Each works once.">
          <Input key="recovery" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" className="font-mono" autoFocus value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
        </FormField>
      )}
      <Button type="submit" disabled={challenge.isPending}>
        {challenge.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
        Verify
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button type="button" variant="link" className="h-auto p-0" onClick={switchMode}>
          {mode === 'totp' ? 'Use a recovery code instead' : 'Use your authenticator app instead'}
        </Button>
        <Button type="button" variant="link" className="h-auto p-0" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    </form>
  )
}
