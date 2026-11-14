import { useId, useRef, useState, type ReactNode } from 'react'
import { CircleCheckIcon, CircleXIcon, ImageIcon, InfoIcon, Loader2Icon, PackageIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { useCampaignsQuery, useLandingPagesQuery } from '@/features/marketing/api'
import { CaptionSuggestions } from '@/features/marketing/components/caption-suggestions'
import { NetworkIcon } from '@/features/marketing/components/network-icon'
import { PostPhotos } from '@/features/marketing/components/post-photos'
import {
  CAPTION_MAX,
  captionLength,
  draftProblems,
  draftToInput,
  hashtagCount,
  INSTAGRAM_MAX_HASHTAGS,
  MAX_PHOTOS,
  postErrorText,
  postToDraft,
  type DraftProblems,
  type PostDraft,
  type SubmitIntent,
} from '@/features/marketing/social'
import { useSubmitSocialPostMutation, type SocialAccounts, type SocialPost, type SocialTarget } from '@/features/marketing/social-api'
import { useProductSearchQuery } from '@/features/online-catalog/api'
import { ApiError } from '@/lib/api/client'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'

const NONE = '__none__'

type Problems = DraftProblems & { product?: string; campaign?: string }

/** Server field → the part of the composer that shows it. */
const SERVER_FIELDS: Record<string, keyof Problems> = {
  caption: 'caption',
  targets: 'targets',
  image_ids: 'photos',
  media_ids: 'photos',
  link_url: 'link',
  scheduled_at: 'scheduled_at',
  product_id: 'product',
  campaign_id: 'campaign',
}

type ChosenProduct = { id: string; name: string; image_url: string | null }
/** A product search hit; the list endpoint sends image ids although the shared type omits them. */
type ProductHit = { id: string; name: string; images: { id?: string; url: string }[]; variants: { sku: string }[] }

function ProductChooser({ value, onChange, error }: { value: ChosenProduct | null; onChange: (hit: ProductHit | null) => void; error?: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useProductSearchQuery(term, open)
  const hits = ((results.data?.items ?? []) as unknown as ProductHit[]).filter((p) => p.id !== value?.id)
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm leading-none font-medium">Product</span>
      {value && (
        <div className="flex items-center gap-3 rounded-md border p-2" data-testid="composer-product">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
            {value.image_url ? <img src={value.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{value.name}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <XIcon data-icon="inline-start" /> Remove
          </Button>
        </div>
      )}
      <Popover open={open} onOpenChange={close}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="self-start" aria-invalid={error ? true : undefined}>
            <PackageIcon data-icon="inline-start" /> {value ? 'Choose another product' : 'Choose a product'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false} label="Choose a product">
            <CommandInput value={search} onValueChange={setSearch} placeholder="Search name, SKU or barcode" aria-label="Search products" />
            <CommandList>
              <CommandEmpty>{results.isFetching ? 'Searching…' : results.isError ? 'Products could not be loaded.' : 'No products found.'}</CommandEmpty>
              {hits.length > 0 && (
                <CommandGroup>
                  {hits.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => {
                        onChange(p)
                        close(false)
                      }}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                        {p.images[0] ? <img src={p.images[0].url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{p.name}</span>
                        {p.variants[0]?.sku && <span className="text-xs text-muted-foreground">{p.variants[0].sku}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p id={`${id}-help`} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {error ?? 'Optional. A product gives you its photos, caption ideas and a link to its page.'}
      </p>
    </div>
  )
}

/** Active campaigns (marketing.view): the post's visits and orders count for the chosen one. */
function CampaignSelect({ value, onChange, error }: { value: string | null; onChange: (id: string | null) => void; error?: string }) {
  const id = useId()
  const campaigns = useCampaignsQuery({ page: 1, per_page: 100, status: 'active' })
  const options = campaigns.data?.items ?? []
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Campaign (optional)</Label>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined} aria-describedby={`${id}-help`}>
          <SelectValue placeholder={campaigns.isPending ? 'Loading campaigns…' : undefined} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No campaign</SelectItem>
          {options.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          {value && !options.some((c) => c.id === value) && <SelectItem value={value}>Current campaign</SelectItem>}
        </SelectContent>
      </Select>
      <p id={`${id}-help`} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{error ?? 'Visits and orders from this post count for the campaign.'}</p>
    </div>
  )
}

/** Campaign pages to offer in the link field (marketing.view). */
function LandingPagesList({ id }: { id: string }) {
  const pages = useLandingPagesQuery()
  return (
    <datalist id={id}>
      <option value="/">Home page</option>
      {(pages.data ?? []).map((p) => <option key={p.id} value={p.path}>{p.title}</option>)}
    </datalist>
  )
}

function Rule({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok === null ? (
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : ok ? (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <span>
        {ok !== null && <span className="sr-only">{ok ? 'Done: ' : 'Not yet: '}</span>}
        {children}
      </span>
    </li>
  )
}

type Props = {
  /** null = a new post. Render with a `key` so each opening starts fresh. */
  post: SocialPost | null
  accounts: SocialAccounts
  timeZone: string | undefined
  onClose: () => void
  /** After saving (draft / schedule) or posting; `intent` says which. */
  onSubmitted: (post: SocialPost, intent: SubmitIntent) => void
}

/** New / edit post: product, photos (1–10), caption with counter and suggestions, link and campaign, networks, now or later. */
export function PostComposer({ post, accounts, timeZone, onClose, onSubmitted }: Props) {
  const id = useId()
  const can = useCan()
  const instagramLinked = !!accounts.instagram
  const [draft, setDraft] = useState<PostDraft>(() => postToDraft(post, instagramLinked, timeZone))
  const [product, setProduct] = useState<ChosenProduct | null>(post?.product ? { ...post.product, image_url: post.media.find((m) => m.kind === 'product_image')?.url ?? null } : null)
  // Set once the post exists on the server (also when saving worked but posting did not).
  const [postId, setPostId] = useState<string | null>(post?.id ?? null)
  const [problems, setProblems] = useState<Problems>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingIntent, setPendingIntent] = useState<SubmitIntent | null>(null)
  const captionRef = useRef<HTMLTextAreaElement>(null)
  const submit = useSubmitSocialPostMutation()
  const set = (changes: Partial<PostDraft>) => setDraft((d) => ({ ...d, ...changes }))

  const length = captionLength(draft.caption)
  const hashtags = hashtagCount(draft.caption)
  const instagram = draft.targets.includes('instagram')
  const sandbox = accounts.mode === 'sandbox'
  const busy = submit.isPending

  const chooseProduct = (hit: ProductHit | null) => {
    const library = draft.photos.filter((p) => p.kind === 'media')
    if (!hit) {
      setProduct(null)
      set({ productId: null, photos: library })
      return
    }
    const first = hit.images[0]
    setProduct({ id: hit.id, name: hit.name, image_url: first?.url ?? null })
    set({ productId: hit.id, photos: first?.id ? [{ id: first.id, url: first.url, kind: 'product_image' as const }, ...library].slice(0, MAX_PHOTOS) : library })
  }

  const toggleTarget = (target: SocialTarget, on: boolean) => set({ targets: on ? [...draft.targets.filter((t) => t !== target), target] : draft.targets.filter((t) => t !== target) })

  const submitAs = (intent: SubmitIntent) => {
    const found = draftProblems(draft, intent, { instagramLinked, timeZone })
    setProblems(found)
    setFormError(null)
    if (Object.keys(found).length > 0) {
      setFormError('Check the highlighted parts of the post.')
      return
    }
    setPendingIntent(intent)
    submit.mutate(
      { id: postId ?? undefined, input: draftToInput(draft, intent, timeZone), publish: intent === 'now' },
      {
        onSuccess: ({ saved, published }) => {
          onSubmitted(published ?? saved, intent)
          onClose()
        },
        onError: (error) => {
          const saved = (error as { savedPost?: SocialPost }).savedPost
          if (saved) setPostId(saved.id)
          const mapped: Problems = {}
          if (error instanceof ApiError) {
            for (const [key, messages] of Object.entries(error.fieldErrors)) {
              const field = SERVER_FIELDS[key.split('.')[0] ?? '']
              if (field && !mapped[field]) mapped[field] = messages[0]
            }
          }
          if (Object.keys(mapped).length > 0) {
            setProblems(mapped)
            setFormError('Check the highlighted parts of the post.')
          } else {
            setFormError(`${postErrorText(error)}${saved ? ' The post is saved as a draft.' : ''}`)
          }
        },
        onSettled: () => setPendingIntent(null),
      },
    )
  }

  const describe = (field: keyof Problems, help: string) => problems[field] ?? help

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{post ? 'Edit post' : 'New post'}</DialogTitle>
          <DialogDescription>
            For {accounts.page?.name ?? 'your Facebook Page'}
            {accounts.instagram ? ` and @${accounts.instagram.username} on Instagram` : ''}.{sandbox ? ' Practice mode: nothing is really posted.' : ''}
          </DialogDescription>
        </DialogHeader>

        <form id={`${id}-form`} noValidate onSubmit={(e) => { e.preventDefault(); submitAs(draft.when) }} className="flex flex-col gap-5">
          {can('products.view') && <ProductChooser value={product} onChange={chooseProduct} error={problems.product} />}

          <PostPhotos
            productId={draft.productId}
            canSeeProducts={can('products.view')}
            canUseLibrary={can('media.manage')}
            photos={draft.photos}
            onChange={(photos) => set({ photos })}
            error={problems.photos}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label htmlFor={`${id}-caption`}>Caption</Label>
              <span id={`${id}-counter`} className={cn('text-xs tabular-nums', length > CAPTION_MAX ? 'font-medium text-destructive' : 'text-muted-foreground')} data-testid="caption-counter">
                {length.toLocaleString('en-US')} / {CAPTION_MAX.toLocaleString('en-US')} characters
                {hashtags > 0 && ` · ${hashtags} hashtag${hashtags === 1 ? '' : 's'}`}
              </span>
            </div>
            <Textarea
              id={`${id}-caption`}
              ref={captionRef}
              rows={6}
              value={draft.caption}
              placeholder="What would you like to tell your customers?"
              aria-invalid={problems.caption ? true : undefined}
              aria-describedby={`${id}-counter ${id}-caption-help`}
              onChange={(e) => set({ caption: e.target.value })}
            />
            <p id={`${id}-caption-help`} className={problems.caption ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {describe('caption', 'The link to your store is added at the end when it is posted.')}
            </p>
            <CaptionSuggestions
              key={draft.productId ?? 'none'}
              productId={draft.productId}
              onUse={(caption) => {
                set({ caption })
                captionRef.current?.focus()
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-link`}>Link to (optional)</Label>
              <Input
                id={`${id}-link`}
                list={can('marketing.view') ? `${id}-pages` : undefined}
                maxLength={255}
                autoCapitalize="none"
                spellCheck={false}
                placeholder={draft.productId ? 'The product’s page' : '/p/eid-sale'}
                value={draft.linkUrl}
                aria-invalid={problems.link ? true : undefined}
                aria-describedby={`${id}-link-help`}
                onChange={(e) => set({ linkUrl: e.target.value })}
              />
              <p id={`${id}-link-help`} className={problems.link ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {describe(
                  'link',
                  draft.productId
                    ? 'Leave empty to link the product’s page, or type a page of your store. A short link counts its visits and orders.'
                    : 'A page of your store, e.g. /p/eid-sale. A short link counts its visits and orders.',
                )}
              </p>
              {can('marketing.view') && <LandingPagesList id={`${id}-pages`} />}
            </div>
            {can('marketing.view') && <CampaignSelect value={draft.campaignId} onChange={(campaignId) => set({ campaignId })} error={problems.campaign} />}
          </div>

          <fieldset className="flex flex-col gap-3" aria-describedby={problems.targets ? `${id}-targets-error` : undefined}>
            <legend className="mb-1 text-sm font-medium">Post to</legend>
            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-facebook`} checked={draft.targets.includes('facebook')} onCheckedChange={(v) => toggleTarget('facebook', v === true)} />
              <Label htmlFor={`${id}-facebook`} className="font-normal">
                <NetworkIcon target="facebook" /> Facebook Page “{accounts.page?.name ?? 'your Page'}”
              </Label>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-instagram`}
                  checked={instagram}
                  disabled={!instagramLinked && !instagram}
                  aria-describedby={instagramLinked ? undefined : `${id}-instagram-help`}
                  onCheckedChange={(v) => toggleTarget('instagram', v === true)}
                />
                <Label htmlFor={`${id}-instagram`} className="font-normal">
                  <NetworkIcon target="instagram" /> Instagram {accounts.instagram ? `@${accounts.instagram.username}` : ''}
                </Label>
              </div>
              {!instagramLinked && (
                <p id={`${id}-instagram-help`} className="pl-6 text-sm text-muted-foreground">No Instagram business account is linked to the Facebook Page.</p>
              )}
            </div>
            {problems.targets && <p id={`${id}-targets-error`} className="text-sm text-destructive">{problems.targets}</p>}
          </fieldset>

          {instagram && (
            <div role="note" aria-labelledby={`${id}-ig-rules`} className="rounded-md border bg-muted/40 p-3 text-sm">
              <p id={`${id}-ig-rules`} className="mb-2 font-medium">Instagram rules</p>
              <ul className="flex flex-col gap-1.5" data-testid="instagram-rules">
                <Rule ok={draft.photos.length >= 1 && draft.photos.length <= MAX_PHOTOS}>At least one photo; 2 to 10 make a swipeable carousel</Rule>
                <Rule ok={length <= CAPTION_MAX}>Caption up to {CAPTION_MAX.toLocaleString('en-US')} characters</Rule>
                <Rule ok={hashtags <= INSTAGRAM_MAX_HASHTAGS}>Up to {INSTAGRAM_MAX_HASHTAGS} hashtags (now {hashtags})</Rule>
                <Rule ok={null}>Links in Instagram captions cannot be tapped. Write “link in bio” if your profile links your shop.</Rule>
                <Rule ok={null}>Square or upright (4:5) photos look best; very wide or very tall photos are refused.</Rule>
              </ul>
            </div>
          )}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">When</legend>
            {(
              [
                { value: 'now', label: 'Post now' },
                { value: 'schedule', label: 'Schedule for later' },
              ] as const
            ).map((m) => (
              <div key={m.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-when`}
                  id={`${id}-when-${m.value}`}
                  value={m.value}
                  checked={draft.when === m.value}
                  onChange={() => set({ when: m.value })}
                  className="size-4 accent-primary"
                />
                <Label htmlFor={`${id}-when-${m.value}`} className="font-normal">{m.label}</Label>
              </div>
            ))}
            {draft.when === 'schedule' && (
              <div className="flex flex-col gap-1.5 pl-6">
                <Label htmlFor={`${id}-at`}>Post on</Label>
                <Input
                  id={`${id}-at`}
                  type="datetime-local"
                  className="w-full sm:w-64"
                  value={draft.scheduledAt}
                  aria-invalid={problems.scheduled_at ? true : undefined}
                  aria-describedby={`${id}-at-help`}
                  onChange={(e) => set({ scheduledAt: e.target.value })}
                />
                <p id={`${id}-at-help`} className={problems.scheduled_at ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                  {describe('scheduled_at', `Time in ${timeZone ?? 'your time zone'}. It is posted within a minute of that time.`)}
                </p>
              </div>
            )}
          </fieldset>

          {formError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{formError}</p>}
        </form>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => submitAs('draft')}>
            {pendingIntent === 'draft' && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save draft
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={busy}>
            {(pendingIntent === 'now' || pendingIntent === 'schedule') && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {draft.when === 'now' ? 'Post now' : 'Schedule post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
