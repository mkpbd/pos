import { useId } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCampaignsQuery, useLandingPagesQuery, useSaveShortLinkMutation, type ShortLink, type ShortLinkInput } from '@/features/marketing/api'
import { CODE_PATTERN, storePathProblem } from '@/features/marketing/marketing'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'

const NONE = '__none__'
const tag = z.string().trim().max(100, 'Keep it under 100 characters.')

const schema = z.object({
  code: z.string().trim().toLowerCase().refine((v) => v === '' || CODE_PATTERN.test(v), '3–32 small letters, digits or dashes.'),
  target_path: z.string().trim().superRefine((v, ctx) => {
    const problem = storePathProblem(v)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
  campaign_id: z.string(),
  source: tag,
  medium: tag,
  content: tag,
  active: z.boolean(),
})
type Values = z.infer<typeof schema>
const FIELDS = ['code', 'target_path', 'campaign_id', 'source', 'medium', 'content', 'active'] as const

/** Server field names → form fields ("utm.source" → source). */
const SERVER_FIELDS: Record<string, (typeof FIELDS)[number]> = { 'utm.source': 'source', 'utm.medium': 'medium', 'utm.content': 'content' }

const toValues = (link: ShortLink | null, campaignId: string | null, target: string): Values => ({
  code: link?.code ?? '',
  target_path: link?.target_path ?? target,
  campaign_id: link?.campaign?.id ?? campaignId ?? NONE,
  source: link?.utm.source ?? '',
  medium: link?.utm.medium ?? '',
  content: link?.utm.content ?? '',
  active: link?.active ?? true,
})

const orNull = (v: string) => (v.trim() === '' ? null : v.trim().toLowerCase())

type Props = {
  /** null = a new link. Render with a `key` so each opening starts fresh. */
  link: ShortLink | null
  /** Pre-selected campaign for a new link (from a campaign's page). */
  campaignId?: string | null
  /** Pre-filled page for a new link (the campaign's page). */
  defaultTarget?: string
  onClose: () => void
  onSaved?: (link: ShortLink) => void
}

export function ShortLinkDialog({ link, campaignId = null, defaultTarget = '', onClose, onSaved }: Props) {
  const save = useSaveShortLinkMutation()
  const campaigns = useCampaignsQuery({ page: 1, per_page: 100, status: 'active' })
  const landingPages = useLandingPagesQuery()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(link, campaignId, defaultTarget) })
  const { errors } = form.formState
  const [active, chosenCampaign] = useWatch({ control: form.control, name: ['active', 'campaign_id'] })
  const listId = useId()

  const campaignOptions = [...(campaigns.data?.items ?? [])]
  if (link?.campaign && !campaignOptions.some((c) => c.id === link.campaign?.id)) campaignOptions.push({ ...link.campaign, slug: '', utm_campaign: '', landing_document: null, starts_at: null, ends_at: null, status: 'archived' })

  const pickCampaign = (id: string) => {
    form.setValue('campaign_id', id, { shouldDirty: true })
    // A campaign with its own page: open that page unless another one was typed already.
    const page = campaignOptions.find((c) => c.id === id)?.landing_document
    if (page && form.getValues('target_path').trim() === '') form.setValue('target_path', page.path, { shouldDirty: true, shouldValidate: true })
  }

  const onSubmit = form.handleSubmit((v) => {
    const input: Partial<ShortLinkInput> = {
      target_path: v.target_path,
      campaign_id: v.campaign_id === NONE ? null : v.campaign_id,
      utm: { source: orNull(v.source), medium: orNull(v.medium), content: orNull(v.content) },
      active: v.active,
    }
    if (!link && v.code !== '') input.code = v.code
    save.mutate(
      { id: link?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(link ? 'Short link saved.' : `Short link /go/${saved.code} created.`)
          onSaved?.(saved)
          onClose()
        },
        onError: (error) => {
          // Map nested utm errors onto their fields before the generic handling.
          const details = error instanceof ApiError ? error.fieldErrors : {}
          let mapped = false
          for (const [key, messages] of Object.entries(details)) {
            const field = SERVER_FIELDS[key]
            if (field) {
              form.setError(field, { type: 'server', message: messages[0] })
              mapped = true
            }
          }
          if (!mapped) handleFormError(error, form.setError, FIELDS)
        },
      },
    )
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{link ? `Edit /go/${link.code}` : 'New short link'}</DialogTitle>
          <DialogDescription>A short address to put in an ad, a post or a message. Each click is counted, and orders from it are credited to the campaign.</DialogDescription>
        </DialogHeader>
        <form id="short-link-form" noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Page it opens" error={errors.target_path?.message} className="sm:col-span-2" hint="A page of your store, e.g. /p/eid-sale. Pick a campaign page from the list or type an address.">
            <Input list={listId} autoFocus maxLength={255} placeholder="/p/eid-sale" autoCapitalize="none" spellCheck={false} {...form.register('target_path')} />
          </FormField>
          <datalist id={listId}>
            <option value="/">Home page</option>
            {(landingPages.data ?? []).map((p) => <option key={p.id} value={p.path}>{p.title}{p.published ? '' : ' (not published)'}</option>)}
          </datalist>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="short-link-campaign">Campaign</Label>
            <Select value={chosenCampaign} onValueChange={pickCampaign}>
              <SelectTrigger id="short-link-campaign" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No campaign</SelectItem>
                {campaignOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.status === 'archived' ? ' (archived)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.campaign_id?.message && <p className="text-sm text-destructive">{errors.campaign_id.message}</p>}
          </div>
          <FormField label="Where you share it (source)" error={errors.source?.message} hint="e.g. facebook, instagram, whatsapp, sms">
            <Input maxLength={100} placeholder="facebook" autoCapitalize="none" {...form.register('source')} />
          </FormField>
          <FormField label="Kind of post (medium)" error={errors.medium?.message} hint="e.g. paid, post, message">
            <Input maxLength={100} placeholder="paid" autoCapitalize="none" {...form.register('medium')} />
          </FormField>
          <FormField label="Which ad or post (optional)" error={errors.content?.message} className="sm:col-span-2" hint="Tells two ads of the same campaign apart, e.g. video-1.">
            <Input maxLength={100} autoCapitalize="none" {...form.register('content')} />
          </FormField>
          {link ? (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="short-link-active" checked={active} onCheckedChange={(v) => form.setValue('active', v, { shouldDirty: true })} />
              <Label htmlFor="short-link-active" className="font-normal">Active — when off, the link opens your home page</Label>
            </div>
          ) : (
            <FormField label="Link code (optional)" error={errors.code?.message} className="sm:col-span-2" hint="The part after /go/. Leave empty for a random code. It cannot be changed later.">
              <Input maxLength={32} placeholder="eid-offer" autoCapitalize="none" spellCheck={false} {...form.register('code')} />
            </FormField>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="short-link-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {link ? 'Save link' : 'Create link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
