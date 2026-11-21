import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'

/**
 * B20 button feedback: a brief "Added" check laid over a buy button (the button needs `relative`).
 * It covers the button's own content without changing its size; aria-hidden, so the button keeps
 * its name and the existing live regions keep announcing. `iconOnly` for icon buttons;
 * `labelClassName` e.g. hides the word where the button shows its icon only (the quick-buy bar on phones).
 */
export function AddedMark({ show, iconOnly = false, labelClassName }: { show: boolean; iconOnly?: boolean; labelClassName?: string }) {
  const { t } = useLocale()
  if (!show) return null
  return (
    <span aria-hidden className="sf-added-mark" data-testid="added-mark">
      <CheckIcon className="size-4 shrink-0" strokeWidth={3} />
      {!iconOnly && <span className={cn('truncate', labelClassName)}>{t('cart.add.added')}</span>}
    </span>
  )
}
