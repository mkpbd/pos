import { useState } from 'react'
import { MinusIcon, PlusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { canDecrease, canIncrease, displayQuantity, normalizeQuantity, stepQuantity } from './quantity'

/**
 * − [quantity] + for a cart line or the product page. Typing commits on Enter or blur; an
 * invalid entry (0, letters, a fraction for whole items, above 999) falls back to the last value.
 */
export function QuantityStepper({
  value,
  onChange,
  allowDecimal = false,
  max = null,
  disabled = false,
  label,
  size = 'md',
}: {
  value: string
  onChange: (quantity: string) => void
  allowDecimal?: boolean
  /** Upper limit (stock); null = only the 999 cap. */
  max?: string | null
  disabled?: boolean
  /** Accessible name of the input, e.g. "Quantity of Kids Tee". */
  label: string
  size?: 'sm' | 'md'
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const { t } = useLocale()
  // The input keeps Latin digits: it is typed into and parsed.
  const shown = draft ?? displayQuantity(value)

  const commit = () => {
    if (draft === null) return
    const next = normalizeQuantity(draft, allowDecimal)
    setDraft(null)
    if (next !== null && next !== displayQuantity(value)) onChange(next)
  }

  const button = cn(
    'grid place-items-center text-sf-heading transition hover:text-sf-accent disabled:cursor-not-allowed disabled:opacity-40',
    size === 'sm' ? 'size-8' : 'size-11',
  )

  return (
    <div className={cn('inline-flex items-center rounded-sf-button border border-sf-border bg-sf-surface', disabled && 'opacity-70')} data-testid="quantity-stepper">
      <button type="button" className={button} aria-label={t('cart.stepper.decrease', { label })} disabled={disabled || !canDecrease(value)} onClick={() => onChange(stepQuantity(value, -1, max))}>
        <MinusIcon aria-hidden className="size-4" />
      </button>
      <input
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        aria-label={label}
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape' && draft !== null) {
            e.stopPropagation()
            setDraft(null)
          }
        }}
        className={cn('min-w-0 bg-transparent text-center font-semibold text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent', size === 'sm' ? 'h-8 w-12 text-sm' : 'h-11 w-14')}
      />
      <button type="button" className={button} aria-label={t('cart.stepper.increase', { label })} disabled={disabled || !canIncrease(value, max)} onClick={() => onChange(stepQuantity(value, 1, max))}>
        <PlusIcon aria-hidden className="size-4" />
      </button>
    </div>
  )
}
