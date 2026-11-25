import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PROMOTION_CHANNELS, type PromotionChannel } from '@/features/promotions/api'
import { CHANNEL_LABELS } from '@/features/promotions/promotions'

const HINTS: Record<PromotionChannel, string> = {
  online: 'Web orders in your online store.',
  till: 'Sales at the POS terminal: automatic offers apply by themselves, coupon codes are typed in by the cashier.',
}

/** POS1a: "Where it applies" — Online store / Till checkboxes, at least one. Free shipping is online only. */
export function ChannelsField({ value, onChange, freeShipping, disabled, error }: {
  value: PromotionChannel[]
  onChange: (channels: PromotionChannel[]) => void
  freeShipping: boolean
  disabled?: boolean
  error?: string
}) {
  const toggle = (channel: PromotionChannel, on: boolean) =>
    onChange(PROMOTION_CHANNELS.filter((c) => (c === channel ? on : value.includes(c))))

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? 'promotion-channels-error' : undefined}>
      <legend className="sr-only">Where it applies</legend>
      {PROMOTION_CHANNELS.map((channel) => {
        const off = channel === 'till' && freeShipping
        const id = `promotion-channel-${channel}`
        return (
          <div key={channel} className="flex items-start gap-2">
            <Checkbox id={id} checked={value.includes(channel) && !off} disabled={disabled || off} onCheckedChange={(checked) => toggle(channel, checked === true)} className="mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={id}>{CHANNEL_LABELS[channel]}</Label>
              <p className="text-sm text-muted-foreground">{off ? 'Free shipping applies to the online store only.' : HINTS[channel]}</p>
            </div>
          </div>
        )
      })}
      {error && <p id="promotion-channels-error" className="text-sm text-destructive">{error}</p>}
    </fieldset>
  )
}
