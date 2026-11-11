/*
 * Building blocks of the inspector forms: link target picker, media chooser (returns the media
 * ref so the canvas can draw it at once), theme colour picker and the Bangla section of a node.
 */

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mediaKeys, useMediaLookup, type MediaItem } from '@/features/media/api'
import { MediaPicker, MediaThumb } from '@/features/media/components/media-picker'
import { useLinkTargetsQuery, useThemeQuery } from '@/features/storefront/api'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { readBn, type TranslationField } from '@/features/translations/translations'
import { withBangla, type Translations } from './bangla'
import { api, toPaginated } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import type { MediaRef } from '@/storefront/types'
import { THEME_COLOR_ROLES } from '@/storefront/builder/validate'

export type Errors = Record<string, string>

export function FieldError({ id, message }: { id?: string; message?: string }) {
  return message ? <p id={id} className="text-sm text-destructive">{message}</p> : null
}

/* ----------------------------------------------------------------------------------------------
 * Link target picker
 * -------------------------------------------------------------------------------------------- */

const NONE = 'none'
const CUSTOM = 'custom'

type LinkOption = { key: string; label: string; url: string }

/** Store pages, categories, brands and blog targets as `{key, label, url}`, grouped. */
function useLinkOptions(): { group: string; options: LinkOption[] }[] {
  const targets = useLinkTargetsQuery()
  const data = targets.data
  const groups: { group: string; options: LinkOption[] }[] = [
    {
      group: 'Store',
      options: [
        { key: 'store:home', label: 'Home page', url: '/' },
        { key: 'store:shop', label: 'All products', url: '/shop' },
        { key: 'store:blog', label: 'Blog (all posts)', url: '/blog' },
      ],
    },
  ]
  if (!data) return groups
  const add = (group: string, options: LinkOption[]) => {
    if (options.length > 0) groups.push({ group, options })
  }
  add('Pages', data.pages.map((p) => ({ key: `page:${p.id}`, label: `${p.title}${p.status === 'draft' ? ' (draft)' : ''}`, url: `/pages/${p.slug}` })))
  add('Categories', (data.categories ?? []).filter((c) => c.url).map((c) => ({ key: `category:${c.id}`, label: c.name, url: c.url as string })))
  add('Brands', (data.brands ?? []).filter((b) => b.url).map((b) => ({ key: `brand:${b.id}`, label: b.name, url: b.url as string })))
  add('Blog categories', (data.blog_categories ?? []).map((c) => ({ key: `blog_category:${c.id}`, label: c.name, url: `/blog/category/${c.slug}` })))
  add('Blog posts', (data.blog_posts ?? []).map((p) => ({ key: `blog_post:${p.id}`, label: `${p.title}${(p.state ?? p.status) === 'published' ? '' : ` (${p.state ?? p.status})`}`, url: `/blog/${p.slug}` })))
  return groups
}

/**
 * Where a link leads: a store page, category, brand or blog target, or a custom path / URL.
 * Optional links offer "No link" (`null`).
 */
export function LinkField({ label, value, onChange, required = false, error, hint }: {
  label: string
  value: string | null
  onChange: (url: string | null) => void
  required?: boolean
  error?: string
  hint?: string
}) {
  const id = useId()
  const groups = useLinkOptions()
  const all = groups.flatMap((g) => g.options)
  const match = value ? all.find((o) => o.url === value) : undefined
  const [custom, setCustom] = useState(() => value !== null && value !== '' && !match)
  const selected = custom || (value !== null && !match) ? CUSTOM : (match?.key ?? (required ? CUSTOM : NONE))
  const messageId = `${id}-message`

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-target`}>{label}</Label>
      <Select
        value={selected}
        onValueChange={(key) => {
          if (key === NONE) {
            setCustom(false)
            return onChange(null)
          }
          if (key === CUSTOM) {
            setCustom(true)
            return onChange(value ?? (required ? '' : null))
          }
          setCustom(false)
          const option = all.find((o) => o.key === key)
          if (option) onChange(option.url)
        }}
      >
        <SelectTrigger id={`${id}-target`} className="w-full" aria-describedby={error || hint ? messageId : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={NONE}>No link</SelectItem>}
          <SelectItem value={CUSTOM}>Custom link…</SelectItem>
          {groups.map((g) => (
            <SelectGroup key={g.group}>
              <SelectLabel>{g.group}</SelectLabel>
              {g.options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {selected === CUSTOM && (
        <Input
          aria-label={`${label} address`}
          placeholder="/sale or https://…"
          spellCheck={false}
          maxLength={2048}
          value={value ?? ''}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value === '' && !required ? null : e.target.value)}
        />
      )}
      {error ? <FieldError id={messageId} message={error} /> : hint ? <p id={messageId} className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Media chooser
 * -------------------------------------------------------------------------------------------- */

const toRef = (m: MediaItem): MediaRef => ({ id: m.id, url: m.url, srcset: m.srcset, width: m.width, height: m.height, alt: m.alt })

/** A single image from the media library with "Choose / Change / Remove"; reports the chosen image's ref. */
export function ImageChooser({ value, onChange, title, error }: {
  value: string | null
  onChange: (id: string | null, ref?: MediaRef) => void
  title: string
  error?: string
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { byId } = useMediaLookup(value ? [value] : [])

  const pick = async (id: string | undefined) => {
    if (!id) return
    // The picker's pages are in the cache; anything else (just uploaded on another page) is looked up.
    let item: MediaItem | undefined
    for (const [, data] of queryClient.getQueriesData<{ items?: MediaItem[] }>({ queryKey: mediaKeys.all })) {
      item = data?.items?.find((m) => m.id === id)
      if (item) break
    }
    if (!item) {
      try {
        item = (await api.get<MediaItem[]>('/media', { query: { ids: id, per_page: 1 } }).then(toPaginated)).items[0]
      } catch {
        item = undefined
      }
    }
    onChange(id, item ? toRef(item) : undefined)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        {value ? <MediaThumb id={value} byId={byId} className="size-20" /> : <span className="flex size-20 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">No image</span>}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{value ? 'Change image' : 'Choose image'}</Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <XIcon data-icon="inline-start" /> Remove
            </Button>
          )}
        </div>
      </div>
      <FieldError message={error} />
      <MediaPicker open={open} onOpenChange={setOpen} title={title} selected={value ? [value] : []} onConfirm={(ids) => void pick(ids[0])} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Colour: theme swatches + hex
 * -------------------------------------------------------------------------------------------- */

const ROLE_LABELS: Record<(typeof THEME_COLOR_ROLES)[number], string> = {
  primary: 'Primary',
  primary_foreground: 'Text on primary',
  accent: 'Accent',
  accent_foreground: 'Text on accent',
  highlight: 'Highlight',
  sale: 'Sale',
  heading: 'Headings',
  text: 'Body text',
  canvas: 'Page background',
  surface: 'Card background',
  border: 'Borders',
}

const HEX = /^#[0-9a-f]{6}$/i

/** A theme colour (`theme:<role>`, follows the theme) or a fixed `#rrggbb`. */
export function ThemeColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const id = useId()
  const theme = useThemeQuery()
  const colors = theme.data?.settings.colors as Record<string, string> | undefined
  const isTheme = value.startsWith('theme:')
  const [hex, setHex] = useState(isTheme ? '' : value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (!value.startsWith('theme:')) setHex(value)
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div role="group" aria-label="Theme colours" className="flex flex-wrap gap-1.5">
        {THEME_COLOR_ROLES.map((role) => {
          const active = value === `theme:${role}`
          return (
            <button
              key={role}
              type="button"
              title={`${ROLE_LABELS[role]} (follows the theme)`}
              aria-label={`Theme colour: ${ROLE_LABELS[role]}`}
              aria-pressed={active}
              onClick={() => onChange(`theme:${role}`)}
              className={cn('flex size-7 items-center justify-center rounded-full border shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50', active && 'ring-2 ring-primary ring-offset-2')}
              style={{ background: colors?.[role] ?? 'var(--muted)' }}
            >
              {active && <CheckIcon className="size-3.5 mix-blend-difference text-white" aria-hidden />}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(hex) ? hex.toLowerCase() : '#000000'}
          onChange={(e) => {
            setHex(e.target.value)
            onChange(e.target.value)
          }}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={id}
          aria-label={`${label} hex value`}
          placeholder={isTheme ? `${ROLE_LABELS[value.slice(6) as keyof typeof ROLE_LABELS] ?? 'Theme'} (theme)` : '#rrggbb'}
          value={hex}
          maxLength={9}
          spellCheck={false}
          className="font-mono"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setHex(e.target.value)
            if (e.target.value !== '') onChange(e.target.value)
          }}
        />
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Bangla
 * -------------------------------------------------------------------------------------------- */

/** The *বাংলা (Bangla)* section for a node's translatable props (writes `translations.bn`). */
export function NodeBangla({ fields, translations, onChange, errors }: {
  fields: TranslationField[]
  translations: Translations
  onChange: (translations: Translations) => void
  errors: Errors
}) {
  if (fields.length === 0) return null
  const names = fields.map((f) => f.name)
  const value = readBn(translations, names)
  const bnErrors = Object.fromEntries(names.filter((n) => errors[`translations.bn.${n}`]).map((n) => [n, errors[`translations.bn.${n}`] as string]))
  return <BanglaTranslations fields={fields} value={value} onChange={(next) => onChange(withBangla(translations, { ...readBn(translations, Object.keys(translations.bn ?? {})), ...next }))} errors={bnErrors} />
}
