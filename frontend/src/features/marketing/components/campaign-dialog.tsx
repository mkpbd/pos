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
import { useLandingPagesQuery, useSaveCampaignMutation, type Campaign, type CampaignInput } from '@/features/marketing/api'
import { dateOnly, slugify } from '@/features/marketing/marketing'
import { handleFormError } from '@/lib/forms'

const NONE = '__none__'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Give the campaign a name.').max(120),
    utm_campaign: z.string().trim().toLowerCase().max(100).refine((v) => v === '' || /^[a-z0-9._-]+$/.test(v), 'Small letters, digits, dots, dashes or underscores only.'),
    landing_document_id: z.string(),
    starts_at: z.string(),
    ends_at: z.string(),
  })
  .refine((v) => !v.starts_at || !v.ends_at || v.starts_at <= v.ends_at, { path: ['ends_at'], message: 'The end date must be on or after the start date.' })
type Values = z.infer<typeof schema>
const FIELDS = ['name', 'utm_campaign', 'landing_document_id', 'starts_at', 'ends_at'] as const

const toValues = (c: Campaign | null): Values => ({
  name: c?.name ?? '',
  utm_campaign: c?.utm_campaign ?? '',
  landing_document_id: c?.landing_document?.id ?? NONE,
  starts_at: dateOnly(c?.starts_at),
  ends_at: dateOnly(c?.ends_at),
})

type Props = {
  /** null = a new campaign. Render with a `key` so each opening starts fresh. */
  campaign: Campaign | null
  onClose: () => void
  onSaved?: (campaign: Campaign) => void
}

export function CampaignDialog({ campaign, onClose, onSaved }: Props) {
  const save = useSaveCampaignMutation()
  const pages = useLandingPagesQuery()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(campaign) })
  const { errors } = form.formState
  const [name, tag, pageId] = useWatch({ control: form.control, name: ['name', 'utm_campaign', 'landing_document_id'] })
  const effectiveTag = tag.trim() || slugify(name, 60)
  const pageOptions = [...(pages.data ?? [])]
  if (campaign?.landing_document && !pageOptions.some((p) => p.id === campaign.landing_document?.id)) pageOptions.push(campaign.landing_document)

  const onSubmit = form.handleSubmit((v) => {
    const input: Partial<CampaignInput> = {
      name: v.name,
      landing_document_id: v.landing_document_id === NONE ? null : v.landing_document_id,
      starts_at: v.starts_at || null,
      ends_at: v.ends_at || null,
    }
    if (v.utm_campaign) input.utm_campaign = v.utm_campaign
    save.mutate(
      { id: campaign?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(campaign ? 'Campaign saved.' : `Campaign “${saved.name}” created.`)
          onSaved?.(saved)
          onClose()
        },
        onError: (error) => handleFormError(error, form.setError, FIELDS),
      },
    )
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{campaign ? `Edit ${campaign.name}` : 'New campaign'}</DialogTitle>
          <DialogDescription>A campaign groups the ads, posts and links of one promotion, so you can see how many visits and orders it brings.</DialogDescription>
        </DialogHeader>
        <form id="campaign-form" noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus maxLength={120} placeholder="e.g. Eid sale 2026" {...form.register('name')} />
          </FormField>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="campaign-page">Campaign page</Label>
            <Select value={pageId} onValueChange={(v) => form.setValue('landing_document_id', v, { shouldDirty: true })}>
              <SelectTrigger id="campaign-page" className="w-full" aria-describedby="campaign-page-help"><SelectValue placeholder={pages.isPending ? 'Loading pages…' : undefined} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No campaign page</SelectItem>
                {pageOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title} ({p.path}){p.published ? '' : ' — not published'}</SelectItem>)}
              </SelectContent>
            </Select>
            <p id="campaign-page-help" className={errors.landing_document_id ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {errors.landing_document_id?.message ?? 'Visits to this page count for the campaign. Make campaign pages in Online store → Page builder.'}
            </p>
          </div>
          <FormField label="Starts (optional)" error={errors.starts_at?.message}>
            <Input type="date" {...form.register('starts_at')} />
          </FormField>
          <FormField label="Ends (optional)" error={errors.ends_at?.message}>
            <Input type="date" {...form.register('ends_at')} />
          </FormField>
          <FormField
            label="Link tag"
            error={errors.utm_campaign?.message}
            className="sm:col-span-2"
            hint={
              <>
                Links with <span className="font-mono">utm_campaign={effectiveTag || '…'}</span> count for this campaign — short links add it for you.
                {!campaign && ' Leave empty to make one from the name.'}
                {campaign && ' Changing it stops counting links that use the old tag.'}
              </>
            }
          >
            <Input maxLength={100} placeholder={slugify(name, 60) || 'eid-sale-2026'} autoCapitalize="none" spellCheck={false} {...form.register('utm_campaign')} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="campaign-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {campaign ? 'Save campaign' : 'Create campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
