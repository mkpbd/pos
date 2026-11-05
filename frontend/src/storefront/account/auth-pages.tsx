import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheckIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { applyServerErrors, storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { useForgotPasswordMutation, useLoginMutation, useRegisterMutation, useResetPasswordMutation } from './api'
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
/** The minimum length of a new password (the schemas check it). */
const PASSWORD_MIN = 8

export function LoginPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.login.title')))
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
        if (!applyServerErrors(error, form.setError, ['email', 'password'])) setFormError(storeFormError(error, t))
        form.setValue('password', '')
      },
    })
  })

  return (
    <AuthCard
      title={t('account.login.title')}
      intro={t('account.login.intro')}
      footer={
        <p>
          {rich(t('account.login.newHere'), {
            link: (
              <Link to={withNext('/account/register', next)} className={linkClass}>
                {t('account.login.createAccount')}
              </Link>
            ),
          })}
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t('account.login.title')}>
        <FormAlert message={formError} />
        <TextField label={t('account.field.email')} type="email" autoComplete="email" error={errors.email?.message} {...form.register('email')} />
        <TextField label={t('account.field.password')} type="password" autoComplete="current-password" error={errors.password?.message} {...form.register('password')} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-sf-accent" {...form.register('remember')} />
            {t('account.login.keepSignedIn')}
          </label>
          <Link to="/account/forgot-password" className={linkClass}>{t('account.login.forgot')}</Link>
        </div>
        <SubmitButton pending={login.isPending} pendingLabel={t('account.login.pending')}>{t('account.login.submit')}</SubmitButton>
      </form>
    </AuthCard>
  )
}

export function RegisterPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.register.title')))
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
          if (!applyServerErrors(error, form.setError, ['name', 'email', 'phone', 'password', 'password_confirmation'])) setFormError(storeFormError(error, t))
        },
      },
    )
  })

  return (
    <AuthCard
      title={t('account.register.title')}
      intro={t('account.register.intro')}
      footer={
        <p>
          {rich(t('account.register.haveAccount'), {
            link: (
              <Link to={withNext('/account/login', next)} className={linkClass}>
                {t('account.register.signIn')}
              </Link>
            ),
          })}
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t('account.register.title')}>
        <FormAlert message={formError} />
        <TextField label={t('account.field.fullName')} autoComplete="name" maxLength={120} error={errors.name?.message} {...form.register('name')} />
        <TextField label={t('account.field.email')} type="email" autoComplete="email" maxLength={254} error={errors.email?.message} {...form.register('email')} />
        <TextField label={t('account.field.mobileOptional')} type="tel" autoComplete="tel" maxLength={20} placeholder="01XXXXXXXXX" error={errors.phone?.message} {...form.register('phone')} />
        <TextField label={t('account.field.password')} type="password" autoComplete="new-password" hint={t('account.field.passwordHint', { min: PASSWORD_MIN })} error={errors.password?.message} {...form.register('password')} />
        <TextField label={t('account.field.confirmPassword')} type="password" autoComplete="new-password" error={errors.password_confirmation?.message} {...form.register('password_confirmation')} />
        <SubmitButton pending={register.isPending} pendingLabel={t('account.register.pending')}>{t('account.register.submit')}</SubmitButton>
      </form>
    </AuthCard>
  )
}

export function ForgotPasswordPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.forgot.title')))
  const forgot = useForgotPasswordMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } })

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    forgot.mutate(values.email.trim(), {
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['email'])) setFormError(storeFormError(error, t))
      },
    })
  })

  return (
    <AuthCard
      title={t('account.forgot.title')}
      intro={t('account.forgot.intro')}
      footer={<Link to="/account/login" className={linkClass}>{t('account.forgot.back')}</Link>}
    >
      {forgot.isSuccess ? (
        <div role="status" className="flex flex-col items-center gap-3 text-center">
          <MailCheckIcon aria-hidden className="size-10 text-sf-highlight" />
          <p>{t('account.forgot.sent')}</p>
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t('account.forgot.formLabel')}>
          <FormAlert message={formError} />
          <TextField label={t('account.field.email')} type="email" autoComplete="email" error={form.formState.errors.email?.message} {...form.register('email')} />
          <SubmitButton pending={forgot.isPending} pendingLabel={t('account.sending')}>{t('account.forgot.submit')}</SubmitButton>
        </form>
      )}
    </AuthCard>
  )
}

/** Target of the reset e-mail (`?token&email`). A successful reset signs the customer in. */
export function ResetPasswordPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.reset.title')))
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const reset = useResetPasswordMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema), defaultValues: { email: params.get('email') ?? '', password: '', password_confirmation: '' } })
  const { errors } = form.formState

  if (!token) {
    return (
      <AuthCard title={t('account.reset.title')} footer={<Link to="/account/forgot-password" className={linkClass}>{t('account.reset.newLink')}</Link>}>
        <p className="text-center">{t('account.reset.incomplete')}</p>
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
          if (!applyServerErrors(error, form.setError, ['email', 'password', 'password_confirmation'])) setFormError(storeFormError(error, t))
          const tokenError = error instanceof ApiError ? error.fieldErrors.token?.[0] : undefined
          if (tokenError) setFormError(tokenError)
        },
      },
    )
  })

  return (
    <AuthCard title={t('account.reset.title')} footer={<Link to="/account/forgot-password" className={linkClass}>{t('account.reset.newLink')}</Link>}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t('account.reset.title')}>
        <FormAlert message={formError} />
        <TextField label={t('account.field.email')} type="email" autoComplete="email" error={errors.email?.message} {...form.register('email')} />
        <TextField label={t('account.field.newPassword')} type="password" autoComplete="new-password" hint={t('account.field.passwordHint', { min: PASSWORD_MIN })} error={errors.password?.message} {...form.register('password')} />
        <TextField label={t('account.field.confirmNewPassword')} type="password" autoComplete="new-password" error={errors.password_confirmation?.message} {...form.register('password_confirmation')} />
        <SubmitButton pending={reset.isPending} pendingLabel={t('account.saving')}>{t('account.reset.submit')}</SubmitButton>
      </form>
    </AuthCard>
  )
}
