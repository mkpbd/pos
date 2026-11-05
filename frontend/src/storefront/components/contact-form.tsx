import { useId, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useContactMutation } from '../api'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'

type Fields = { name: string; email: string; phone: string; subject: string; message: string; website: string }
const EMPTY: Fields = { name: '', email: '', phone: '', subject: '', message: '', website: '' }

const inputClass = 'w-full rounded-lg border border-sf-border bg-sf-surface px-4 py-2.5 text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent aria-[invalid=true]:border-sf-sale'

/** The contact form; messages land in the admin under Content → Messages. */
export function ContactForm() {
  const id = useId()
  const { t } = useLocale()
  const send = useContactMutation()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({})
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }))

  if (send.isSuccess) {
    return (
      <div role="status" className="rounded-sf-card bg-sf-surface p-6">
        <p className="font-semibold text-sf-heading">{send.data.message}</p>
        <button type="button" className="mt-3 text-sm underline" onClick={() => send.reset()}>{t('shell.contact.sendAnother')}</button>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: typeof errors = {}
    if (!fields.name.trim()) local.name = t('shell.contact.nameRequired')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) local.email = t('shell.contact.emailInvalid')
    if (fields.message.trim().length < 10) local.message = t('shell.contact.messageTooShort', { min: 10 })
    setErrors(local)
    if (Object.keys(local).length > 0) return

    send.mutate(
      {
        name: fields.name.trim(),
        email: fields.email.trim(),
        message: fields.message.trim(),
        ...(fields.phone.trim() ? { phone: fields.phone.trim() } : {}),
        ...(fields.subject.trim() ? { subject: fields.subject.trim() } : {}),
        ...(fields.website ? { website: fields.website } : {}),
      },
      {
        onSuccess: () => setFields(EMPTY),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            setErrors(Object.fromEntries(Object.entries(error.fieldErrors).map(([k, v]) => [k, v[0]])) as typeof errors)
          }
        },
      },
    )
  }

  const field = (name: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${name}`} className="text-sm font-medium text-sf-heading">{label}</label>
      <input
        id={`${id}-${name}`}
        value={fields[name]}
        onChange={(e) => set({ [name]: e.target.value })}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        className={inputClass}
        {...props}
      />
      {errors[name] && <p id={`${id}-${name}-error`} className="text-sm text-sf-sale">{errors[name]}</p>}
    </div>
  )

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-6" aria-label={t('shell.contact.form')}>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', t('shell.contact.name'), { autoComplete: 'name', maxLength: 120, required: true })}
        {field('email', t('shell.contact.email'), { type: 'email', autoComplete: 'email', maxLength: 254, required: true })}
        {field('phone', t('shell.contact.phone'), { type: 'tel', autoComplete: 'tel', maxLength: 20 })}
        {field('subject', t('shell.contact.subject'), { maxLength: 160 })}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-message`} className="text-sm font-medium text-sf-heading">{t('shell.contact.message')}</label>
        <textarea
          id={`${id}-message`}
          rows={5}
          maxLength={5000}
          required
          value={fields.message}
          onChange={(e) => set({ message: e.target.value })}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? `${id}-message-error` : undefined}
          className={cn(inputClass, 'resize-y')}
        />
        {errors.message && <p id={`${id}-message-error`} className="text-sm text-sf-sale">{errors.message}</p>}
      </div>
      {/* Honeypot: hidden from people and assistive technology, filled in only by bots. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>{t('shell.contact.website')}</label>
        <input id={`${id}-website`} tabIndex={-1} autoComplete="off" value={fields.website} onChange={(e) => set({ website: e.target.value })} />
      </div>
      {send.isError && <p role="alert" className="text-sm font-medium text-sf-sale">{storeFormError(send.error, t)}</p>}
      <button type="submit" disabled={send.isPending} className="self-start rounded-sf-button bg-sf-accent px-6 py-3 font-semibold text-sf-accent-foreground transition hover:brightness-110 disabled:opacity-70">
        {send.isPending ? t('shell.contact.sending') : t('shell.contact.send')}
      </button>
    </form>
  )
}
