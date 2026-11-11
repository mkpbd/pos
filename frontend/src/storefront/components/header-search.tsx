import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { FolderIcon, SearchIcon } from 'lucide-react'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import { MIN_SUGGEST_LENGTH, useSearchSuggestionsQuery } from '../catalog/api'
import { searchUrl } from '../catalog/listing-params'
import { ProductImage } from '../catalog/product-image'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'

type Option = { id: string; url: string; kind: 'product' | 'category' | 'search'; label: string; image?: { url: string; alt: string | null } | null; price?: string }

export const SEARCH_DEBOUNCE_MS = 250

/**
 * Header search with suggestions (ARIA 1.2 combobox with a listbox popup). Typing ≥ 2
 * characters fetches suggestions after a short pause; Arrow keys move through them, Enter
 * opens the highlighted one (or searches), Escape closes the list. Submitting goes to /search.
 */
type SearchProps = { className?: string; autoFocus?: boolean; onDone?: () => void }

export function HeaderSearch(props: SearchProps) {
  const location = useLocation()
  // Follows the URL: the term of the current search, empty on other pages (a new page starts afresh).
  const urlTerm = location.pathname === '/search' ? (new URLSearchParams(location.search).get('q') ?? '') : ''
  return <SearchBox key={`${location.pathname}|${urlTerm}`} initialValue={urlTerm} {...props} />
}

function SearchBox({ className, autoFocus = false, onDone, initialValue }: SearchProps & { initialValue: string }) {
  const id = useId()
  const listId = `${id}-list`
  const navigate = useNavigate()
  const format = usePriceFormat()
  const { t } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState(initialValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const term = useDebouncedValue(value.trim(), SEARCH_DEBOUNCE_MS)
  const suggestions = useSearchSuggestionsQuery(term)
  const ready = term.length >= MIN_SUGGEST_LENGTH && value.trim() === term && suggestions.data !== undefined && !suggestions.isPlaceholderData

  const options: Option[] = []
  if (ready && suggestions.data) {
    for (const p of suggestions.data.products) options.push({ id: `${id}-p-${p.slug}`, url: p.url, kind: 'product', label: p.name, image: p.image, price: p.price })
    for (const c of suggestions.data.categories) options.push({ id: `${id}-c-${c.slug}`, url: c.url, kind: 'category', label: c.name })
    options.push({ id: `${id}-all`, url: searchUrl(term), kind: 'search', label: t('shell.search.searchFor', { term }) })
  }
  const expanded = open && value.trim().length >= MIN_SUGGEST_LENGTH && (ready || suggestions.isFetching)
  const activeOption = expanded ? options[active] : undefined

  const go = (url: string) => {
    setOpen(false)
    setActive(-1)
    inputRef.current?.blur()
    onDone?.()
    void navigate(url)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (activeOption) return go(activeOption.url)
    if (value.trim()) go(searchUrl(value))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!expanded) {
        setOpen(true)
        return
      }
      event.preventDefault()
      if (options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      // -1 is the text field itself; moving past either end wraps through it.
      setActive((i) => {
        const next = i + step
        if (next >= options.length) return -1
        if (next < -1) return options.length - 1
        return next
      })
    } else if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        setActive(-1)
      } else if (value) {
        setValue('')
      }
    }
  }

  const products = options.filter((o) => o.kind === 'product')
  const categories = options.filter((o) => o.kind === 'category')
  const all = options.find((o) => o.kind === 'search')
  const empty = ready && products.length === 0 && categories.length === 0

  const renderOption = (option: Option) => (
    <li
      key={option.id}
      id={option.id}
      role="option"
      aria-selected={activeOption?.id === option.id}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => go(option.url)}
      onMouseMove={() => setActive(options.indexOf(option))}
      className={cn('flex cursor-pointer items-center gap-3 px-4 py-2 text-sm', activeOption?.id === option.id && 'bg-sf-canvas text-sf-accent')}
    >
      {option.kind === 'product' && <ProductImage image={option.image ?? null} alt="" className="size-10 shrink-0 rounded-md border" />}
      {option.kind === 'category' && <FolderIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />}
      {option.kind === 'search' && <SearchIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />}
      <span className={cn('min-w-0 flex-1 truncate', option.kind === 'search' ? 'font-semibold' : 'text-sf-heading')}>{option.label}</span>
      {option.price && <span className="shrink-0 font-semibold text-sf-heading">{format.price(option.price)}</span>}
    </li>
  )

  return (
    <form role="search" onSubmit={submit} className={cn('relative', className)} aria-label={t('shell.search.form')}>
      <label htmlFor={`${id}-input`} className="sr-only">{t('shell.search.label')}</label>
      {/* The field follows the theme's button shape (pill, rounded or square), like the buttons beside it. */}
      <div className="flex h-11 items-center rounded-sf-button border-2 border-sf-border bg-sf-surface pl-5 focus-within:border-sf-accent">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={activeOption?.id}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          placeholder={t('shell.search.placeholder')}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-sf-heading outline-none placeholder:text-sf-text [&::-webkit-search-cancel-button]:hidden"
        />
        <button type="submit" aria-label={t('shell.search.submit')} className="m-1 grid size-8 shrink-0 place-items-center rounded-sf-button bg-sf-accent text-sf-accent-foreground transition hover:brightness-110">
          <SearchIcon aria-hidden className="size-4" />
        </button>
      </div>

      <div
        className={cn('absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-sf-card border bg-sf-surface py-2 shadow-xl', !expanded && 'hidden')}
        data-testid="search-suggestions"
      >
        <ul id={listId} role="listbox" aria-label={t('shell.search.suggestions')} className="max-h-[70vh] overflow-y-auto">
          {products.length > 0 && (
            <li role="presentation">
              <p className="px-4 pt-1 pb-1 text-xs font-bold tracking-wide uppercase" id={`${id}-products`}>{t('shell.search.products')}</p>
              <ul role="group" aria-labelledby={`${id}-products`}>{products.map(renderOption)}</ul>
            </li>
          )}
          {categories.length > 0 && (
            <li role="presentation">
              <p className="px-4 pt-2 pb-1 text-xs font-bold tracking-wide uppercase" id={`${id}-categories`}>{t('shell.search.categories')}</p>
              <ul role="group" aria-labelledby={`${id}-categories`}>{categories.map(renderOption)}</ul>
            </li>
          )}
          {all && renderOption(all)}
        </ul>
        {empty && <p className="px-4 pt-1 text-sm">{t('shell.search.noMatches')}</p>}
        {!ready && <p className="px-4 py-1 text-sm">{t('shell.search.searching')}</p>}
      </div>
      <p role="status" className="sr-only">
        {expanded && ready ? (empty ? t('shell.search.noSuggestions') : t('shell.search.available', { count: products.length + categories.length })) : ''}
      </p>
    </form>
  )
}
