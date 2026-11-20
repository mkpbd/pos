import { useId, useState } from 'react'
import { BotOffIcon, ClockIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/use-auth'
import { aiSwitchedOn } from '@/features/online-catalog/ai-help/model'
import { defaultReportRange } from '@/features/promotions/report'
import { useStorefrontSettingsQuery } from '@/features/storefront/api'
import { AssistantConversations } from '@/features/storefront/assistant/conversations'
import { KEPT_DAYS } from '@/features/storefront/assistant/model'
import { AssistantSettingsCard } from '@/features/storefront/assistant/settings-card'
import { AssistantSummaryCards } from '@/features/storefront/assistant/summary'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'

/*
 * Online store → Assistant (AI2b, /storefront/assistant; storefront.manage): the shopper support
 * assistant's settings, a summary and the chats shoppers had with it. Shown only while AI is on
 * for the organization (the route is guarded by storefront.manage; the tab also checks AI).
 */
export function AssistantPage() {
  const me = useAuth()
  const aiOn = aiSwitchedOn(me)

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {!aiOn ? (
        <div role="note" className="flex gap-3 rounded-lg border border-dashed p-4 text-sm">
          <BotOffIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">The shop assistant needs AI</p>
            <p className="text-muted-foreground">AI is turned off for your shop. An administrator can turn it on under Organization → AI assistant.</p>
          </div>
        </div>
      ) : (
        <AssistantContent timeZone={me?.organization?.timezone ?? undefined} />
      )}
    </div>
  )
}

function AssistantContent({ timeZone }: { timeZone: string | undefined }) {
  const id = useId()
  const settings = useStorefrontSettingsQuery()
  const [initial] = useState(() => defaultReportRange(timeZone))
  const [range, setRange] = useState(initial)
  const changed = range.from !== initial.from || range.to !== initial.to

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Shop assistant</h2>
        <p className="text-sm text-muted-foreground">An AI chat on your store that answers shoppers’ questions from your products, delivery, payment and return rules.</p>
      </div>

      {settings.isPending ? (
        <LoadingState rows={4} label="Loading the assistant settings" />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} title="Could not load the assistant settings" />
      ) : (
        <AssistantSettingsCard key={settings.data.updated_at ?? 'new'} settings={settings.data} />
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">What shoppers asked</h2>
            <p role="note" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ClockIcon className="size-4 shrink-0" aria-hidden />
              Conversations are kept for {KEPT_DAYS} days.
            </p>
          </div>
          <fieldset className="flex flex-wrap items-end gap-2">
            <legend className="sr-only">Days to show</legend>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-from`}>From</Label>
              <Input id={`${id}-from`} type="date" className="w-40" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-to`}>To</Label>
              <Input id={`${id}-to`} type="date" className="w-40" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </div>
            {changed && <Button variant="ghost" onClick={() => setRange(initial)}>Last {KEPT_DAYS} days</Button>}
          </fieldset>
        </div>
        <AssistantSummaryCards range={range} />
        <AssistantConversations range={range} timeZone={timeZone} />
      </div>
    </>
  )
}
