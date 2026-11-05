import { LanguagesIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { Locale } from '../i18n/runtime'

const ORDER: Locale[] = ['en', 'bn']

/**
 * "English / বাংলা" when the store offers both languages (ADR-011). Each language is named in
 * itself and marked with its `lang`, so it is read out and set correctly whatever the page's
 * language is; the current one is pressed.
 */
export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { locale, locales, setLocale, t } = useLocale()
  if (!locales.includes('en') || !locales.includes('bn')) return null

  return (
    <div role="group" aria-label={t('common.language.label')} className={cn('flex items-center gap-1 text-sm', className)} data-testid="language-switcher">
      {!compact && <LanguagesIcon aria-hidden className="size-4 text-sf-text" />}
      {ORDER.map((option, index) => (
        <span key={option} className="flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="text-sf-border">
              /
            </span>
          )}
          <button
            type="button"
            lang={option}
            aria-pressed={locale === option}
            title={t('common.language.switchTo', { language: t(`common.language.${option}`) })}
            onClick={() => locale !== option && setLocale(option)}
            className={cn(
              'rounded px-1 py-0.5 font-semibold transition hover:text-sf-accent',
              locale === option ? 'text-sf-accent underline decoration-2 underline-offset-4' : 'text-sf-heading',
            )}
          >
            {t(`common.language.${option}`)}
          </button>
        </span>
      ))}
    </div>
  )
}
