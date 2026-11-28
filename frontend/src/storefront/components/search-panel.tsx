import { useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useLocale } from '../i18n/locale'
import { HeaderSearch } from './header-search'

/** A search icon that opens the product search in a panel from the top (focus moves into it; Escape closes). */
export function SearchPanel() {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className="grid size-10 place-items-center rounded-md text-sf-heading transition hover:bg-sf-canvas hover:text-sf-accent" aria-label={t('common.openSearch')}>
          <SearchIcon aria-hidden className="size-6" />
        </button>
      </SheetTrigger>
      <SheetContent side="top" className="gap-0 border-b bg-sf-surface pb-10" data-testid="search-panel">
        <SheetHeader className="mx-auto w-full max-w-3xl px-4 pt-8">
          <SheetTitle className="font-heading text-2xl font-semibold text-sf-heading">{t('theme.header.searchTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{t('shell.search.label')}</SheetDescription>
        </SheetHeader>
        <div className="mx-auto w-full max-w-3xl px-4 pt-2">
          <HeaderSearch autoFocus onDone={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
