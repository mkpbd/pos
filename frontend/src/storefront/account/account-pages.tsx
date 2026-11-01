import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { HeartIcon, LogOutIcon, MapPinIcon, PackageIcon, ShoppingBagIcon, StarIcon, Undo2Icon, UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyServerErrors, storeFormError } from '../form-errors'
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

const NAV = [
  { to: '/account', label: 'Overview', end: true },
  { to: '/account/orders', label: 'Orders' },
  { to: '/account/returns', label: 'Returns' },
  { to: '/account/reviews', label: 'Reviews' },
  { to: '/account/profile', label: 'Profile' },
  { to: '/account/addresses', label: 'Addresses' },
  { to: '/wishlist', label: 'Wishlist' },
]

/** Frame of the signed-in account pages: title, section navigation and sign-out. */
export function AccountShell({ title, children }: { title: string; children: ReactNode }) {
  const logout = useLogoutMutation()

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12">
      <h1 className="text-3xl font-extrabold lg:text-4xl">{title}</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Account" className="flex flex-col gap-3">
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
                  {item.label}
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
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
          {logout.isError && <p role="alert" className="text-sm text-sf-sale">{storeFormError(logout.error)}</p>}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  )
}

/** Shown while the customer's e-mail address is not verified yet. */
function VerificationBanner({ customer }: { customer: Customer }) {
  const resend = useResendVerificationMutation()
  if (customer.email_verified) return null

  return (
    <div className="mb-6 rounded-sf-card border border-sf-primary bg-sf-primary/15 p-4 text-sm" data-testid="verification-banner">
      <p className="font-semibold text-sf-heading">Please verify your e-mail address</p>
      <p className="mt-1">We sent a link to {customer.email}. Open it to confirm that this address is yours.</p>
      {resend.isSuccess ? (
        <p role="status" className="mt-3 font-semibold text-sf-heading">A new verification e-mail is on its way.</p>
      ) : (
        <button type="button" className={`${secondaryButtonClass} mt-3`} disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? 'Sending…' : 'Resend verification e-mail'}
        </button>
      )}
      {resend.isError && <p role="alert" className="mt-2 text-sf-sale">{storeFormError(resend.error)}</p>}
    </div>
  )
}

const TILES = [
  { to: '/account/orders', label: 'Orders', text: 'Track, cancel or buy again.', icon: PackageIcon },
  { to: '/account/returns', label: 'Returns', text: 'Follow your returns and refunds.', icon: Undo2Icon },
  { to: '/account/reviews', label: 'Reviews', text: 'What you said about your purchases.', icon: StarIcon },
  { to: '/account/profile', label: 'Profile', text: 'Your name, mobile number and password.', icon: UserIcon },
  { to: '/account/addresses', label: 'Addresses', text: 'Where we deliver your orders.', icon: MapPinIcon },
  { to: '/wishlist', label: 'Wishlist', text: 'Products you saved for later.', icon: HeartIcon },
  { to: '/cart', label: 'Cart', text: 'What you are about to buy.', icon: ShoppingBagIcon },
]

export function AccountPage() {
  useDocumentMeta(privatePage('My account'))
  const customer = useCustomer()
  if (!customer) return null

  return (
    <AccountShell title="My account">
      <VerificationBanner customer={customer} />
      <p className="text-lg">
        Hello, <strong className="text-sf-heading">{customer.name}</strong>!
      </p>
      <p className="mt-1 text-sm">Signed in as {customer.email}</p>
      <RecentOrders />
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {TILES.map(({ to, label, text, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex h-full items-start gap-4 rounded-sf-card bg-sf-surface p-5 transition hover:shadow-md focus-visible:shadow-md">
              <Icon aria-hidden className="size-6 shrink-0 text-sf-accent" />
              <span>
                <span className="block font-heading text-lg font-bold text-sf-heading">{label}</span>
                <span className="text-sm">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AccountShell>
  )
}

export function ProfilePage() {
  useDocumentMeta(privatePage('Profile'))
  const profile = useProfileQuery()

  return (
    <AccountShell title="Profile">
      {profile.data ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <ProfileForm profile={profile.data} />
          <PasswordForm />
        </div>
      ) : profile.error ? (
        <div className="rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(profile.error)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void profile.refetch()}>Try again</button>
        </div>
      ) : (
        <Spinner label="Loading your profile" />
      )}
    </AccountShell>
  )
}

function ProfileForm({ profile }: { profile: Customer }) {
  const update = useUpdateProfileMutation()
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
          if (!applyServerErrors(error, form.setError, ['name', 'phone'])) setFormError(storeFormError(error))
        },
      },
    )
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-6" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="text-xl font-bold">Your details</h2>
      <FormAlert message={formError} />
      {update.isSuccess && !form.formState.isDirty && <p role="status" className="text-sm font-semibold text-sf-highlight">Your details were saved.</p>}
      <TextField label="Full name" autoComplete="name" maxLength={120} error={errors.name?.message} {...form.register('name')} />
      <TextField label="E-mail" type="email" value={profile.email} readOnly disabled hint="Contact us to change the e-mail address of your account." />
      <TextField label="Mobile number (optional)" type="tel" autoComplete="tel" maxLength={20} placeholder="01XXXXXXXXX" error={errors.phone?.message} {...form.register('phone')} />
      <SubmitButton pending={update.isPending} pendingLabel="Saving…" className="self-start">Save details</SubmitButton>
    </form>
  )
}

function PasswordForm() {
  const change = useChangePasswordMutation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { current_password: '', password: '', password_confirmation: '' } })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    change.mutate(values, {
      onSuccess: () => form.reset(),
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['current_password', 'password', 'password_confirmation'])) setFormError(storeFormError(error))
      },
    })
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-6" aria-labelledby="password-heading">
      <h2 id="password-heading" className="text-xl font-bold">Change password</h2>
      <FormAlert message={formError} />
      {change.isSuccess && <p role="status" className="text-sm font-semibold text-sf-highlight">Your password was changed.</p>}
      <TextField label="Current password" type="password" autoComplete="current-password" error={errors.current_password?.message} {...form.register('current_password')} />
      <TextField label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." error={errors.password?.message} {...form.register('password')} />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" error={errors.password_confirmation?.message} {...form.register('password_confirmation')} />
      <SubmitButton pending={change.isPending} pendingLabel="Saving…" className="self-start">Change password</SubmitButton>
    </form>
  )
}

/** Target of the verification e-mail (`?token`): verifies once on arrival. */
export function VerifyEmailPage() {
  useDocumentMeta(privatePage('Verify your e-mail address'))
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
    <Link to="/account" className={primaryButtonClass}>Go to my account</Link>
  ) : (
    <Link to="/account/login" className={primaryButtonClass}>Sign in</Link>
  )

  let body: ReactNode
  if (!token) body = <p>This link is incomplete. Please use the link from the e-mail.</p>
  else if (verify.isSuccess) body = <p role="status">Thank you — your e-mail address is verified.</p>
  else if (verify.isError) body = <p role="alert">{storeFormError(verify.error) === 'Please check the highlighted fields.' ? 'This verification link is invalid or has expired.' : storeFormError(verify.error)}</p>
  else body = <p role="status">Verifying your e-mail address…</p>

  return (
    <AuthCard title="Verify your e-mail address">
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
  if (resend.isSuccess) return <p role="status" className="text-sm">A new verification e-mail is on its way.</p>
  return (
    <>
      <button type="button" className="text-sm font-semibold text-sf-accent underline-offset-4 hover:underline" disabled={resend.isPending} onClick={() => resend.mutate()}>
        Send a new verification e-mail
      </button>
      {resend.isError && <p role="alert" className="text-sm text-sf-sale">{storeFormError(resend.error)}</p>}
    </>
  )
}
