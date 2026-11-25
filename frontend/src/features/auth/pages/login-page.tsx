import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isTwoFactorChallenge, useAuthOptionsQuery, useLoginMutation } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { TwoFactorChallengeForm } from '@/features/auth/components/two-factor-challenge-form'
import { safeRedirect } from '@/features/auth/redirect'
import { loginSchema, type LoginValues } from '@/features/auth/schemas'
import { useTillTerminalQuery } from '@/features/pos/till-api'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const login = useLoginMutation()
  // G1a: the password was accepted and the account has two-factor sign-in on.
  const [step, setStep] = useState<'password' | 'two_factor'>('password')
  // "Create an account" only when public sign-up is on (never while unknown or on error).
  const signUpOpen = useAuthOptionsQuery().data?.registration_enabled === true
  // POS1a: on a device set up as a till, cashiers sign in with a PIN (the password stays available).
  const till = useTillTerminalQuery().data ?? null
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  })
  const { errors } = form.formState
  const watchedRemember = useWatch({ control: form.control, name: 'remember' })

  const goToApp = () => navigate(safeRedirect(params.get('redirect')), { replace: true })

  const backToPassword = (message?: string) => {
    form.setValue('password', '')
    setStep('password')
    if (message) form.setError('root', { message })
  }

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (result) => {
        if (isTwoFactorChallenge(result)) {
          form.clearErrors()
          setStep('two_factor')
          return
        }
        goToApp()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 422 && error.code !== 'VALIDATION_FAILED') {
          form.setError('root', { message: error.message })
          return
        }
        handleFormError(error, form.setError, ['email', 'password'])
      },
    }),
  )

  if (step === 'two_factor') {
    return (
      <AuthLayout title="Two-factor sign-in" description="Enter the 6-digit code from your authenticator app.">
        <TwoFactorChallengeForm onSignedIn={goToApp} onExpired={backToPassword} onBack={() => backToPassword()} />
      </AuthLayout>
    )
  }

  // POS1a: sent here on the way to the POS on a till: the PIN pad instead (unless the password was asked for).
  if (till && params.get('method') !== 'password' && safeRedirect(params.get('redirect')).startsWith('/pos')) {
    return <Navigate to="/pos/sign-in" replace />
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Use your work e-mail and password."
      footer={
        signUpOpen ? (
          <span>
            New business? <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">Create an account</Link>
          </span>
        ) : undefined
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {errors.root?.message && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.root.message}
          </p>
        )}
        <FormField label="E-mail" error={errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={watchedRemember}
              onCheckedChange={(checked) => form.setValue('remember', checked === true)}
            />
            <Label htmlFor="remember" className="font-normal">Keep me signed in</Label>
          </div>
          <Link to="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={login.isPending}>
          {login.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Sign in
        </Button>
        {till && (
          <Button asChild variant="outline">
            <Link to="/pos/sign-in">Use till PIN</Link>
          </Button>
        )}
      </form>
    </AuthLayout>
  )
}
