import { useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCartReminderSummaryQuery, useSaveStorefrontSettingsMutation, type StorefrontSettings } from '@/features/storefront/api'
import { fieldErrorMap } from '@/lib/forms'

type Toggle = 'cart_reminders' | 'email_shipped' | 'email_delivered'

const SAVED: Record<Toggle, [on: string, off: string]> = {
  cart_reminders: ['Cart reminders switched on.', 'Cart reminders switched off.'],
  email_shipped: ['Shoppers get an e-mail when the order ships.', 'No e-mail when the order ships.'],
  email_delivered: ['Shoppers get an e-mail when the order is delivered.', 'No e-mail when the order is delivered.'],
}

/**
 * BD2b: reminders of a cart a signed-in shopper left (e-mail, or SMS without an address) and the
 * shipped / delivered e-mails. Each part shows only when the server has its setting.
 */
export function ShopperEmailsCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const id = useId()
  const save = useSaveStorefrontSettingsMutation()
  const hasReminders = settings.cart_reminders !== undefined
  const hasEmails = settings.email_shipped !== undefined || settings.email_delivered !== undefined
  const summary = useCartReminderSummaryQuery(hasReminders)
  const current = String(settings.cart_reminder_after_hours ?? 3)
  const [hours, setHours] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const disabled = !canManage || save.isPending

  if (!hasReminders && !hasEmails) return null

  const toggle = (key: Toggle, on: boolean) =>
    save.mutate({ [key]: on }, { onSuccess: (s) => toast.success(SAVED[key][(s[key] ?? on) ? 0 : 1]), onError: (e) => toast.error(e.message) })

  const saveHours = (e: FormEvent) => {
    e.preventDefault()
    const value = Number(hours)
    if (!/^\d{1,2}$/.test(hours.trim()) || value < 1 || value > 72) {
      setError('Enter a whole number of hours from 1 to 72.')
      return
    }
    setError(null)
    save.mutate(
      { cart_reminder_after_hours: value },
      {
        onSuccess: (s) => {
          setHours(String(s.cart_reminder_after_hours ?? value))
          toast.success('Reminder delay saved.')
        },
        onError: (err) => setError(fieldErrorMap(err).cart_reminder_after_hours ?? err.message),
      },
    )
  }

  return (
    <Card data-testid="shopper-emails-card">
      <CardHeader>
        <CardTitle>Shopper reminders & e-mails</CardTitle>
        <CardDescription>
          Messages the store sends on its own. Cart reminders go to signed-in shoppers by e-mail — or by SMS when they have no e-mail address — once per cart, and stop after 7 days or once they order.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasReminders && (
          <>
            <div className="flex items-center gap-2">
              <Switch id={`${id}-cart`} checked={settings.cart_reminders === true} disabled={disabled} onCheckedChange={(on) => toggle('cart_reminders', on)} />
              <Label htmlFor={`${id}-cart`}>Remind shoppers of a cart they left</Label>
            </div>
            <form onSubmit={saveHours} noValidate className="flex flex-wrap items-end gap-3">
              <FormField label="Reminder delay (hours)" error={error ?? undefined} hint="1–72 hours after the cart last changed." className="w-56">
                <Input inputMode="numeric" value={hours} disabled={!canManage} onChange={(e) => setHours(e.target.value)} />
              </FormField>
              {canManage && (
                <Button type="submit" variant="outline" disabled={save.isPending || hours.trim() === current}>
                  Save delay
                </Button>
              )}
            </form>
            {summary.data && (
              <p className="text-sm text-muted-foreground" data-testid="cart-reminder-summary">
                Sent {summary.data.sent_30d} · {summary.data.ordered_30d} ordered (30 days)
              </p>
            )}
          </>
        )}
        {settings.email_shipped !== undefined && (
          <div className="flex items-center gap-2">
            <Switch id={`${id}-shipped`} checked={settings.email_shipped} disabled={disabled} onCheckedChange={(on) => toggle('email_shipped', on)} />
            <Label htmlFor={`${id}-shipped`}>E-mail the shopper when shipped</Label>
          </div>
        )}
        {settings.email_delivered !== undefined && (
          <div className="flex items-center gap-2">
            <Switch id={`${id}-delivered`} checked={settings.email_delivered} disabled={disabled} onCheckedChange={(on) => toggle('email_delivered', on)} />
            <Label htmlFor={`${id}-delivered`}>E-mail the shopper when delivered</Label>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
