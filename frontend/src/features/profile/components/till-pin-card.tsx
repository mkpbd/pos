import { useState, type FormEvent } from 'react'
import { KeyRoundIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCurrentUserQuery } from '@/features/auth/api'
import { hasPin, PIN_MAX, pinError, useRemovePinMutation, useSetPinMutation } from '@/features/profile/pin'
import { ApiError } from '@/lib/api/client'

type Errors = { current_password?: string; pin?: string; pin_confirmation?: string; form?: string }

const DIALOG_CLASS = 'max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md'

const PIN_INPUT_PROPS = {
  type: 'password',
  inputMode: 'numeric',
  autoComplete: 'off',
  maxLength: PIN_MAX,
  className: 'font-mono tracking-widest',
} as const

/** Wrong password, PIN rules or anything else, onto the dialog's fields. */
function toErrors(error: unknown): Errors {
  if (error instanceof ApiError && error.code === 'INVALID_PASSWORD') return { current_password: error.message }
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
    const fields = error.fieldErrors
    const mapped = { current_password: fields.current_password?.[0], pin: fields.pin?.[0] }
    return mapped.current_password || mapped.pin ? mapped : { form: error.message }
  }
  return { form: error instanceof Error ? error.message : 'Something went wrong.' }
}

function FormAlert({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</p>
  ) : null
}

function SetPinDialog({ change, onClose }: { change: boolean; onClose: () => void }) {
  const save = useSetPinMutation()
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, PIN_MAX)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next: Errors = {
      current_password: password ? undefined : 'Enter your password.',
      pin: pinError(pin) ?? undefined,
      pin_confirmation: !pinError(pin) && confirm !== pin ? 'The PINs do not match.' : undefined,
    }
    setErrors(next)
    if (next.current_password || next.pin || next.pin_confirmation) return
    save.mutate(
      { current_password: password, pin },
      {
        onSuccess: () => {
          toast.success(change ? 'Till PIN changed.' : 'Till PIN set.')
          onClose()
        },
        onError: (e) => setErrors(toErrors(e)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{change ? 'Change till PIN' : 'Set a till PIN'}</DialogTitle>
          <DialogDescription>4 to 6 digits. Avoid easy ones like 1111 or 1234, and don’t share it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormAlert message={errors.form} />
          <FormField label="Current password" error={errors.current_password}>
            <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <FormField label="New PIN" error={errors.pin}>
            <Input {...PIN_INPUT_PROPS} value={pin} onChange={(e) => setPin(digitsOnly(e.target.value))} />
          </FormField>
          <FormField label="Confirm new PIN" error={errors.pin_confirmation}>
            <Input {...PIN_INPUT_PROPS} value={confirm} onChange={(e) => setConfirm(digitsOnly(e.target.value))} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {change ? 'Change PIN' : 'Set PIN'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemovePinDialog({ onClose }: { onClose: () => void }) {
  const remove = useRemovePinMutation()
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!password) {
      setErrors({ current_password: 'Enter your password.' })
      return
    }
    setErrors({})
    remove.mutate(
      { current_password: password },
      {
        onSuccess: () => {
          toast.success('Till PIN removed.')
          onClose()
        },
        onError: (e) => setErrors(toErrors(e)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>Remove your till PIN?</DialogTitle>
          <DialogDescription>You won’t be listed on the till sign-in screen and can’t approve price changes or discounts with a PIN.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormAlert message={errors.form} />
          <FormField label="Current password" error={errors.current_password}>
            <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={remove.isPending}>
              {remove.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Remove PIN
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Profile → "Till PIN" (POS1a): set, change or remove the PIN used at till devices. */
export function TillPinCard() {
  const { data: me } = useCurrentUserQuery()
  const [open, setOpen] = useState<'set' | 'remove' | null>(null)
  const pinSet = hasPin(me)
  const twoFactor = me?.two_factor?.enabled === true || me?.two_factor?.required === true
  const close = () => setOpen(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Till PIN
          {pinSet ? <Badge variant="success">Set</Badge> : <Badge variant="outline">Not set</Badge>}
        </CardTitle>
        <CardDescription>A short number to sign in on a till device, unlock the till screen and approve price changes or discounts.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {twoFactor && (
          <p className="text-sm text-muted-foreground">Two-factor sign-in is on for your account, so the till asks for your password and code to sign in.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant={pinSet ? 'outline' : 'default'} onClick={() => setOpen('set')}>
            <KeyRoundIcon data-icon="inline-start" /> {pinSet ? 'Change PIN' : 'Set PIN'}
          </Button>
          {pinSet && (
            <Button variant="outline" onClick={() => setOpen('remove')}>
              <Trash2Icon data-icon="inline-start" /> Remove PIN
            </Button>
          )}
        </div>
      </CardContent>
      {open === 'set' && <SetPinDialog change={pinSet} onClose={close} />}
      {open === 'remove' && <RemovePinDialog onClose={close} />}
    </Card>
  )
}
