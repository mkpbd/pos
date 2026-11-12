import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { MenuLink } from '../../components/menu-link'
import { storeFormError } from '../../form-errors'
import { storeApi } from '../../http'
import { useLocale } from '../../i18n/locale'
import { usePopupActions } from '../popups/popup-context'
import { NODE_ID } from '../registry'
import { usePage } from '../render-context'
import type { FormField, FormFieldKind, FormSubmitRequest, FormSubmitResponse } from '../types'
import { isUuid, safeLink } from '../validate'
import { formErrors, initialValues, maxLengthOf, readFields, submitValues, type FieldError, type FormValues } from './form-values'
import { isObject, PRIMARY_BUTTON, str, type El } from './shared'

/*
 * B8b: the form element (contract §2). Native inputs with visible labels; help and errors are tied
 * to their input with aria-describedby; a failed submit shows an error summary and moves focus
 * to it; the success message lands in a polite live region. A honeypot (`website`) catches bots.
 * In a draft preview or the editor canvas the form is drawn but cannot be sent.
 */

const INPUT =
  'w-full min-h-11 rounded-lg border border-sf-border bg-sf-surface px-4 py-2.5 text-sf-heading placeholder:text-sf-text/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sf-accent aria-[invalid=true]:border-sf-sale'

const AUTOCOMPLETE: Partial<Record<FormFieldKind, string>> = { email: 'email', phone: 'tel' }

const WIDE: ReadonlySet<FormFieldKind> = new Set(['textarea', 'radio', 'checkboxes', 'checkbox'])

type Errors = Record<string, FieldError | string>

export function FormElement({ element }: { element: El<'form'> }) {
  const uid = useId()
  const { t } = useLocale()
  const { page, draft } = usePage()
  const popup = usePopupActions()
  const { pathname } = useLocation()
  const p = element.props ?? ({} as El<'form'>['props'])
  const fields = readFields(p.fields)
  const title = str(p.title)
  const text = str(p.text)
  const submitLabel = str(p.submit_label) || t('content.builder.form.send')
  const consent = isObject(p.consent) && str(p.consent.text) ? { text: str(p.consent.text), url: safeLink(p.consent.link) } : null
  const twoColumns = p.layout === 'two_columns'
  const documentId = page.document?.id
  // Sending needs the published document (its uuid) and an element id the server can find.
  const disabled = draft || page.document?.key === 'canvas' || !isUuid(documentId) || !NODE_ID.test(element.id)

  const [values, setValues] = useState<FormValues>(() => initialValues(fields))
  const [agreed, setAgreed] = useState(false)
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  // Bumped on every failed submit: focus moves to the error summary once it has rendered.
  const [failures, setFailures] = useState(0)
  useEffect(() => {
    if (failures > 0) summaryRef.current?.focus()
  }, [failures])

  const send = useMutation({
    mutationFn: (body: FormSubmitRequest) =>
      storeApi.post<FormSubmitResponse>(`/store/forms/${encodeURIComponent(String(documentId))}/${encodeURIComponent(element.id)}`, body).then((r) => r.data),
  })

  const id = (fieldId: string, part = '') => `${uid}-${fieldId}${part}`
  const message = (error: FieldError | string) => (typeof error === 'string' ? error : t(error.key, error.params))
  const fieldLabel = (key: string) => (key === 'consent' ? consent?.text : fields.find((f) => f.id === key)?.label) ?? key

  const showErrors = (next: Errors, generalMessage: string | null = null) => {
    setErrors(next)
    setGeneral(generalMessage)
    setFailures((n) => n + 1)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (disabled || send.isPending) return
    const local: Errors = formErrors(fields, values)
    if (consent && !agreed) local.consent = { key: 'content.builder.form.errorConsent' }
    if (Object.keys(local).length > 0) return showErrors(local)
    setErrors({})
    setGeneral(null)
    send.mutate(
      { values: submitValues(fields, values), consent: consent ? agreed : false, website, page_path: pathname },
      {
        onSuccess: (data) => {
          setSuccess(str(data?.message) || str(p.success_message))
          setValues(initialValues(fields))
          setAgreed(false)
          popup?.acted()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            const mapped: Errors = {}
            for (const [key, list] of Object.entries(error.details ?? {})) {
              const text = Array.isArray(list) && typeof list[0] === 'string' ? list[0] : null
              if (!text) continue
              const fieldId = key === 'consent' ? 'consent' : key.startsWith('values.') ? key.slice(7).split('.')[0]! : null
              if (fieldId && (fieldId === 'consent' || fields.some((f) => f.id === fieldId))) mapped[fieldId] = text
            }
            return showErrors(mapped, Object.keys(mapped).length > 0 ? null : t('common.form.checkFields'))
          }
          if (error instanceof ApiError && (error.status === 404 || error.code === 'FORM_NOT_FOUND')) return showErrors({}, t('content.builder.form.errorNotFound'))
          if (error instanceof ApiError && error.status === 413) return showErrors({}, t('content.builder.form.errorTooLarge'))
          showErrors({}, storeFormError(error, t))
        },
      },
    )
  }

  const set = (fieldId: string, value: FormValues[string]) => setValues((v) => ({ ...v, [fieldId]: value }))
  const errorKeys = Object.keys(errors)
  const hasSummary = errorKeys.length > 0 || general !== null

  const describedBy = (field: FormField) => cn(field.help && id(field.id, '-help'), errors[field.id] && id(field.id, '-error')) || undefined

  const requiredMark = (
    <>
      <span aria-hidden="true" className="ms-0.5 text-sf-sale">
        *
      </span>
      <span className="sr-only"> ({t('content.builder.form.required')})</span>
    </>
  )

  const help = (field: FormField) =>
    field.help ? (
      <p id={id(field.id, '-help')} className="text-sm text-sf-text">
        {field.help}
      </p>
    ) : null
  const error = (key: string) =>
    errors[key] ? (
      <p id={id(key, '-error')} className="text-sm font-medium text-sf-sale">
        {message(errors[key]!)}
      </p>
    ) : null

  const renderField = (field: FormField): ReactNode => {
    const value = values[field.id]
    const invalid = errors[field.id] ? true : undefined
    const common = { 'aria-invalid': invalid, 'aria-describedby': describedBy(field), 'aria-required': field.required || undefined }

    if (field.kind === 'radio' || field.kind === 'checkboxes') {
      const selected = Array.isArray(value) ? value : []
      return (
        <fieldset id={id(field.id)} tabIndex={-1} className="flex flex-col gap-2 focus:outline-none" {...common} aria-required={undefined}>
          <legend className="mb-1 text-sm font-medium text-sf-heading">
            {field.label}
            {field.required && requiredMark}
          </legend>
          {help(field)}
          {field.options.map((option) => (
            <label key={option.id} className="flex min-h-11 items-center gap-3 text-sf-heading">
              <input
                type={field.kind === 'radio' ? 'radio' : 'checkbox'}
                name={id(field.id, '-input')}
                value={option.id}
                checked={field.kind === 'radio' ? value === option.id : selected.includes(option.id)}
                onChange={(e) =>
                  field.kind === 'radio' ? set(field.id, option.id) : set(field.id, e.target.checked ? [...selected, option.id] : selected.filter((x) => x !== option.id))
                }
                className="size-5 accent-sf-accent"
              />
              {option.label}
            </label>
          ))}
          {error(field.id)}
        </fieldset>
      )
    }

    if (field.kind === 'checkbox') {
      return (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-start gap-3 text-sf-heading">
            <input id={id(field.id)} type="checkbox" checked={value === true} onChange={(e) => set(field.id, e.target.checked)} required={field.required} className="mt-1 size-5 shrink-0 accent-sf-accent" {...common} />
            <span>
              {field.label}
              {field.required && requiredMark}
            </span>
          </label>
          {help(field)}
          {error(field.id)}
        </div>
      )
    }

    const label = (
      <label htmlFor={id(field.id)} className="text-sm font-medium text-sf-heading">
        {field.label}
        {field.required && requiredMark}
      </label>
    )
    const text = typeof value === 'string' ? value : ''
    let control: ReactNode
    if (field.kind === 'select') {
      control = (
        <select id={id(field.id)} value={text} onChange={(e) => set(field.id, e.target.value)} required={field.required} className={INPUT} {...common}>
          <option value="">{field.placeholder || t('content.builder.form.choose')}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )
    } else if (field.kind === 'textarea') {
      control = (
        <textarea
          id={id(field.id)}
          rows={4}
          value={text}
          onChange={(e) => set(field.id, e.target.value)}
          placeholder={field.placeholder || undefined}
          maxLength={maxLengthOf(field)}
          required={field.required}
          className={cn(INPUT, 'resize-y')}
          {...common}
        />
      )
    } else {
      const type = field.kind === 'phone' ? 'tel' : field.kind === 'text' ? 'text' : field.kind
      control = (
        <input
          id={id(field.id)}
          type={type}
          value={text}
          onChange={(e) => set(field.id, e.target.value)}
          placeholder={field.placeholder || undefined}
          maxLength={maxLengthOf(field)}
          min={field.kind === 'number' ? (field.min ?? undefined) : undefined}
          max={field.kind === 'number' ? (field.max ?? undefined) : undefined}
          step={field.kind === 'number' ? 'any' : undefined}
          inputMode={field.kind === 'number' ? 'decimal' : undefined}
          autoComplete={AUTOCOMPLETE[field.kind]}
          required={field.required}
          className={INPUT}
          {...common}
        />
      )
    }
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        {control}
        {help(field)}
        {error(field.id)}
      </div>
    )
  }

  const focusField = (key: string) => {
    const target = key === 'consent' ? document.getElementById(id('consent')) : document.getElementById(id(key))
    const input = target instanceof HTMLFieldSetElement ? target.querySelector<HTMLElement>('input') : target
    input?.focus()
  }

  return (
    <div data-b={element.id} className="b-form flex flex-col gap-4" data-testid="builder-form">
      {title && <h2 className="text-2xl font-extrabold text-sf-heading">{title}</h2>}
      {text && <p className="whitespace-pre-line">{text}</p>}
      <div role="status" aria-live="polite" data-testid="form-status">
        {success && (
          <div className="rounded-sf-card border border-sf-border bg-sf-surface p-4">
            <p className="font-semibold text-sf-heading">{success}</p>
          </div>
        )}
      </div>
      {success ? (
        <button type="button" className="self-start text-sm underline underline-offset-4" onClick={() => setSuccess(null)}>
          {t('content.builder.form.sendAnother')}
        </button>
      ) : (
        <form noValidate onSubmit={submit} aria-label={title || t('content.builder.form.label')} className="relative flex flex-col gap-4">
          {hasSummary && (
            <div ref={summaryRef} tabIndex={-1} role="group" aria-labelledby={id('summary')} data-testid="form-error-summary" className="rounded-lg border-2 border-sf-sale bg-sf-surface p-4 text-sf-heading focus:outline-2 focus:outline-offset-2 focus:outline-sf-sale">
              <p id={id('summary')} className="font-semibold">
                {general ?? t('content.builder.form.summary')}
              </p>
              {errorKeys.length > 0 && (
                <>
                  <ul className="mt-2 list-disc ps-5">
                    {errorKeys.map((key) => (
                      <li key={key}>
                        <a
                          href={`#${id(key)}`}
                          className="underline underline-offset-2"
                          onClick={(e) => {
                            e.preventDefault()
                            focusField(key)
                          }}
                        >
                          {fieldLabel(key)}: {message(errors[key]!)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className={cn('grid gap-4', twoColumns && 'sm:grid-cols-2')}>
            {fields.map((field) => (
              <div key={field.id} className={cn(twoColumns && WIDE.has(field.kind) && 'sm:col-span-2')}>
                {renderField(field)}
              </div>
            ))}
          </div>
          {consent && (
            <div className="flex flex-col gap-1.5">
              <label className="flex min-h-11 items-start gap-3 text-sm text-sf-heading">
                <input
                  id={id('consent')}
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  required
                  aria-required
                  aria-invalid={errors.consent ? true : undefined}
                  aria-describedby={errors.consent ? id('consent', '-error') : undefined}
                  className="mt-0.5 size-5 shrink-0 accent-sf-accent"
                />
                <span>
                  {consent.text}
                  {requiredMark}
                </span>
              </label>
              {consent.url && (
                <MenuLink url={consent.url} newTab className="ms-8 self-start text-sm underline underline-offset-2">
                  {t('content.builder.form.consentLink')}
                </MenuLink>
              )}
              {error('consent')}
            </div>
          )}
          {/* Honeypot: hidden from people and assistive technology, filled in only by bots. */}
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor={id('website')}>{t('shell.contact.website')}</label>
            <input id={id('website')} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          {disabled && (
            <p role="note" className="rounded-lg bg-sf-surface p-3 text-sm text-sf-text" data-testid="form-draft-note">
              {t('content.builder.form.draft')}
            </p>
          )}
          <button type="submit" disabled={disabled || send.isPending} aria-disabled={disabled || undefined} className={cn(PRIMARY_BUTTON, 'self-start disabled:cursor-not-allowed disabled:opacity-60')}>
            {send.isPending ? t('content.builder.form.sending') : submitLabel}
          </button>
        </form>
      )}
    </div>
  )
}
