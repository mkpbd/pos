import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Loader2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'

export const inputClass =
  'w-full rounded-lg border border-sf-border bg-sf-surface px-4 py-2.5 text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent aria-[invalid=true]:border-sf-sale disabled:opacity-60'

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-sf-button bg-sf-accent px-6 py-3 text-sm font-bold text-sf-accent-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'

export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-sf-button border border-sf-border bg-sf-surface px-5 py-2.5 text-sm font-semibold text-sf-heading transition hover:border-sf-accent hover:text-sf-accent disabled:cursor-not-allowed disabled:opacity-60'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: ReactNode
  ref?: Ref<HTMLInputElement>
}

/**
 * A labelled input with its error (or hint) wired up through aria-describedby. A client-side
 * error is a message key (translated, `{max}` = maxLength); a server message shows as it is.
 */
export function TextField({ label, error, hint, className, ref, ...props }: TextFieldProps) {
  const { translateMessage } = useLocale()
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-sf-heading">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={inputClass}
        {...props}
      />
      {error ? (
        <p id={messageId} className="text-sm text-sf-sale">
          {translateMessage(error, props.maxLength === undefined ? undefined : { max: props.maxLength })}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function SubmitButton({ pending, children, pendingLabel, className }: { pending: boolean; children: ReactNode; pendingLabel: string; className?: string }) {
  return (
    <button type="submit" disabled={pending} className={cn(primaryButtonClass, className)}>
      {pending && <Loader2Icon aria-hidden className="size-4 animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  )
}

export function FormAlert({ message }: { message: string | null | undefined }) {
  const { translateMessage } = useLocale()
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg bg-sf-sale/10 px-4 py-3 text-sm font-medium text-sf-sale">
      {translateMessage(message)}
    </p>
  )
}

/** A centred card for the sign-in, registration and password pages. */
export function AuthCard({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-sf-card bg-sf-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-center text-3xl font-extrabold">{title}</h1>
        {intro && <div className="mt-2 text-center text-sm">{intro}</div>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-center text-sm">{footer}</div>}
    </section>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  )
}
