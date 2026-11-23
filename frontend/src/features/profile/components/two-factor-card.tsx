import { useState, type FormEvent } from 'react'
import { KeyRoundIcon, Loader2Icon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RecoveryCodesPanel } from '@/features/auth/components/recovery-codes-panel'
import { TwoFactorSetupFlow } from '@/features/auth/components/two-factor-setup-flow'
import { serverMessage } from '@/features/auth/two-factor'
import {
  useDisableTwoFactorMutation,
  useRefreshTwoFactor,
  useRegenerateRecoveryCodesMutation,
  useTwoFactorStatusQuery,
} from '@/features/auth/two-factor-api'
import { ApiError } from '@/lib/api/client'

type Open = 'setup' | 'codes' | 'disable' | null

/** Setup and new recovery codes must not be dismissed by a stray click while codes are on screen. */
const STICKY = {
  onInteractOutside: (event: Event) => event.preventDefault(),
  onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
}

const DIALOG_CLASS = 'max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md'

function FormAlert({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</p>
  ) : null
}

function SetupDialog({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshTwoFactor()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CLASS} showCloseButton={false} {...STICKY}>
        <DialogHeader>
          <DialogTitle>Set up two-factor sign-in</DialogTitle>
          <DialogDescription>You’ll need your phone with an authenticator app.</DialogDescription>
        </DialogHeader>
        <TwoFactorSetupFlow
          doneLabel="Done"
          onCancel={onClose}
          onDone={() => {
            refresh()
            toast.success('Two-factor sign-in is on.')
            onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewCodesDialog({ onClose }: { onClose: () => void }) {
  const regenerate = useRegenerateRecoveryCodesMutation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const [codes, setCodes] = useState<string[] | null>(null)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(undefined)
    if (!password) {
      setError('Enter your password.')
      return
    }
    setError(undefined)
    regenerate.mutate(
      { password },
      {
        onSuccess: ({ recovery_codes }) => setCodes(recovery_codes),
        onError: (e) => {
          if (e instanceof ApiError && (e.code === 'INVALID_PASSWORD' || e.code === 'VALIDATION_FAILED')) setError(serverMessage(e, 'password'))
          else setFormError(serverMessage(e))
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CLASS} showCloseButton={codes === null} {...(codes ? STICKY : {})}>
        <DialogHeader>
          <DialogTitle>New recovery codes</DialogTitle>
          <DialogDescription>{codes ? 'Your old recovery codes no longer work.' : 'Your current recovery codes stop working as soon as new ones are made.'}</DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodesPanel codes={codes} doneLabel="Done" onDone={onClose} />
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <FormField label="Password" error={error}>
              <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={regenerate.isPending}>
                {regenerate.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Make new codes
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const disable = useDisableTwoFactorMutation()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState<{ password?: string; code?: string; form?: string }>({})

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next = { password: password ? undefined : 'Enter your password.', code: code.trim() ? undefined : 'Enter a code from your app or a recovery code.' }
    setErrors(next)
    if (next.password || next.code) return
    disable.mutate(
      { password, code: code.trim().toLowerCase() },
      {
        onSuccess: () => {
          toast.success('Two-factor sign-in is off.')
          onClose()
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'INVALID_PASSWORD') setErrors({ password: e.message })
          else if (e instanceof ApiError && e.code === 'INVALID_TWO_FACTOR_CODE') setErrors({ code: e.message })
          else if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') setErrors({ password: e.fieldErrors.password?.[0], code: e.fieldErrors.code?.[0], form: e.fieldErrors.password || e.fieldErrors.code ? undefined : e.message })
          else setErrors({ form: serverMessage(e) })
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>Turn off two-factor sign-in?</DialogTitle>
          <DialogDescription>Signing in will only need your password. Your recovery codes stop working.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormAlert message={errors.form} />
          <FormField label="Password" error={errors.password}>
            <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <FormField label="Authentication or recovery code" error={errors.code} hint="The 6-digit code from your app, or one of your recovery codes.">
            <Input autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={disable.isPending}>
              {disable.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Turn off
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Profile → "Two-factor sign-in" (G1a): status, set up, new recovery codes, turn off. */
export function TwoFactorCard() {
  const { data, error, isPending, refetch } = useTwoFactorStatusQuery()
  const [open, setOpen] = useState<Open>(null)
  const close = () => setOpen(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Two-factor sign-in
          {data && (data.enabled ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>)}
        </CardTitle>
        <CardDescription>A 6-digit code from an authenticator app on your phone, asked for after your password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending ? (
          <LoadingState rows={2} label="Loading two-factor status" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.enabled ? (
          <>
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4 shrink-0 text-success" aria-hidden />
                {data.confirmed_at ? `On since ${new Date(data.confirmed_at).toLocaleDateString()}.` : 'On.'}
              </p>
              {data.recovery_codes_left !== null && (
                <p className={data.recovery_codes_left <= 3 ? 'text-warning-soft-foreground' : 'text-muted-foreground'}>
                  {data.recovery_codes_left === 1 ? '1 recovery code left.' : `${data.recovery_codes_left} recovery codes left.`}
                  {data.recovery_codes_left <= 3 && ' Make new ones soon.'}
                </p>
              )}
              {data.required && <p className="text-muted-foreground">Your organization requires two-factor sign-in, so it can’t be turned off.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setOpen('codes')}>
                <KeyRoundIcon data-icon="inline-start" /> New recovery codes
              </Button>
              {!data.required && (
                <Button variant="outline" onClick={() => setOpen('disable')}>
                  <ShieldOffIcon data-icon="inline-start" /> Turn off
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {data.required
                ? 'Your organization requires two-factor sign-in for your account.'
                : 'Protects your account even if someone learns your password.'}
            </p>
            <Button className="self-start" onClick={() => setOpen('setup')}>
              <ShieldCheckIcon data-icon="inline-start" /> Set up
            </Button>
          </>
        )}
      </CardContent>
      {open === 'setup' && <SetupDialog onClose={close} />}
      {open === 'codes' && <NewCodesDialog onClose={close} />}
      {open === 'disable' && <DisableDialog onClose={close} />}
    </Card>
  )
}
