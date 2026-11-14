import { useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { EyeIcon, ImageIcon, Loader2Icon, PackageIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProductSearchQuery } from '@/features/online-catalog/api'
import { ApiError } from '@/lib/api/client'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import { useCreateDocumentMutation } from '../api'
import { templateNeedsProduct, useLandingTemplatesQuery, type BuilderTemplate } from '../templates/api'
import { TemplateThumbnail } from '../templates/template-thumbnail'
import type { MessageKey } from './messages'
import { slugify, slugProblemKey } from './page-helpers'
import { useScreenText } from './screen-language'

/*
 * P2a: "New campaign page" on the start screen. Pick a ready-made campaign page (one-product order
 * page, Eid / sale, new arrival, lead form — each with its picture, a line about it and a larger
 * preview) or an empty page; give it a name and its address (/p/<slug>); an order template also
 * asks for the product it sells (optional: the server then uses the store's featured or
 * best-selling product). The page is created as a draft and the editor opens.
 */

const BLANK = '__blank'

/** The built-in landing templates the screen has its own words for (English and Bangla). */
const KNOWN_TEMPLATES = new Set(['landing-order', 'landing-eid-sale', 'landing-new-arrival', 'landing-lead'])

type PickedProduct = { id: string; name: string; image_url: string | null }

/** A template's name and line in the screen's language (built-ins by id), else the server's words. */
function useTemplateWords() {
  const { t } = useScreenText()
  return (template: Pick<BuilderTemplate, 'id' | 'name' | 'description'>) => {
    if (KNOWN_TEMPLATES.has(template.id)) return { name: t(`landing.tpl.${template.id}` as MessageKey), text: t(`landing.tpl.${template.id}.text` as MessageKey) }
    return { name: template.name, text: template.description ?? '' }
  }
}

/** The picture of a template, larger (its tall preview, else its thumbnail). */
function PreviewDialog({ template, name, onClose, onUse }: { template: BuilderTemplate | null; name: string; onClose: () => void; onUse: () => void }) {
  const { t, lang } = useScreenText()
  const url = template?.preview_url ?? template?.thumbnail_url ?? null
  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent lang={lang} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('landing.previewTitle', { name })}</DialogTitle>
          <DialogDescription className="sr-only">{name}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65svh] overflow-y-auto rounded-md border">
          {url ? <img src={url} alt={t('landing.previewAlt', { name })} className="block w-full" decoding="async" /> : template && <TemplateThumbnail template={template} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button type="button" onClick={onUse}>
            {t('landing.previewUse')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The admin product search (name, SKU or barcode) in the screen's language, with the chosen product above it. */
function ProductChoice({ value, onChange, error, labelId, helpId }: { value: PickedProduct | null; onChange: (product: PickedProduct | null) => void; error: string | null; labelId: string; helpId: string }) {
  const { t, lang } = useScreenText()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useProductSearchQuery(term, open)
  const hits = (results.data?.items ?? []).filter((p) => p.id !== value?.id)
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={helpId} className="flex flex-col gap-2" data-testid="landing-product">
      {value && (
        <div className="flex items-center gap-3 rounded-md border p-2" data-testid="landing-chosen-product">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
            {value.image_url ? <img src={value.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{value.name}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <XIcon aria-hidden /> {t('landing.productRemove')}
          </Button>
        </div>
      )}
      <Popover open={open} onOpenChange={close}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="self-start" aria-invalid={!!error || undefined}>
            <PackageIcon aria-hidden /> {value ? t('landing.productChange') : t('landing.productChoose')}
          </Button>
        </PopoverTrigger>
        <PopoverContent lang={lang} className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false} label={t('productZones.pickProduct')}>
            <CommandInput value={search} onValueChange={setSearch} placeholder={t('productZones.searchProducts')} />
            <CommandList label={t('productZones.pickProduct')}>
              <CommandEmpty>{results.isFetching ? t('productZones.searching') : results.isError ? t('productZones.productsError') : t('productZones.noProducts')}</CommandEmpty>
              {hits.length > 0 && (
                <CommandGroup>
                  {hits.map((product) => {
                    const detail = [product.variants[0]?.sku, product.is_active ? null : t('productZones.inactive')].filter(Boolean).join(' · ')
                    return (
                      <CommandItem
                        key={product.id}
                        value={product.id}
                        onSelect={() => {
                          close(false)
                          onChange({ id: product.id, name: product.name, image_url: product.images[0]?.url ?? null })
                        }}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{product.name}</span>
                          {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function NewLandingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, lang } = useScreenText()
  const words = useTemplateWords()
  const templates = useLandingTemplatesQuery(open)
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const [choice, setChoice] = useState<string>(BLANK)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [product, setProduct] = useState<PickedProduct | null>(null)
  const [previewing, setPreviewing] = useState<BuilderTemplate | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const productLabelId = useId()
  const productHelpId = useId()

  const list = templates.data ?? []
  const template = list.find((tpl) => tpl.id === choice) ?? null
  const needsProduct = template !== null && templateNeedsProduct(template)
  const effectiveSlug = slugTouched ? slug : slugify(title)
  const titleProblem = title.trim() ? null : t('landing.titleProblem')
  const slugKey = slugProblemKey(effectiveSlug)
  const slugError = slugKey ? t(slugKey) : null
  const serverError = create.error instanceof ApiError ? create.error : null
  const productError = serverError?.fieldErrors.product_id ? t('landing.productMissing') : null
  const otherServerError = serverError && !productError ? (serverError.code === 'DOCUMENT_EXISTS' ? t('landing.exists') : serverError.message) : null

  const close = (next: boolean) => {
    if (!next) {
      setChoice(BLANK)
      setTitle('')
      setTitleTouched(false)
      setSlug('')
      setSlugTouched(false)
      setProduct(null)
      setPreviewing(null)
      setSubmitted(false)
      create.reset()
    }
    onOpenChange(next)
  }

  const pickProduct = (next: PickedProduct | null) => {
    setProduct(next)
    if (productError) create.reset()
    // A one-product page is usually named after its product, until the person types a name.
    if (next && !titleTouched) setTitle(next.name.slice(0, 160))
  }

  const option = (id: string, name: string, text: string, picture: ReactNode, extra?: { badges?: string[]; preview?: () => void }) => (
    <div
      key={id}
      className={cn('flex flex-col gap-1 rounded-lg border p-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50', choice === id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
      data-testid={`landing-template-${id}`}
    >
      <label className="flex cursor-pointer flex-col gap-2 text-sm">
        <input type="radio" name="landing-start" value={id} checked={choice === id} onChange={() => setChoice(id)} className="sr-only" />
        {picture}
        <span className="font-medium">{name}</span>
        {text && <span className="text-xs text-muted-foreground">{text}</span>}
        {extra?.badges && extra.badges.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {extra.badges.map((badge) => (
              <Badge key={badge} variant="soft" className="text-[11px]">
                {badge}
              </Badge>
            ))}
          </span>
        )}
      </label>
      {extra?.preview && (
        <Button type="button" variant="ghost" size="sm" className="self-start" aria-label={t('landing.previewAria', { name })} onClick={extra.preview}>
          <EyeIcon aria-hidden /> {t('common.preview')}
        </Button>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent lang={lang} className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('landing.new')}</DialogTitle>
          <DialogDescription>{t('landing.dialogText')}</DialogDescription>
        </DialogHeader>
        <form
          id="new-landing"
          className="flex min-w-0 flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
            if (titleProblem || slugError) return
            const key = `landing:${effectiveSlug}` as const
            create.mutate(
              template
                ? { kind: 'page', key, title: title.trim(), from: 'template', template: template.id, ...(needsProduct && product ? { product_id: product.id } : {}) }
                : { kind: 'page', key, title: title.trim(), from: 'blank' },
              {
                onSuccess: (created) => {
                  toast.success(t('landing.created'))
                  close(false)
                  void navigate(`/storefront/builder/${created.id}`)
                },
              },
            )
          }}
        >
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('landing.startLegend')}</legend>
            <div role="radiogroup" aria-label={t('landing.startLegend')} className="grid grid-cols-1 gap-3 p-0.5 min-[480px]:grid-cols-2 md:grid-cols-3">
              {list.map((tpl) => {
                const w = words(tpl)
                const requires = tpl.requires ?? []
                const badges = [templateNeedsProduct(tpl) ? t('landing.needsProduct') : null, requires.includes('promotions') ? t('landing.needsPromotion') : null].filter((b): b is string => b !== null)
                const hasPicture = !!(tpl.preview_url ?? tpl.thumbnail_url)
                return option(tpl.id, w.name, w.text, <TemplateThumbnail template={{ ...tpl, name: w.name }} />, {
                  badges,
                  preview: hasPicture ? () => setPreviewing(tpl) : undefined,
                })
              })}
              {option(BLANK, t('landing.blank'), t('landing.blankDetail'), <TemplateThumbnail template={{ id: BLANK, scope: 'page', category: null, name: t('landing.blank'), thumbnail_url: null }} className="opacity-60" />)}
            </div>
            {templates.isPending && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" aria-hidden /> {t('landing.templatesLoading')}
              </p>
            )}
            {templates.error && <p className="text-sm text-muted-foreground">{t('landing.templatesError')}</p>}
          </fieldset>

          {needsProduct && (
            <div className="flex flex-col gap-1.5">
              <span id={productLabelId} className="text-sm font-medium">
                {t('landing.productLabel')}
              </span>
              <p id={productHelpId} className="text-sm text-muted-foreground">
                {t('landing.productHelp')} {!product && t('landing.productAuto')}
              </p>
              <ProductChoice value={product} onChange={pickProduct} error={productError} labelId={productLabelId} helpId={productHelpId} />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="landing-title">{t('landing.titleLabel')}</Label>
            <Input
              id="landing-title"
              value={title}
              maxLength={160}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
              aria-invalid={submitted && !!titleProblem}
              placeholder={t('landing.titlePlaceholder')}
            />
            {submitted && titleProblem && <p className="text-sm text-destructive">{titleProblem}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="landing-slug">{t('landing.addressLabel')}</Label>
            <Input
              id="landing-slug"
              value={effectiveSlug}
              maxLength={60}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
              aria-invalid={submitted && !!slugError}
              aria-describedby="landing-slug-preview"
            />
            <p id="landing-slug-preview" className="text-sm text-muted-foreground">
              {t('landing.addressHelp')} <span className="font-mono text-foreground">/p/{effectiveSlug || '…'}</span>
            </p>
            {(submitted || slugTouched) && slugError && <p className="text-sm text-destructive">{slugError}</p>}
          </div>
          {otherServerError && (
            <p role="alert" className="text-sm text-destructive">
              {otherServerError}
            </p>
          )}
          {productError && (
            <p role="alert" className="sr-only">
              {productError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="new-landing" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            {t('landing.create')}
          </Button>
        </DialogFooter>
        <PreviewDialog
          template={previewing}
          name={previewing ? words(previewing).name : ''}
          onClose={() => setPreviewing(null)}
          onUse={() => {
            if (previewing) setChoice(previewing.id)
            setPreviewing(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
