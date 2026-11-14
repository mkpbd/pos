import { useId, useState } from 'react'
import { CopyIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/features/auth/use-auth'
import { copyText } from '@/features/marketing/clipboard'
import { useRotateFeedMutation, useToggleFeedMutation, type ProductFeed } from '@/features/marketing/feeds-api'
import { FEED_COPY, withQuery } from '@/features/marketing/feeds'
import { formatCount } from '@/features/marketing/marketing'
import { formatDateTime } from '@/features/web-orders/orders'

/** One shopping channel's feed: on / off, its secret address to copy, facts, a new address, and where to paste it. */
export function FeedCard({ feed, canManage }: { feed: ProductFeed; canManage: boolean }) {
  const id = useId()
  const me = useAuth()
  const copy = FEED_COPY[feed.channel]
  const toggle = useToggleFeedMutation()
  const rotate = useRotateFeedMutation()
  const [confirmRotate, setConfirmRotate] = useState(false)
  const timeZone = me.organization?.timezone

  const onToggle = (enabled: boolean) =>
    toggle.mutate(
      { channel: feed.channel, enabled },
      {
        onSuccess: (saved) =>
          toast.success(
            saved.enabled
              ? `The ${copy.short} feed is on${saved.item_count === null ? '' : ` with ${formatCount(saved.item_count)} product${saved.item_count === 1 ? '' : 's'}`}.`
              : `The ${copy.short} feed is off. Its address shows nothing until you turn it on again.`,
          ),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <Card data-testid={`feed-${feed.channel}`}>
      <CardHeader>
        <CardTitle>
          <h2 id={`${id}-title`}>{copy.title}</h2>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
        <CardAction>
          <Badge variant={feed.enabled ? 'success' : 'outline'}>{feed.enabled ? 'On' : 'Off'}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start gap-3">
            <Switch id={`${id}-on`} className="mt-0.5" checked={feed.enabled} disabled={!canManage || toggle.isPending} onCheckedChange={onToggle} aria-describedby={`${id}-on-help`} />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`${id}-on`}>Send my products to {copy.short}</Label>
              <p id={`${id}-on-help`} className="text-sm text-muted-foreground">
                {feed.enabled ? `${copy.short} collects your products from the address below.` : `Off: the address shows nothing. Turn it on, then paste the address in ${copy.where}.`}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-url`}>Feed address</Label>
            <div className="flex gap-2">
              <Input id={`${id}-url`} readOnly value={feed.xml_url} className="min-w-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-describedby={`${id}-url-help`} />
              <Button type="button" variant="outline" aria-label={`Copy the ${copy.short} feed address`} onClick={() => void copyText(feed.xml_url, 'Feed address copied.')}>
                <CopyIcon data-icon="inline-start" /> Copy
              </Button>
            </div>
            <p id={`${id}-url-help`} className="text-xs text-muted-foreground">Private to your shop. If it was shared by mistake, make a new one below.</p>
          </div>

          <details className="group rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Other versions of this address</summary>
            <ul className="mt-2 flex flex-col gap-2">
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">CSV file, for a channel that asks for a spreadsheet</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyText(feed.csv_url, 'CSV address copied.')}>
                  <CopyIcon data-icon="inline-start" /> Copy CSV address
                </Button>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Product names and descriptions in Bangla</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyText(withQuery(feed.xml_url, 'lang', 'bn'), 'Bangla address copied.')}>
                  <CopyIcon data-icon="inline-start" /> Copy Bangla address
                </Button>
              </li>
            </ul>
          </details>

          <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">Products in the feed</dt>
              <dd className="font-mono text-lg font-semibold" data-testid={`feed-${feed.channel}-count`}>{feed.item_count === null ? '—' : formatCount(feed.item_count)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">Last updated</dt>
              <dd className="text-sm font-medium">{feed.last_generated_at ? formatDateTime(feed.last_generated_at, timeZone) : 'Not made yet'}</dd>
            </div>
          </dl>

          {canManage && (
            <div className="flex flex-col gap-1">
              <Button type="button" variant="outline" className="self-start" disabled={rotate.isPending} onClick={() => setConfirmRotate(true)}>
                <RefreshCwIcon data-icon="inline-start" /> Make a new address
              </Button>
              <p className="text-xs text-muted-foreground">The old address stops working at once.</p>
            </div>
          )}
        </div>

        <section aria-labelledby={`${id}-steps`} className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4">
          <h3 id={`${id}-steps`} className="text-sm font-semibold">Where to paste this: {copy.where}</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {copy.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="text-sm text-muted-foreground">{copy.after}</p>
          <a href={copy.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-sm text-primary underline-offset-4 hover:underline">
            {copy.link.label} <ExternalLinkIcon className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </section>
      </CardContent>

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title={`Make a new ${copy.short} feed address?`}
        description={`The current address stops working at once. Paste the new address into ${copy.where} afterwards, or your products there stop updating.`}
        confirmLabel="Make new address"
        pending={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(feed.channel, {
            onSuccess: () => toast.success(`New ${copy.short} feed address made. Copy it into ${copy.where}.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setConfirmRotate(false),
          })
        }
      />
    </Card>
  )
}
