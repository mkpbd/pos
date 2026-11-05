import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { HeartIcon, LogOutIcon, MapPinIcon, PackageIcon, ShoppingBagIcon, StarIcon, Undo2Icon, UserIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { applyServerErrors, storeFormError } from '../form-errors'
import type { MessageKey } from '../i18n/en'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import type { Customer } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { RecentOrders } from '../orders/recent-orders'
import {
  useChangePasswordMutation,
  useCustomer,
  useLogoutMutation,
  useProfileQuery,
  useResendVerificationMutation,
  useUpdateProfileMutation,
  useVerifyEmailMutation,
} from './api'
import { AuthCard, FormAlert, Spinner, SubmitButton, TextField, primaryButtonClass, secondaryButtonClass } from './form-controls'
import { normalizeBdPhone, passwordSchema, profileSchema, type PasswordValues, type ProfileValues } from './schemas'

const NAV: { to: string; label: MessageKey; end?: boolean }[] = [
  { to: '/account', label: 'account.nav.overview', end: true },
  { to: '/account/orders', label: 'common.account.orders' },
  { to: '/account/returns', label: 'common.account.returns' },
  { to: '/account/reviews', label: 'common.account.reviews' },
  { to: '/account/profile', label: 'common.account.profile' },
  { to: '/account/addresses', label: 'common.account.addresses' },
  { to: '/wishlist', label: 'common.account.wishlist' },
]

const PASSWORD_MIN = 8

/** Frame of the signed-in account pages: title, section navigation and sign-out. */
export function AccountShell({ title, children }: { title: string; children: ReactNode }) {
  const logout = useLogoutMutation()
  const { t } = useLocale()

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12">
      <h1 className="text-3xl font-extrabold lg:text-4xl">{title}</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={t('account.nav.label')} className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2 lg:flex-col">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn('block rounded-sf-button px-4 py-2 text-sm font-semibold transition', isActive ? 'bg-sf-accent text-sf-accent-foreground' : 'bg-sf-surface text-sf-heading hover:text-sf-accent')
                  }
                >
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="inline-flex items-center gap-2 self-start px-4 py-2 text-sm font-semibold text-sf-heading hover:text-sf-sale"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOutIcon aria-hidden className="size-4" />
            {logout.isPending ? t('account.nav.signingOut') : t('common.account.signOut')}
          </button>
          {logout.isError && <p role="alert" className="text-sm text-sf-sale">{storeFormError(logout.error, t)}</p>}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  )
}

/** Shown while the customer's e-mail address is not verified yet. */
function VerificationBanner({ customer }: { customer: Customer }) {
  const resend = useResendVerificationMutation()
  const { t } = useLocale()
  if (customer.email_verified) return null

  return (
    <div className="mb-6 rounded-sf-card border border-sf-primary bg-sf-primary/15 p-4 text-sm" data-testid="verification-banner">
      <p className="font-semibold text-sf-heading">{t('account.verifyBanner.title')}</p>
      <p className="mt-1">{t('account.verifyBanner.text', { email: customer.email })}</p>
      {resend.isSuccess ? (
        <p role="status" className="mt-3 font-semibold text-sf-heading">{t('account.verifyBanner.resent')}</p>
      ) : (
        <button type="button" className={`${secondaryButtonClass} mt-3`} disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? t('account.sending') : t('account.verifyBanner.resend')}
        </button>
      )}
      {resend.isError && <p role="alert" className="mt-2 text-sf-sale">{storeFormError(resend.error, t)}</p>}
    </div>
  )
}

const TILES: { to: string; label: MessageKey; text: MessageKey; icon: typeof PackageIcon }[] = [
  { to: '/account/orders', label: 'common.account.orders', text: 'account.tile.orders', icon: PackageIcon },
  { to: '/account/returns', label: 'common.account.returns', text: 'account.tile.returns', icon: Undo2Icon },
  { to: '/account/reviews', label: 'common.account.reviews', text: 'account.tile.reviews', icon: StarIcon },
  { to: '/account/profile', label: 'common.account.profile', text: 'account.tile.profile', icon: UserIcon },
  { to: '/account/addresses', label: 'common.account.addresses', text: 'account.tile.addresses', icon: MapPinIcon },
  { to: '/wishlist', label: 'common.account.wishlist', text: 'account.tile.wishlist', icon: HeartIcon },
  { to: '/cart', label: 'common.cart', text: 'account.tile.cart', icon: ShoppingBagIcon },
]

export function AccountPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.overview.title')))
  const customer = useCustomer()
  if (!customer) return null

  return (
    <AccountShell title={t('account.overview.title')}>
      <VerificationBanner customer={customer} />
      <p className="text-lg">{rich(t('account.overview.hello'), { name: <strong className="text-sf-heading">{customer.name}</strong> })}</p>
      <p className="mt-1 text-sm">{t('account.overview.signedInAs', { email: customer.email })}</p>
      <RecentOrders />
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {TILES.map(({ to, label, text, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex h-full items-start gap-4 rounded-sf-card bg-sf-surface p-5 transition hover:shadow-md focus-visible:shadow-md">
              <Icon aria-hidden className="size-6 shrink-0 text-sf-accent" />
              <span>
                <span className="block font-heading text-lg font-bold text-sf-heading">{t(label)}</span>
                <span className="text-sm">{t(text)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AccountShell>
  )
}

export function ProfilePage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.profile.title')))
  const profile = useProfileQuery()

  return (
    <AccountShell title={t('account.profile.title')}>
      {profile.data ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <ProfileForm profile={profile.data} />
          <PasswordForm />
        </div>
      ) : profile.error ? (
        <div className="rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(profile.error, t)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void profile.refetch()}>{t('common.tryAgain')}</button>
        </div>
      ) : (
        <Spinner label={t('account.profile.loading')} />
      )}
    </AccountShell>
  )
}

function ProfileForm({ profile }: { profile: Customer }) {
  const update = useUpdateProfileMutation()
  const { t } = useLocale()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { name: profile.name, phone: profile.phone ?? '' } })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    const phone = values.phone.trim()
    update.mutate(
      { name: values.name.trim(), phone: phone ? normalizeBdPhone(phone) : null },
      {
        onSuccess: (saved, input) => form.reset({ name: saved?.name ?? input.name, phone: (saved ? saved.phone : input.phone) ?? '' }),
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, ['name', 'phone'])) setFormError(storeFormError(error, t))
        },
      },
    )
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-6" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="text-xl font-bold">{t('account.profile.detailsHeading')}</h2>
      <FormAlert message={formError} />
      {update.isSuccess && !form.formState.isDirty && <p role="status" className="text-sm font-semibold text-sf-highlight">{t('account.profile.saved')}</p>}
      <TextField label={t('account.field.fullName')} autoComplete="name" maxLength={120} error={errors.name?.message} {...form.register('name')} />
      <TextField label={t('account.field.email')} type="email" value={profile.email} readOnly disabled hint={t('account.profile.emailHint')} />
      <TextField label={t('account.field.mobileOptional')} type="tel" autoComplete="tel" maxLength={20} placeholder="01XXXXXXXXX" error={errors.phone?.message} {...form.register('phone')} />
      <SubmitButton pending={update.isPending} pendingLabel={t('account.saving')} className="self-start">{t('account.profile.save')}</SubmitButton>
    </form>
  )
}

function PasswordForm() {
  const change = useChangePasswordMutation()
  const { t } = useLocale()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { current_password: '', password: '', password_confirmation: '' } })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    change.mutate(values, {
      onSuccess: () => form.reset(),
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['current_password', 'password', 'password_confirmation'])) setFormError(storeFormError(error, t))
      },
    })
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-6" aria-labelledby="password-heading">
      <h2 id="password-heading" className="text-xl font-bold">{t('account.password.heading')}</h2>
      <FormAlert message={formError} />
      {change.isSuccess && <p role="status" className="text-sm font-semibold text-sf-highlight">{t('account.password.changed')}</p>}
      <TextField label={t('account.field.currentPassword')} type="password" autoComplete="current-password" error={errors.current_password?.message} {...form.register('current_password')} />
      <TextField label={t('account.field.newPassword')} type="password" autoComplete="new-password" hint={t('account.field.passwordHint', { min: PASSWORD_MIN })} error={errors.password?.message} {...form.register('password')} />
      <TextField label={t('account.field.confirmNewPassword')} type="password" autoComplete="new-password" error={errors.password_confirmation?.message} {...form.register('password_confirmation')} />
      <SubmitButton pending={change.isPending} pendingLabel={t('account.saving')} className="self-start">{t('account.password.submit')}</SubmitButton>
    </form>
  )
}

/** Target of the verification e-mail (`?token`): verifies once on arrival. */
export function VerifyEmailPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.verify.title')))
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const customer = useCustomer()
  const verify = useVerifyEmailMutation()
  const sent = useRef(false)

  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true
      verify.mutate(token)
    }
  }, [token, verify])

  const onward = customer ? (
    <Link to="/account" className={primaryButtonClass}>{t('account.verify.goToAccount')}</Link>
  ) : (
    <Link to="/account/login" className={primaryButtonClass}>{t('common.account.signIn')}</Link>
  )

  let body: ReactNode
  if (!token) body = <p>{t('account.verify.incomplete')}</p>
  else if (verify.isSuccess) body = <p role="status">{t('account.verify.done')}</p>
  else if (verify.isError) {
    // A 422 on the token field (not a TOKEN_INVALID with its own message) is a bad link too.
    const invalidLink = verify.error instanceof ApiError && verify.error.status !== 429 && verify.error.code === 'VALIDATION_FAILED'
    body = <p role="alert">{invalidLink ? t('account.verify.invalid') : storeFormError(verify.error, t)}</p>
  } else body = <p role="status">{t('account.verify.pending')}</p>

  return (
    <AuthCard title={t('account.verify.title')}>
      <div className="flex flex-col items-center gap-5 text-center">
        {body}
        {(verify.isSuccess || verify.isError || !token) && onward}
        {(verify.isError || !token) && customer && !customer.email_verified && <ResendLink />}
      </div>
    </AuthCard>
  )
}

function ResendLink() {
  const resend = useResendVerificationMutation()
  const { t } = useLocale()
  if (resend.isSuccess) return <p role="status" className="text-sm">{t('account.verifyBanner.resent')}</p>
  return (
    <>
      <button type="button" className="text-sm font-semibold text-sf-accent underline-offset-4 hover:underline" disabled={resend.isPending} onClick={() => resend.mutate()}>
        {t('account.verify.sendNew')}
      </button>
      {resend.isError && <p role="alert" className="text-sm text-sf-sale">{storeFormError(resend.error, t)}</p>}
    </>
  )
}
