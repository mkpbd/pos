import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, Loader2Icon, MessageCircleQuestionIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useCustomer } from '../account/api'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { useStorefront } from '../api'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import type { ProductDetail } from '../types'
import { QUESTION_LIMITS, useAskQuestionMutation, useProductQuestionsQuery } from './questions-api'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Field = 'name' | 'email' | 'question'
type Values = Record<Field, string> & { website: string }

/**
 * P1b questions & answers on the product page: the published questions with the store's answers
 * (10 per page) and "Ask a question" — name, e-mail (private: the answer is e-mailed) and the
 * question, plus a honeypot. Signed-in shoppers start with their name and e-mail filled in. A
 * question shows once the store has answered and published it; the shopper is told so politely.
 */
export function ProductQuestions({ product }: { product: Pick<ProductDetail, 'slug' | 'name'> }) {
  const { t } = useLocale()
  const [page, setPage] = useState(1)
  const [asking, setAsking] = useState(false)
  const [thanks, setThanks] = useState<string | null>(null)
  const askRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const formId = useId()

  useEffect(() => {
    if (!asking && returnFocus.current) {
      returnFocus.current = false
      askRef.current?.focus()
    }
  }, [asking])

  const close = (message: string | null) => {
    returnFocus.current = true
    setAsking(false)
    if (message) setThanks(message)
  }

  return (
    <div className="flex flex-col gap-6" data-testid="product-questions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm">{t('reviews.questions.intro')}</p>
        {!asking && (
          <button
            ref={askRef}
            type="button"
            className={secondaryButtonClass}
            aria-expanded="false"
            aria-controls={formId}
            onClick={() => {
              setThanks(null)
              setAsking(true)
            }}
          >
            <MessageCircleQuestionIcon aria-hidden className="size-4" />
            {t('reviews.questions.ask')}
          </button>
        )}
      </div>
      <div role="status" aria-live="polite" className="empty:hidden" data-testid="question-thanks">
        {thanks && (
          <p className="flex items-start gap-2 rounded-lg bg-sf-highlight/10 px-4 py-3 text-sm font-medium text-sf-heading">
            <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-highlight" />
            {thanks}
          </p>
        )}
      </div>
      {asking && <AskQuestionForm id={formId} product={product} onDone={(message) => close(message)} onCancel={() => close(null)} />}
      <QuestionList slug={product.slug} page={page} onPage={setPage} />
    </div>
  )
}

function QuestionList({ slug, page, onPage }: { slug: string; page: number; onPage: (page: number) => void }) {
  const questions = useProductQuestionsQuery(slug, page)
  const { t, formatDate } = useLocale()
  const { store } = useStorefront()
  const data = questions.data

  if (questions.error && !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{t('reviews.questions.loadFailed')}</p>
        <button type="button" className={primaryButtonClass} disabled={questions.isFetching} onClick={() => void questions.refetch()}>
          {t('common.tryAgain')}
        </button>
      </div>
    )
  }
  if (!data) {
    return (
      <div role="status" className="grid min-h-24 place-items-center">
        <span className="size-8 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">{t('reviews.questions.loading')}</span>
      </div>
    )
  }
  if (data.questions.length === 0) {
    return (
      <p className="font-semibold text-sf-heading" data-testid="questions-empty">
        {t('reviews.questions.empty')}
      </p>
    )
  }

  const { current_page: current, last_page: last } = data.pagination
  const mark = 'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold'

  return (
    <div className="flex flex-col gap-4">
      <ul className={cn('flex flex-col divide-y transition-opacity', questions.isPlaceholderData && 'opacity-60')} aria-label={t('reviews.questions.list')} aria-busy={questions.isPlaceholderData}>
        {data.questions.map((question) => (
          <li key={question.id} className="flex flex-col gap-3 py-4 first:pt-0" data-testid="question">
            <div className="flex gap-3">
              <span aria-hidden className={cn(mark, 'bg-sf-canvas text-sf-heading')}>
                {t('reviews.questions.qMark')}
              </span>
              <div className="min-w-0">
                <p className="font-semibold break-words whitespace-pre-line text-sf-heading">
                  <span className="sr-only">{t('reviews.questions.question')}: </span>
                  {question.question}
                </p>
                <p className="mt-0.5 text-xs">{t('reviews.questions.askedBy', { name: question.name, date: formatDate(question.asked_at) })}</p>
              </div>
            </div>
            {question.answer && (
              <div className="flex gap-3">
                <span aria-hidden className={cn(mark, 'bg-sf-accent text-sf-accent-foreground')}>
                  {t('reviews.questions.aMark')}
                </span>
                <div className="min-w-0">
                  <p className="text-sm break-words whitespace-pre-line">
                    <span className="sr-only">{t('reviews.questions.answer')}: </span>
                    {question.answer}
                  </p>
                  {question.answered_at && <p className="mt-0.5 text-xs">{t('reviews.questions.answeredBy', { store: store.name, date: formatDate(question.answered_at) })}</p>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {last > 1 && (
        <nav aria-label={t('reviews.questions.pages')} className="flex items-center justify-between gap-3 text-sm">
          <button type="button" className="inline-flex min-h-11 items-center gap-1 font-semibold text-sf-accent disabled:text-sf-border" disabled={current <= 1 || questions.isFetching} onClick={() => onPage(current - 1)}>
            <ChevronLeftIcon aria-hidden className="size-4" />
            {t('common.previous')}
          </button>
          <span>{t('reviews.pageOf', { page: current, last })}</span>
          <button type="button" className="inline-flex min-h-11 items-center gap-1 font-semibold text-sf-accent disabled:text-sf-border" disabled={current >= last || questions.isFetching} onClick={() => onPage(current + 1)}>
            {t('common.next')}
            <ChevronRightIcon aria-hidden className="size-4" />
          </button>
        </nav>
      )}
    </div>
  )
}

function clientErrors(values: Values): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {}
  const name = values.name.trim()
  const email = values.email.trim()
  const question = values.question.trim()
  if (!name) errors.name = 'reviews.questions.nameRequired'
  else if (name.length > QUESTION_LIMITS.name) errors.name = 'reviews.questions.nameTooLong'
  if (!EMAIL.test(email) || email.length > QUESTION_LIMITS.email) errors.email = 'reviews.questions.emailInvalid'
  if (question.length < QUESTION_LIMITS.questionMin) errors.question = 'reviews.questions.questionTooShort'
  else if (question.length > QUESTION_LIMITS.questionMax) errors.question = 'reviews.questions.questionTooLong'
  return errors
}

function AskQuestionForm({ id, product, onDone, onCancel }: { id: string; product: Pick<ProductDetail, 'slug' | 'name'>; onDone: (message: string) => void; onCancel: () => void }) {
  const { t, translateMessage } = useLocale()
  const customer = useCustomer()
  const ask = useAskQuestionMutation(product.slug)
  const uid = useId()
  const [values, setValues] = useState<Values>(() => ({ name: customer?.name ?? '', email: customer?.email ?? '', question: '', website: '' }))
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const refs = { name: nameRef, email: emailRef, question: questionRef }

  // The form opens with the focus on the first field to fill in.
  useEffect(() => {
    ;(nameRef.current?.value ? (emailRef.current?.value ? questionRef : emailRef) : nameRef).current?.focus()
  }, [])

  const set = (field: keyof Values, value: string) => setValues((current) => ({ ...current, [field]: value }))
  const focusFirst = (found: Partial<Record<Field, string>>) => {
    const first = (['name', 'email', 'question'] as const).find((field) => found[field])
    if (first) refs[first].current?.focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ask.isPending) return
    const found = clientErrors(values)
    setErrors(found)
    setGeneral(null)
    if (Object.keys(found).length > 0) return focusFirst(found)
    ask.mutate(
      { name: values.name.trim(), email: values.email.trim(), question: values.question.trim(), website: values.website },
      {
        onSuccess: (data) => onDone(typeof data?.message === 'string' && data.message ? data.message : t('reviews.questions.thanks')),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            const fields = error.fieldErrors
            const server: Partial<Record<Field, string>> = {}
            for (const field of ['name', 'email', 'question'] as const) {
              const first = fields[field]?.[0]
              if (first) server[field] = first
            }
            if (Object.keys(server).length > 0) {
              setErrors(server)
              return focusFirst(server)
            }
          }
          setGeneral(error instanceof ApiError && error.status === 404 ? t('reviews.questions.gone') : storeFormError(error, t))
        },
      },
    )
  }

  const message = (field: Field) =>
    errors[field] ? translateMessage(errors[field], { min: QUESTION_LIMITS.questionMin, max: field === 'name' ? QUESTION_LIMITS.name : QUESTION_LIMITS.questionMax }) : null

  const row = (field: Field, label: string, hint: string | null, control: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode) => {
    const controlId = `${uid}-${field}`
    const error = message(field)
    const describedBy = [error ? `${controlId}-error` : null, hint ? `${controlId}-hint` : null].filter(Boolean).join(' ') || undefined
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={controlId} className="text-sm font-medium text-sf-heading">
          {label}
        </label>
        {control({ id: controlId, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
        {error && (
          <p id={`${controlId}-error`} className="text-sm font-medium text-sf-sale">
            {error}
          </p>
        )}
        {hint && (
          <p id={`${controlId}-hint`} className="text-xs">
            {hint}
          </p>
        )}
      </div>
    )
  }

  return (
    <form id={id} onSubmit={submit} noValidate aria-label={t('reviews.questions.formLabel', { name: product.name })} className="relative flex flex-col gap-4 rounded-sf-card border border-sf-border p-4 md:p-5" data-testid="ask-question">
      <div className="grid gap-4 sm:grid-cols-2">
        {row('name', t('reviews.questions.name'), t('reviews.questions.nameHint'), (props) => (
          <input ref={nameRef} {...props} name="name" autoComplete="name" maxLength={QUESTION_LIMITS.name} value={values.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        ))}
        {row('email', t('reviews.questions.email'), t('reviews.questions.emailHint'), (props) => (
          <input ref={emailRef} {...props} type="email" name="email" autoComplete="email" inputMode="email" maxLength={QUESTION_LIMITS.email} value={values.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
        ))}
      </div>
      {row('question', t('reviews.questions.field'), t('reviews.questions.questionHint', { min: QUESTION_LIMITS.questionMin, max: QUESTION_LIMITS.questionMax }), (props) => (
        <textarea ref={questionRef} {...props} name="question" rows={3} maxLength={QUESTION_LIMITS.questionMax} value={values.question} onChange={(e) => set('question', e.target.value)} className={cn(inputClass, 'min-h-24 resize-y')} />
      ))}
      {general && (
        <p role="alert" className="text-sm font-medium text-sf-sale">
          {general}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButtonClass} aria-disabled={ask.isPending || undefined}>
          {ask.isPending && <Loader2Icon aria-hidden className="size-4 animate-spin" />}
          {ask.isPending ? t('reviews.questions.sending') : t('reviews.questions.submit')}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      {/* Honeypot: hidden from people and assistive technology, filled in only by bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`${uid}-website`}>{t('shell.contact.website')}</label>
        <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set('website', e.target.value)} />
      </div>
    </form>
  )
}
