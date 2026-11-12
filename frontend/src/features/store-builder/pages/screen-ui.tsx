import type { ReactNode } from 'react'
import { LanguagesIcon, Loader2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { SCREEN_LANGS } from './messages'
import { useScreenText } from './screen-language'

/* Small pieces of the start screen (B7): the English / বাংলা switch and a confirm in the screen's language. */

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useScreenText()
  return (
    <div role="group" aria-label={t('lang.label')} className={cn('inline-flex items-center gap-1 rounded-full border bg-background p-1', className)} data-testid="screen-language">
      <LanguagesIcon className="ml-1.5 size-4 text-muted-foreground" aria-hidden />
      {SCREEN_LANGS.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={lang === option}
          onClick={() => setLang(option)}
          className={cn(
            'rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            lang === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {t(option === 'en' ? 'lang.en' : 'lang.bn')}
        </button>
      ))}
    </div>
  )
}

type ConfirmProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
}

/** The shared confirm dialog, with its Cancel in the screen's language. */
export function ScreenConfirm({ open, onOpenChange, title, description, confirmLabel, destructive = true, pending, onConfirm }: ConfirmProps) {
  const { lang, t } = useScreenText()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent lang={lang}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} disabled={pending} onClick={onConfirm}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
