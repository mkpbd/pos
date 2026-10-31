import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useNewsletterTokenMutation } from '../api'
import { storeFormError } from '../form-errors'

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl font-extrabold">{title}</h1>
      <div className="mt-4 flex flex-col items-center gap-4">{children}</div>
    </section>
  )
}

const homeLink = <Link to="/" className="font-semibold underline underline-offset-4">Continue shopping</Link>

/** Target of the confirmation e-mail link. Confirms once on arrival. */
export function NewsletterConfirmPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const confirm = useNewsletterTokenMutation('confirm')
  const sent = useRef(false)

  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true
      confirm.mutate(token)
    }
  }, [token, confirm])

  if (!token) return <Frame title="Confirm your subscription"><p>This link is incomplete. Please use the link from the e-mail.</p>{homeLink}</Frame>
  if (confirm.isSuccess) return <Frame title="You are subscribed"><p role="status">{confirm.data.message}</p>{homeLink}</Frame>
  if (confirm.isError) return <Frame title="Confirmation failed"><p role="alert">{storeFormError(confirm.error)}</p>{homeLink}</Frame>
  return <Frame title="Confirming…"><p role="status">One moment please.</p></Frame>
}

/**
 * Target of the unsubscribe link. Asks for a click first, so mail scanners that open
 * links cannot unsubscribe anyone.
 */
export function NewsletterUnsubscribePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const unsubscribe = useNewsletterTokenMutation('unsubscribe')

  if (!token) return <Frame title="Unsubscribe"><p>This link is incomplete. Please use the link from the e-mail.</p>{homeLink}</Frame>
  if (unsubscribe.isSuccess) return <Frame title="Unsubscribed"><p role="status">{unsubscribe.data.message}</p>{homeLink}</Frame>

  return (
    <Frame title="Unsubscribe from the newsletter">
      <p>You will no longer receive our news and offers.</p>
      <button
        type="button"
        disabled={unsubscribe.isPending}
        onClick={() => unsubscribe.mutate(token)}
        className="rounded-sf-button bg-sf-accent px-6 py-3 font-semibold text-sf-accent-foreground transition hover:brightness-110 disabled:opacity-70"
      >
        {unsubscribe.isPending ? 'Unsubscribing…' : 'Unsubscribe'}
      </button>
      {unsubscribe.isError && <p role="alert">{storeFormError(unsubscribe.error)}</p>}
    </Frame>
  )
}
