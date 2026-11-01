import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheckIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { applyServerErrors, storeFormError } from '../form-errors'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { FORGOT_PASSWORD_SENT, useForgotPasswordMutation, useLoginMutation, useRegisterMutation, useResetPasswordMutation } from './api'
import { AuthCard, FormAlert, SubmitButton, TextField } from './form-controls'
import { safeNextPath } from './safe-next'
import { forgotSchema, loginSchema, normalizeBdPhone, registerSchema, resetSchema, type ForgotValues, type LoginValues, type RegisterValues, type ResetValues } from './schemas'

/** Keeps `?next=` when moving between the sign-in and registration pages. */
function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path
}

const linkClass = 'font-semibold text-sf-accent underline-offset-4 hover:underline'

/**
 * Sign-in. On success the guard of this page moves on to `?next=` (same-origin paths only) or
 * the account; the guest cart and wishlist are merged into the account on the way.
 */
export function LoginPage() {
  useDocumentMeta(privatePage('Sign in'))
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const login = useLoginMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '', remember: false } })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    login.mutate(values, {
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['email', 'password'])) setFormError(storeFormError(error))
        form.setValue('password', '')
      },
    })
  })

  return (
    <AuthCard
      title="Sign in"
      intro="Welcome back! Sign in to see your account, cart and wishlist."
      footer={
        <p>
          New here? <Link to={withNext('/account/register', next)} className={linkClass}>Create an account</Link>
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Sign in">
        <FormAlert message={formError} />
        <TextField label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...form.register('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...form.register('password')} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-sf-accent" {...form.register('remember')} />
            Keep me signed in
          </label>
          <Link to="/account/forgot-password" className={linkClass}>Forgot your password?</Link>
        </div>
        <SubmitButton pending={login.isPending} pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>
    </AuthCard>
  )
}

export function RegisterPage() {
  useDocumentMeta(privatePage('Create an account'))
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const register = useRegisterMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', phone: '', password: '', password_confirmation: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    const phone = values.phone.trim()
    register.mutate(
      { name: values.name.trim(), email: values.email.trim(), password: values.password, password_confirmation: values.password_confirmation, ...(phone ? { phone: normalizeBdPhone(phone) } : {}) },
      {
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, ['name', 'email', 'phone', 'password', 'password_confirmation'])) setFormError(storeFormError(error))
        },
      },
    )
  })

  return (
    <AuthCard
      title="Create an account"
      intro="Save your addresses and wishlist, and keep your cart on every device."
      footer={
        <p>
          Already have an account? <Link to={withNext('/account/login', next)} className={linkClass}>Sign in</Link>
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Create an account">
        <FormAlert message={formError} />
        <TextField label="Full name" autoComplete="name" maxLength={120} error={errors.name?.message} {...form.register('name')} />
        <TextField label="E-mail" type="email" autoComplete="email" maxLength={254} error={errors.email?.message} {...form.register('email')} />
        <TextField label="Mobile number (optional)" type="tel" autoComplete="tel" maxLength={20} placeholder="01XXXXXXXXX" error={errors.phone?.message} {...form.register('phone')} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 8 characters." error={errors.password?.message} {...form.register('password')} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" error={errors.password_confirmation?.message} {...form.register('password_confirmation')} />
        <SubmitButton pending={register.isPending} pendingLabel="Creating your account…">Create account</SubmitButton>
      </form>
    </AuthCard>
  )
}

export function ForgotPasswordPage() {
  useDocumentMeta(privatePage('Forgot your password?'))
  const forgot = useForgotPasswordMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } })

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    forgot.mutate(values.email.trim(), {
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['email'])) setFormError(storeFormError(error))
      },
    })
  })

  return (
    <AuthCard
      title="Forgot your password?"
      intro="Enter the e-mail address of your account and we will send you a link to choose a new password."
      footer={<Link to="/account/login" className={linkClass}>Back to sign in</Link>}
    >
      {forgot.isSuccess ? (
        <div role="status" className="flex flex-col items-center gap-3 text-center">
          <MailCheckIcon aria-hidden className="size-10 text-sf-highlight" />
          <p>{FORGOT_PASSWORD_SENT}</p>
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Reset password request">
          <FormAlert message={formError} />
          <TextField label="E-mail" type="email" autoComplete="email" error={form.formState.errors.email?.message} {...form.register('email')} />
          <SubmitButton pending={forgot.isPending} pendingLabel="Sending…">Send reset link</SubmitButton>
        </form>
      )}
    </AuthCard>
  )
}

/** Target of the reset e-mail (`?token&email`). A successful reset signs the customer in. */
export function ResetPasswordPage() {
  useDocumentMeta(privatePage('Choose a new password'))
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const reset = useResetPasswordMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema), defaultValues: { email: params.get('email') ?? '', password: '', password_confirmation: '' } })
  const { errors } = form.formState

  if (!token) {
    return (
      <AuthCard title="Choose a new password" footer={<Link to="/account/forgot-password" className={linkClass}>Request a new link</Link>}>
        <p className="text-center">This link is incomplete. Please use the link from the e-mail, or request a new one.</p>
      </AuthCard>
    )
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    reset.mutate(
      { email: values.email.trim(), token, password: values.password, password_confirmation: values.password_confirmation },
      {
        onError: (error) => {
          // An invalid or expired token comes back as a field error on email/token.
          if (!applyServerErrors(error, form.setError, ['email', 'password', 'password_confirmation'])) setFormError(storeFormError(error))
          const tokenError = error instanceof ApiError ? error.fieldErrors.token?.[0] : undefined
          if (tokenError) setFormError(tokenError)
        },
      },
    )
  })

  return (
    <AuthCard title="Choose a new password" footer={<Link to="/account/forgot-password" className={linkClass}>Request a new link</Link>}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Choose a new password">
        <FormAlert message={formError} />
        <TextField label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...form.register('email')} />
        <TextField label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." error={errors.password?.message} {...form.register('password')} />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" error={errors.password_confirmation?.message} {...form.register('password_confirmation')} />
        <SubmitButton pending={reset.isPending} pendingLabel="Saving…">Save password and sign in</SubmitButton>
      </form>
    </AuthCard>
  )
}
