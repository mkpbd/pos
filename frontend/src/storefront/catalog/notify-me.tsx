import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BellIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { inputClass, primaryButtonClass } from '../account/form-controls'
import { useCustomer } from '../account/api'
import { storeFormError } from '../form-errors'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import type { ProductDetail, ProductVariant } from '../types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type NotifyRequest = { variant_id: string; email: string; website: string }

/**
 * P1a back-in-stock: for a sold-out variant the buy button becomes "Notify me when it's back". It
 * opens a one-field form (e-mail, pre-filled for signed-in customers, plus a honeypot); the answer
 * is the same whether the address was new or already waiting, and lands in a polite live region.
 */
export function NotifyMeForm({ product, variant }: { product: Pick<ProductDetail, 'slug' | 'name'>; variant: ProductVariant }) {
  const { t } = useLocale()
  const customer = useCustomer()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [general, setGeneral] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = useMutation({
    mutationFn: (body: NotifyRequest) => storeApi.post<{ message?: string }>(`/store/products/${encodeURIComponent(product.slug)}/notify`, body).then((r) => r.data),
  })

  const openForm = () => {
    if (!email && customer?.email) setEmail(customer.email)
    setOpen(true)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (send.isPending) return
    const address = email.trim()
    setGeneral(null)
    if (!EMAIL.test(address)) {
      setError(t('catalog.notify.emailInvalid'))
      inputRef.current?.focus()
      return
    }
    setError(null)
    send.mutate(
      { variant_id: variant.id, email: address, website },
      {
        onSuccess: (data) => setDone(typeof data?.message === 'string' && data.message ? data.message : t('catalog.notify.done', { email: address })),
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
            const fields = e.fieldErrors
            if (fields.email?.[0]) {
              setError(fields.email[0])
              inputRef.current?.focus()
              return
            }
            if (fields.variant_id) return setGeneral(t('catalog.notify.variantGone'))
          }
          setGeneral(storeFormError(e, t))
        },
      },
    )
  }

  const formId = `${uid}-form`
  const errorId = `${uid}-error`
  const hintId = `${uid}-hint`

  return (
    <div className="flex flex-col gap-3" data-testid="notify-me">
      <p className="text-sm">{t('catalog.notify.soldOut', { variant: variant.name })}</p>
      <div aria-live="polite" role="status" className="empty:hidden">
        {done && (
          <p className="flex items-start gap-2 rounded-lg bg-sf-highlight/10 px-4 py-3 text-sm font-medium text-sf-heading">
            <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-highlight" />
            {done}
          </p>
        )}
      </div>
      {!done && !open && (
        <button type="button" onClick={openForm} aria-expanded="false" aria-controls={formId} className={cn(primaryButtonClass, 'self-start sm:min-w-64')}>
          <BellIcon aria-hidden className="size-4" />
          {t('catalog.notify.button')}
        </button>
      )}
      {!done && open && (
        <form id={formId} onSubmit={submit} noValidate aria-label={t('catalog.notify.formLabel', { name: product.name })} className="relative flex flex-col gap-2">
          <label htmlFor={`${uid}-email`} className="text-sm font-medium text-sf-heading">
            {t('catalog.notify.email')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              id={`${uid}-email`}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              maxLength={255}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              className={cn(inputClass, 'min-h-11 min-w-0 flex-1 basis-56')}
            />
            <button type="submit" className={primaryButtonClass} aria-disabled={send.isPending || undefined}>
              {send.isPending ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <BellIcon aria-hidden className="size-4" />}
              {send.isPending ? t('catalog.notify.sending') : t('catalog.notify.submit')}
            </button>
          </div>
          {error && (
            <p id={errorId} className="text-sm font-medium text-sf-sale">
              {error}
            </p>
          )}
          <p id={hintId} className="text-sm">
            {t('catalog.notify.hint')}
          </p>
          {general && (
            <p role="alert" className="text-sm font-medium text-sf-sale">
              {general}
            </p>
          )}
          {/* Honeypot: hidden from people and assistive technology, filled in only by bots. */}
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor={`${uid}-website`}>{t('shell.contact.website')}</label>
            <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </form>
      )}
    </div>
  )
}
