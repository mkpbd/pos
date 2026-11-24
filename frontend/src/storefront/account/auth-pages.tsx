import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { MailCheckIcon, SmartphoneIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { applyServerErrors, storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { sendAccountCode, useForgotPasswordMutation, useLoginMutation, usePhoneLoginMutation, usePhoneRegisterMutation, useRegisterMutation, useResetPasswordMutation } from './api'
import { AuthCard, FormAlert, SubmitButton, TextField, secondaryButtonClass } from './form-controls'
import { CodeInput } from './phone-code'
import { CODE_PATTERN, clock, otpErrorMessage, retryAfter, useCountdown } from './otp'
import { safeNextPath } from './safe-next'
import {
  bdPhoneFrom,
  forgotSchema,
  loginSchema,
  normalizeBdPhone,
  phoneLoginSchema,
  phoneProfileSchema,
  registerSchema,
  resetSchema,
  type ForgotValues,
  type LoginValues,
  type PhoneLoginValues,
  type PhoneProfileValues,
  type RegisterValues,
  type ResetValues,
} from './schemas'

/** Keeps `?next=` when moving between the sign-in and registration pages. */
function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path
}

const linkClass = 'font-semibold text-sf-link underline-offset-4 hover:underline'

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
  // BD1a: with an SMS gateway ready, the mobile number (a code, no password) is the first way in.
  const phoneLogin = useStorefront().account?.phone_login === true
  const [method, setMethod] = useState<LoginMethod>('phone')
  const tabsId = useId()

  return (
    <AuthCard
      title={t('account.login.title')}
      intro={t('account.login.intro')}
      footer={
        <div className="flex flex-col gap-2">
          <p>
            {rich(t('account.login.newHere'), {
              link: (
                <Link to={withNext('/account/register', next)} className={linkClass}>
                  {t('account.login.createAccount')}
                </Link>
              ),
            })}
          </p>
          <p>
            <Link to="/track-order" className={linkClass}>
              {t('account.login.trackOrder')}
            </Link>
          </p>
        </div>
      }
    >
      {phoneLogin ? (
        <>
          <MethodTabs id={tabsId} method={method} onChange={setMethod} />
          <div role="tabpanel" id={`${tabsId}-${method}-panel`} aria-labelledby={`${tabsId}-${method}-tab`} className="mt-5">
            {method === 'phone' ? <PhoneLoginFlow /> : <EmailLoginForm />}
          </div>
        </>
      ) : (
        <EmailLoginForm />
      )}
    </AuthCard>
  )
}

type LoginMethod = 'phone' | 'email'
const METHODS: readonly LoginMethod[] = ['phone', 'email']

/** "Mobile number" | "E-mail & password" (arrow keys move between them). */
function MethodTabs({ id, method, onChange }: { id: string; method: LoginMethod; onChange: (method: LoginMethod) => void }) {
  const { t } = useLocale()
  const refs = useRef<Partial<Record<LoginMethod, HTMLButtonElement | null>>>({})
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const target: LoginMethod = event.key === 'Home' ? 'phone' : event.key === 'End' ? 'email' : method === 'phone' ? 'email' : 'phone'
    onChange(target)
    refs.current[target]?.focus()
  }
  return (
    <div role="tablist" aria-label={t('account.login.methodLabel')} className="grid grid-cols-2 gap-1 rounded-sf-button bg-sf-canvas p-1" onKeyDown={onKeyDown}>
      {METHODS.map((value) => {
        const selected = value === method
        return (
          <button
            key={value}
            ref={(node) => {
              refs.current[value] = node
            }}
            type="button"
            role="tab"
            id={`${id}-${value}-tab`}
            aria-selected={selected}
            aria-controls={`${id}-${value}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(value)}
            className={cn('rounded-sf-button px-3 py-2 text-sm font-semibold transition', selected ? 'bg-sf-surface text-sf-heading shadow-sm' : 'text-sf-text hover:text-sf-heading')}
          >
            {t(value === 'phone' ? 'account.login.tabPhone' : 'account.login.tabEmail')}
          </button>
        )
      })}
    </div>
  )
}

/** E-mail and password, as before BD1a. */
function EmailLoginForm() {
  const { t } = useLocale()
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
  )
}

type PhoneStep = { kind: 'phone' } | { kind: 'code'; phone: string; remember: boolean } | { kind: 'profile'; phone: string }

/**
 * BD1a sign-in with a code: mobile number → "Send code" → the 6-digit code (with the resend
 * countdown) → signed in; a number without an account asks for a name (and an optional e-mail)
 * and creates the account. The guard of this page then moves on to `?next=` or the account.
 */
function PhoneLoginFlow() {
  const { t } = useLocale()
  const [step, setStep] = useState<PhoneStep>({ kind: 'phone' })
  const [notice, setNotice] = useState<string | null>(null)
  const countdown = useCountdown()
  const sendCode = useMutation({ mutationFn: (phone: string) => sendAccountCode(phone, 'login') })

  const request = (phone: string, remember: boolean, onFail?: (message: string) => void) => {
    setNotice(null)
    sendCode.mutate(phone, {
      onSuccess: (sent) => {
        countdown.start(Number(sent?.resend_after) || 60)
        setStep({ kind: 'code', phone, remember })
      },
      onError: (error) => {
        const wait = retryAfter(error)
        const message = otpErrorMessage(error, t)
        if (wait !== null) {
          // A code was sent a moment ago: it can be typed while the countdown runs.
          countdown.start(wait)
          setStep({ kind: 'code', phone, remember })
          setNotice(message)
        } else if (onFail) onFail(message)
        else setNotice(message)
      },
    })
  }

  if (step.kind === 'code') {
    return (
      <PhoneCodeStep
        phone={step.phone}
        remember={step.remember}
        notice={notice}
        remaining={countdown.remaining}
        resending={sendCode.isPending}
        onResend={() => request(step.phone, step.remember)}
        onChangeNumber={() => {
          setNotice(null)
          setStep({ kind: 'phone' })
        }}
        onNeedsProfile={(phone) => {
          setNotice(null)
          setStep({ kind: 'profile', phone })
        }}
      />
    )
  }
  if (step.kind === 'profile') {
    return (
      <PhoneProfileStep
        phone={step.phone}
        onSessionExpired={(message) => {
          setNotice(message)
          setStep({ kind: 'phone' })
        }}
      />
    )
  }
  return <PhoneNumberStep notice={notice} pending={sendCode.isPending} onSubmit={request} />
}

function PhoneNumberStep({ notice, pending, onSubmit }: { notice: string | null; pending: boolean; onSubmit: (phone: string, remember: boolean, onFail: (message: string) => void) => void }) {
  const { t } = useLocale()
  const form = useForm<PhoneLoginValues>({ resolver: zodResolver(phoneLoginSchema), defaultValues: { phone: '', remember: false } })

  const submit = form.handleSubmit((values) => {
    onSubmit(bdPhoneFrom(values.phone), values.remember, (message) => form.setError('phone', { type: 'server', message }, { shouldFocus: true }))
  })

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={t('account.login.tabPhone')}>
      <FormAlert message={notice} />
      <p className="text-sm">{t('account.login.phoneIntro')}</p>
      <TextField
        label={t('account.field.mobile')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        placeholder="01XXXXXXXXX"
        error={form.formState.errors.phone?.message}
        {...form.register('phone')}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-sf-accent" {...form.register('remember')} />
        {t('account.login.keepSignedIn')}
      </label>
      <SubmitButton pending={pending} pendingLabel={t('account.sending')}>{t('account.login.sendCode')}</SubmitButton>
    </form>
  )
}

type PhoneCodeStepProps = {
  phone: string
  remember: boolean
  notice: string | null
  remaining: number
  resending: boolean
  onResend: () => void
  onChangeNumber: () => void
  onNeedsProfile: (phone: string) => void
}

function PhoneCodeStep({ phone, remember, notice, remaining, resending, onResend, onChangeNumber, onNeedsProfile }: PhoneCodeStepProps) {
  const { t } = useLocale()
  const uid = useId()
  const login = usePhoneLoginMutation()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!CODE_PATTERN.test(code)) {
      setError(t('account.validation.codeRequired'))
      return
    }
    setError(null)
    login.mutate(
      { phone, code, remember },
      {
        onSuccess: (result) => {
          if (result.status === 'needs_profile') onNeedsProfile(result.phone || phone)
        },
        onError: (failure) => {
          // A disabled account answers like a wrong password does.
          setError(failure instanceof ApiError && failure.code === 'INVALID_CREDENTIALS' ? t('account.login.phoneRefused') : otpErrorMessage(failure, t))
          setCode('')
        },
      },
    )
  }

  const message = error ?? notice
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={t('account.login.tabPhone')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p role="status">{t('account.login.codeSentTo', { phone })}</p>
        <button type="button" className={linkClass} onClick={onChangeNumber}>
          {t('account.login.changeNumber')}
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-code`} className="text-sm font-medium text-sf-heading">
          {t('account.otp.codeLabel')}
        </label>
        <CodeInput id={`${uid}-code`} value={code} onChange={setCode} invalid={Boolean(error)} describedBy={message ? `${uid}-message` : undefined} className="max-w-none" autoFocus />
        {message && (
          <p id={`${uid}-message`} role="alert" className="text-sm font-medium text-sf-sale">
            {message}
          </p>
        )}
      </div>
      <SubmitButton pending={login.isPending} pendingLabel={t('account.login.pending')}>{t('account.login.submit')}</SubmitButton>
      <div className="text-center text-sm">
        {remaining > 0 ? (
          <p data-testid="otp-countdown">{t('account.otp.resendIn', { time: clock(remaining) })}</p>
        ) : (
          <button type="button" className={linkClass} disabled={resending} onClick={onResend}>
            {resending ? t('account.sending') : t('account.otp.resend')}
          </button>
        )}
      </div>
    </form>
  )
}

function PhoneProfileStep({ phone, onSessionExpired }: { phone: string; onSessionExpired: (message: string) => void }) {
  const { t } = useLocale()
  const register = usePhoneRegisterMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<PhoneProfileValues>({ resolver: zodResolver(phoneProfileSchema), defaultValues: { name: '', email: '' } })
  const { errors } = form.formState

  const submit = form.handleSubmit((values) => {
    setFormError(null)
    const email = values.email.trim()
    register.mutate(
      { name: values.name.trim(), ...(email ? { email } : {}) },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'OTP_SESSION_EXPIRED') return onSessionExpired(otpErrorMessage(error, t))
          if (!applyServerErrors(error, form.setError, ['name', 'email'])) setFormError(otpErrorMessage(error, t))
        },
      },
    )
  })

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-labelledby="phone-profile-heading">
      <div>
        <h2 id="phone-profile-heading" className="text-xl font-bold">
          {t('account.phoneProfile.title')}
        </h2>
        <p className="mt-1 text-sm">{t('account.phoneProfile.intro', { phone })}</p>
      </div>
      <FormAlert message={formError} />
      <TextField label={t('account.field.fullName')} autoComplete="name" maxLength={120} error={errors.name?.message} {...form.register('name')} />
      <TextField label={t('account.field.emailOptional')} type="email" autoComplete="email" maxLength={254} hint={t('account.phoneProfile.emailHint')} error={errors.email?.message} {...form.register('email')} />
      <SubmitButton pending={register.isPending} pendingLabel={t('account.phoneProfile.pending')}>{t('account.phoneProfile.submit')}</SubmitButton>
    </form>
  )
}

export function RegisterPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.register.title')))
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const phoneLogin = useStorefront().account?.phone_login === true
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
      {phoneLogin && (
        <Link to={withNext('/account/login', next)} className={cn(secondaryButtonClass, 'mb-5 w-full')} data-testid="register-with-phone">
          <SmartphoneIcon aria-hidden className="size-4" />
          {t('account.register.withPhone')}
        </Link>
      )}
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
