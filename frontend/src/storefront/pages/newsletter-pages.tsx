import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useNewsletterTokenMutation } from '../api'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import { useDocumentMeta } from '../use-document-meta'

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  useDocumentMeta({ title, noindex: true })

  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl font-extrabold">{title}</h1>
      <div className="mt-4 flex flex-col items-center gap-4">{children}</div>
    </section>
  )
}

function HomeLink() {
  const { t } = useLocale()
  return (
    <Link to="/" className="font-semibold underline underline-offset-4">
      {t('content.newsletter.continueShopping')}
    </Link>
  )
}

/** Target of the confirmation e-mail link. Confirms once on arrival. */
export function NewsletterConfirmPage() {
  const [params] = useSearchParams()
  const { t } = useLocale()
  const token = params.get('token') ?? ''
  const confirm = useNewsletterTokenMutation('confirm')
  const sent = useRef(false)

  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true
      confirm.mutate(token)
    }
  }, [token, confirm])

  if (!token) return <Frame title={t('content.newsletter.confirmTitle')}><p>{t('content.newsletter.incomplete')}</p><HomeLink /></Frame>
  if (confirm.isSuccess) return <Frame title={t('content.newsletter.subscribed')}><p role="status">{confirm.data.message}</p><HomeLink /></Frame>
  if (confirm.isError) return <Frame title={t('content.newsletter.confirmFailed')}><p role="alert">{storeFormError(confirm.error, t)}</p><HomeLink /></Frame>
  return <Frame title={t('content.newsletter.confirming')}><p role="status">{t('content.newsletter.oneMoment')}</p></Frame>
}

/**
 * Target of the unsubscribe link. Asks for a click first, so mail scanners that open
 * links cannot unsubscribe anyone.
 */
export function NewsletterUnsubscribePage() {
  const [params] = useSearchParams()
  const { t } = useLocale()
  const token = params.get('token') ?? ''
  const unsubscribe = useNewsletterTokenMutation('unsubscribe')

  if (!token) return <Frame title={t('content.newsletter.unsubscribeTitle')}><p>{t('content.newsletter.incomplete')}</p><HomeLink /></Frame>
  if (unsubscribe.isSuccess) return <Frame title={t('content.newsletter.unsubscribed')}><p role="status">{unsubscribe.data.message}</p><HomeLink /></Frame>

  return (
    <Frame title={t('content.newsletter.unsubscribeHeading')}>
      <p>{t('content.newsletter.noLonger')}</p>
      <button
        type="button"
        disabled={unsubscribe.isPending}
        onClick={() => unsubscribe.mutate(token)}
        className="rounded-sf-button bg-sf-accent px-6 py-3 font-semibold text-sf-accent-foreground transition hover:brightness-110 disabled:opacity-70"
      >
        {unsubscribe.isPending ? t('content.newsletter.unsubscribing') : t('content.newsletter.unsubscribe')}
      </button>
      {unsubscribe.isError && <p role="alert">{storeFormError(unsubscribe.error, t)}</p>}
    </Frame>
  )
}
