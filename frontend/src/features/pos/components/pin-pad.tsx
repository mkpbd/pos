import { useEffect, useEffectEvent } from 'react'
import { DeleteIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCountdown, type PinProblem } from '@/features/pos/till-api'
import { PIN_MAX, PIN_MIN } from '@/features/pos/till-helpers'
import { cn } from '@/lib/utils'

/** Typing in a field (or with a modifier) is never taken as PIN digits. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * On-screen PIN pad for a 4–6 digit till PIN. The keyboard's digits, Backspace, Escape (clear)
 * and Enter (submit) work too. Submits by itself at six digits.
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  submitLabel,
  label = 'PIN',
  disabled = false,
  pending = false,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (pin: string) => void
  submitLabel: string
  label?: string
  disabled?: boolean
  pending?: boolean
}) {
  const locked = disabled || pending

  const press = (digit: string) => {
    if (locked || value.length >= PIN_MAX) return
    const next = value + digit
    onChange(next)
    if (next.length === PIN_MAX) onSubmit(next)
  }
  const submit = () => {
    if (!locked && value.length >= PIN_MIN) onSubmit(value)
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
    if (/^\d$/.test(e.key)) {
      e.preventDefault()
      press(e.key)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (!locked) onChange(value.slice(0, -1))
    } else if (e.key === 'Escape' && value !== '') {
      e.preventDefault()
      if (!locked) onChange('')
    } else if (e.key === 'Enter' && (value.length >= PIN_MIN || !(e.target instanceof HTMLButtonElement))) {
      // With a whole PIN typed, Enter submits it even while a button (e.g. the chosen approver) has focus.
      e.preventDefault()
      submit()
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Pad buttons do not take focus, so Enter after tapping digits submits instead of repeating the last digit.
  const keep = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="flex flex-col items-center gap-4">
      <div role="status" aria-label={`${label}: ${value.length} ${value.length === 1 ? 'digit' : 'digits'} entered`} className="flex gap-3" data-testid="pin-dots">
        {Array.from({ length: PIN_MAX }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn('size-3.5 rounded-full border-2 border-primary transition-colors', i < value.length ? 'bg-primary' : 'bg-transparent', i >= PIN_MIN && i >= value.length && 'opacity-40')}
          />
        ))}
      </div>
      <div className="grid w-full max-w-64 grid-cols-3 gap-2" role="group" aria-label={`${label} pad`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button key={d} type="button" variant="outline" className="h-14 text-xl font-semibold" disabled={locked} onMouseDown={keep} onClick={() => press(d)}>
            {d}
          </Button>
        ))}
        <Button type="button" variant="ghost" className="h-14" disabled={locked || value === ''} onMouseDown={keep} onClick={() => onChange('')}>
          Clear
        </Button>
        <Button type="button" variant="outline" className="h-14 text-xl font-semibold" disabled={locked} onMouseDown={keep} onClick={() => press('0')}>
          0
        </Button>
        <Button type="button" variant="ghost" className="h-14" aria-label="Delete last digit" disabled={locked || value === ''} onMouseDown={keep} onClick={() => onChange(value.slice(0, -1))}>
          <DeleteIcon />
        </Button>
      </div>
      <Button type="button" size="lg" className="w-full max-w-64" disabled={locked || value.length < PIN_MIN} onClick={submit}>
        {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  )
}

export function PinProblemMessage({ problem, lockedOut, secondsLeft, children }: { problem: PinProblem | null; lockedOut: boolean; secondsLeft: number; children?: React.ReactNode }) {
  if (!problem) return null
  return (
    <div role="alert" className="w-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-center text-sm text-destructive">
      {problem.message}
      {problem.retryAfter !== null && (lockedOut ? ` Try again in ${formatCountdown(secondsLeft)}.` : ' You can try again now.')}
      {children}
    </div>
  )
}
