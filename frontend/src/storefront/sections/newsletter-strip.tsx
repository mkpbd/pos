import { useId, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { useNewsletterMutation } from '../api'
import { MediaImage } from '../components/media-image'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import type { StoreSection } from '../types'

/** E-mail sign-up; the visitor confirms by e-mail before receiving anything (double opt-in). */
export function NewsletterStrip({ section }: { section: Extract<StoreSection, { type: 'newsletter' }> }) {
  const { config } = section
  const id = useId()
  const { t } = useLocale()
  const subscribe = useNewsletterMutation()
  const [email, setEmail] = useState('')
  const style = { backgroundColor: config.background, color: config.foreground }

  return (
    <section style={style} aria-labelledby={section.title ? `${id}-title` : undefined} aria-label={section.title ? undefined : t('content.section.newsletter')}>
      <div className="mx-auto flex max-w-sf flex-col items-center gap-8 px-4 py-12 md:flex-row">
        <div className="flex-1">
          {section.title && <h2 id={`${id}-title`} className="text-3xl font-extrabold" style={{ color: config.foreground }}>{section.title}</h2>}
          {section.subtitle && <p className="mt-1 text-lg">{section.subtitle}</p>}
          {config.text && <p className="mt-2">{config.text}</p>}

          {subscribe.isSuccess ? (
            <p role="status" className="mt-5 font-semibold">{subscribe.data.message}</p>
          ) : (
            <form
              className="mt-5 flex max-w-lg flex-col gap-3 sm:flex-row"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                if (email.trim()) subscribe.mutate(email.trim())
              }}
            >
              <label htmlFor={`${id}-email`} className="sr-only">{t('content.section.emailLabel')}</label>
              <input
                id={`${id}-email`}
                type="email"
                required
                autoComplete="email"
                placeholder={t('content.section.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={subscribe.isError ? true : undefined}
                aria-describedby={subscribe.isError ? `${id}-error` : undefined}
                className="h-12 flex-1 rounded-sf-button border-0 bg-white px-5 text-sf-heading placeholder:text-sf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              />
              <button type="submit" disabled={subscribe.isPending} className="h-12 rounded-sf-button bg-sf-heading px-6 font-semibold text-white transition hover:brightness-125 disabled:opacity-70">
                {subscribe.isPending ? t('content.section.sending') : config.button_label}
              </button>
            </form>
          )}
          {subscribe.isError && <p id={`${id}-error`} role="alert" className="mt-2 font-medium">{subscribe.error instanceof ApiError && subscribe.error.code === 'VALIDATION_FAILED' ? t('content.section.emailInvalid') : storeFormError(subscribe.error, t)}</p>}
        </div>
        {config.image && <MediaImage media={config.image} alt="" sizes="(min-width: 768px) 360px, 100vw" className="max-h-64 w-auto rounded-sf-card" />}
      </div>
    </section>
  )
}
