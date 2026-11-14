/*
 * B9 Page settings → Search & sharing (contract §4): the page's title and description for search
 * results and shared links (with Bangla), the picture shown when the link is shared, "hide from
 * search engines", and live previews of a Google result and a Facebook / WhatsApp link card.
 * Every change is a `set-seo` command (one undo step per typing burst), versioned with the page.
 */

import { useId, useState } from 'react'
import { EyeOffIcon, ImageIcon, SearchIcon, Share2Icon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useMediaLookup } from '@/features/media/api'
import { cn } from '@/lib/utils'
import { Segmented } from '../controls'
import { ImageChooser } from './fields'
import {
  breadcrumb,
  GOOGLE_DESCRIPTION_CHARS,
  GOOGLE_TITLE_CHARS,
  lengthHint,
  readSeo,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  storeDomain,
  toSeo,
  truncate,
  type SeoForm,
} from './seo-panel-model'
import type { BuilderContent, InspectorDocument, InspectorProps, Problem } from './types'

type Props = {
  content: BuilderContent
  document: InspectorDocument
  bangla: boolean
  problems?: Problem[]
  onCommand: InspectorProps['onCommand']
}

/** Server problems on `seo.*` by form field. */
function seoErrors(problems: readonly Problem[]): Partial<Record<keyof SeoForm, string>> {
  const out: Partial<Record<keyof SeoForm, string>> = {}
  const map: Record<string, keyof SeoForm> = {
    'seo.title': 'title',
    'seo.description': 'description',
    'seo.image': 'image',
    'seo.image.media_id': 'image',
    'seo.translations.bn.title': 'bnTitle',
    'seo.translations.bn.description': 'bnDescription',
  }
  for (const p of problems) {
    const field = map[p.path]
    if (field && !out[field]) out[field] = p.message
  }
  return out
}

function SeoTextField({ label, value, max, kind, placeholder, onChange, error, lang, hint }: {
  label: string
  value: string
  max: number
  kind: 'title' | 'description'
  placeholder?: string
  onChange: (value: string) => void
  error?: string
  lang?: string
  hint?: string
}) {
  const id = useId()
  const advice = lengthHint(value.length, kind)
  const near = value.length > (kind === 'title' ? GOOGLE_TITLE_CHARS : GOOGLE_DESCRIPTION_CHARS)
  const common = {
    id,
    lang,
    value,
    maxLength: max,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': `${id}-help`,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  } as const
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <Label htmlFor={id} className="min-w-0 flex-1">{label}</Label>
        <span className={cn('text-xs tabular-nums', near ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')} aria-hidden data-testid="seo-counter">
          {value.length}/{max}
        </span>
      </div>
      {kind === 'title' ? <Input {...common} /> : <Textarea rows={3} {...common} />}
      <p id={`${id}-help`} className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
        {error ?? [hint, advice, `${value.length} of ${max} characters.`].filter(Boolean).join(' ')}
      </p>
    </div>
  )
}

/** A search result as Google draws it (title link, address line, two lines of description). */
function GooglePreview({ title, description, domain, path, noindex, lang }: { title: string; description: string; domain: string; path: string | null; noindex: boolean; lang: string }) {
  return (
    <figure className="flex flex-col gap-1.5" data-testid="seo-google-preview">
      <figcaption className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <SearchIcon className="size-3.5" aria-hidden /> In Google search
      </figcaption>
      <div className={cn('rounded-md border bg-white p-3 text-left text-[#202124]', noindex && 'opacity-60')} lang={lang}>
        <div className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#f1f3f4] text-[11px] font-semibold text-[#5f6368]" aria-hidden>
            {domain.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight">{domain}</span>
            <span className="block truncate text-[11px] leading-tight text-[#4d5156]">{breadcrumb(domain, path)}</span>
          </span>
        </div>
        <p className="mt-1.5 text-[17px] leading-snug text-[#1a0dab]" data-testid="seo-google-title">{truncate(title, GOOGLE_TITLE_CHARS)}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-[#4d5156]" data-testid="seo-google-description">
          {description ? truncate(description, GOOGLE_DESCRIPTION_CHARS) : <span className="italic">Google shows your shop’s description or words from the page here.</span>}
        </p>
      </div>
      {noindex && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="seo-noindex-note">
          <EyeOffIcon className="size-3.5" aria-hidden /> Hidden: this page won’t be listed in search results.
        </p>
      )}
    </figure>
  )
}

/** A shared link as Facebook and WhatsApp draw it (picture, domain, title, description). */
function SocialPreview({ title, description, domain, imageUrl, lang }: { title: string; description: string; domain: string; imageUrl: string | null; lang: string }) {
  return (
    <figure className="flex flex-col gap-1.5" data-testid="seo-social-preview">
      <figcaption className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Share2Icon className="size-3.5" aria-hidden /> Shared on Facebook or WhatsApp
      </figcaption>
      <div className="overflow-hidden rounded-md border bg-[#f0f2f5] text-left text-[#050505]" lang={lang}>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="aspect-[1.91/1] w-full object-cover" data-testid="seo-social-image" />
        ) : (
          <div className="flex aspect-[1.91/1] w-full flex-col items-center justify-center gap-1 bg-muted px-4 text-center text-xs text-muted-foreground">
            <ImageIcon className="size-5" aria-hidden />
            No picture chosen: your shop’s usual picture is shown, if it has one.
          </div>
        )}
        <div className="flex flex-col gap-0.5 border-t px-3 py-2">
          <span className="truncate text-[11px] tracking-wide text-[#65676b] uppercase">{domain}</span>
          <span className="line-clamp-2 text-[15px] leading-snug font-semibold" data-testid="seo-social-title">{title}</span>
          {description && <span className="line-clamp-1 text-[13px] text-[#65676b]">{description}</span>}
        </div>
      </div>
    </figure>
  )
}

/** Page settings → Search & sharing. */
export function SeoPanel({ content, document, bangla, problems = [], onCommand }: Props) {
  const form = readSeo(content)
  const errors = seoErrors(problems)
  const [previewLang, setPreviewLang] = useState<'en' | 'bn'>('en')
  const { byId } = useMediaLookup(form.image ? [form.image] : [])
  const [chosenUrl, setChosenUrl] = useState<{ id: string; url: string } | null>(null)
  const switchId = useId()

  const set = (patch: Partial<SeoForm>, field: string) => onCommand({ type: 'set-seo', seo: toSeo({ ...form, ...patch }), coalesceKey: `seo:${field}` })

  const lang = bangla ? previewLang : 'en'
  const title = (lang === 'bn' ? form.bnTitle || form.title : form.title) || document.title
  const description = lang === 'bn' ? form.bnDescription || form.description : form.description
  const domain = storeDomain(document.storeUrl)
  const imageUrl = form.image ? (byId.get(form.image)?.url ?? (chosenUrl?.id === form.image ? chosenUrl.url : null)) : null

  return (
    <section className="flex flex-col gap-4 rounded-md border p-3" aria-labelledby="seo-panel-heading" data-testid="seo-panel">
      <div>
        <h3 id="seo-panel-heading" className="text-sm font-semibold">Search & sharing</h3>
        <p className="text-sm text-muted-foreground">
          What Google shows for this page, and how a link to it looks on Facebook and WhatsApp. Leave a field empty to use the page’s usual text. Goes live when you publish.
        </p>
      </div>

      <SeoTextField
        label="Title"
        value={form.title}
        max={SEO_TITLE_MAX}
        kind="title"
        placeholder={document.title}
        hint="Empty: the page title is used."
        error={errors.title}
        onChange={(title) => set({ title }, 'title')}
      />
      <SeoTextField
        label="Description"
        value={form.description}
        max={SEO_DESCRIPTION_MAX}
        kind="description"
        placeholder="e.g. Fresh handmade sweets delivered across Dhaka. Order before 4 pm for same-day delivery."
        error={errors.description}
        onChange={(description) => set({ description }, 'description')}
      />

      {bangla && (
        <fieldset className="flex flex-col gap-3 rounded-md border p-3" data-testid="seo-bangla">
          <legend className="px-1 text-sm font-medium">
            <span lang="bn">বাংলা</span> (Bangla)
          </legend>
          <p className="text-xs text-muted-foreground">Shown to shoppers who use your shop in Bangla. Leave empty to show the English text.</p>
          <SeoTextField label="Title in Bangla" lang="bn" value={form.bnTitle} max={SEO_TITLE_MAX} kind="title" placeholder={form.title || document.title} error={errors.bnTitle} onChange={(bnTitle) => set({ bnTitle }, 'bn.title')} />
          <SeoTextField label="Description in Bangla" lang="bn" value={form.bnDescription} max={SEO_DESCRIPTION_MAX} kind="description" placeholder={form.description} error={errors.bnDescription} onChange={(bnDescription) => set({ bnDescription }, 'bn.description')} />
        </fieldset>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Picture when shared</span>
        <ImageChooser
          title="Choose the picture for shared links"
          value={form.image}
          error={errors.image}
          onChange={(id, ref) => {
            if (id && ref?.url) setChosenUrl({ id, url: ref.url })
            set({ image: id }, 'image')
          }}
        />
        <p className="text-xs text-muted-foreground">A wide picture works best (1200 × 630 pixels). Empty: your shop’s usual picture is used.</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={form.noindex} onCheckedChange={(noindex) => set({ noindex }, 'noindex')} aria-describedby={`${switchId}-hint`} />
          <Label htmlFor={switchId}>Hide this page from search engines</Label>
        </div>
        <p id={`${switchId}-hint`} className="text-xs text-muted-foreground">Google and others won’t list it. People with the link can still open it.</p>
      </div>

      <div className="flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <h4 className="flex-1 text-sm font-semibold">Preview</h4>
          {bangla && (
            <Segmented
              label="Preview language"
              hideLabel
              className="w-36"
              value={previewLang}
              options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা', title: 'Bangla' }]}
              onChange={setPreviewLang}
            />
          )}
        </div>
        <GooglePreview title={title} description={description} domain={domain} path={document.path} noindex={form.noindex} lang={lang} />
        <SocialPreview title={title} description={description} domain={domain} imageUrl={imageUrl} lang={lang} />
        <p className="text-xs text-muted-foreground">A guide only: Google and Facebook decide the exact look, and may take a few days to show changes.</p>
      </div>
    </section>
  )
}
