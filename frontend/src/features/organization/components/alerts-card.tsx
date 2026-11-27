import { useEffect, useId } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAlertSettingsQuery, useSaveAlertSettingsMutation, type AlertSettings, type DueReminderSchedule } from '@/features/organization/api'
import { handleFormError } from '@/lib/forms'

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, i) => ({ value: String(i + 1), label }))
const SCHEDULES: { value: DueReminderSchedule; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly (on the 1st)' },
]

const whole = (max: number, message: string) => z.string().trim().regex(/^\d{1,4}$/, message).refine((v) => Number(v) <= max, message)

const schema = z.object({
  daily_summary: z.boolean(),
  daily_summary_hour: z.string(),
  expiry_alert_days: whole(365, 'Whole days, 0–365.'),
  register_open_hours: whole(168, 'Whole hours, 0–168.'),
  due_reminders: z.enum(['off', 'weekly', 'monthly']),
  due_reminder_weekday: z.string(),
  due_reminder_min: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'An amount, e.g. 100 or 250.50.'),
})
type Values = z.infer<typeof schema>

const toValues = (s: AlertSettings | undefined): Values => ({
  daily_summary: s?.daily_summary ?? true,
  daily_summary_hour: String(s?.daily_summary_hour ?? 21),
  expiry_alert_days: String(s?.expiry_alert_days ?? 30),
  register_open_hours: String(s?.register_open_hours ?? 14),
  due_reminders: s?.due_reminders ?? 'off',
  due_reminder_weekday: String(s?.due_reminder_weekday ?? 6),
  due_reminder_min: String(s?.due_reminder_min ?? '100'),
})

const FIELDS = ['daily_summary', 'daily_summary_hour', 'expiry_alert_days', 'register_open_hours', 'due_reminders', 'due_reminder_weekday', 'due_reminder_min'] as const

function ChoiceField({ label, value, options, onChange, disabled }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

/**
 * Organization → Alerts & reminders (R1, organization.update): the daily summary to owners, batch
 * expiry and open-register alerts (in-app), and scheduled SMS reminders to customers who owe money.
 * Hours and days are in the organization's timezone.
 */
export function AlertsCard() {
  const switchId = useId()
  const settings = useAlertSettingsQuery()
  const save = useSaveAlertSettingsMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(undefined) })
  const { errors, isDirty } = form.formState
  const [summaryOn, schedule] = useWatch({ control: form.control, name: ['daily_summary', 'due_reminders'] })

  useEffect(() => {
    if (settings.data) form.reset(toValues(settings.data))
  }, [settings.data, form])

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      {
        daily_summary: v.daily_summary,
        daily_summary_hour: Number(v.daily_summary_hour),
        expiry_alert_days: Number(v.expiry_alert_days),
        register_open_hours: Number(v.register_open_hours),
        due_reminders: v.due_reminders,
        due_reminder_weekday: Number(v.due_reminder_weekday),
        due_reminder_min: v.due_reminder_min,
      },
      {
        onSuccess: (saved) => {
          form.reset(toValues(saved))
          toast.success('Alert settings saved.')
        },
        onError: (e) => handleFormError(e, form.setError, [...FIELDS]),
      },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts & reminders</CardTitle>
        <CardDescription>In-app alerts for owners and managers, and SMS reminders to customers who owe money. Times are in the organization’s timezone.</CardDescription>
      </CardHeader>
      {settings.isPending ? (
        <CardContent><LoadingState rows={3} label="Loading alert settings" /></CardContent>
      ) : settings.error ? (
        <CardContent><ErrorState error={settings.error} onRetry={() => settings.refetch()} /></CardContent>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-label="Alerts and reminders">
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <div className="flex items-center gap-2">
                <Controller control={form.control} name="daily_summary" render={({ field }) => <Switch id={switchId} checked={field.value} onCheckedChange={field.onChange} />} />
                <Label htmlFor={switchId}>Daily summary</Label>
              </div>
              <p className="text-sm text-muted-foreground">Today’s sales, cash, refunds, web orders, best sellers and low stock — in the app and by e-mail to people who see the dashboard.</p>
            </div>
            <Controller
              control={form.control}
              name="daily_summary_hour"
              render={({ field }) => <ChoiceField label="Summary time" value={field.value} options={HOURS} onChange={field.onChange} disabled={!summaryOn} />}
            />
            <span className="hidden sm:block" />
            <FormField label="Expiry alert (days ahead)" error={errors.expiry_alert_days?.message} hint="Batches in stock expiring this soon, each morning. 0 turns it off.">
              <Input inputMode="numeric" {...form.register('expiry_alert_days')} />
            </FormField>
            <FormField label="Open register alert (hours)" error={errors.register_open_hours?.message} hint="Registers left open longer than this. 0 turns it off.">
              <Input inputMode="numeric" {...form.register('register_open_hours')} />
            </FormField>
            <Controller
              control={form.control}
              name="due_reminders"
              render={({ field }) => <ChoiceField label="Due reminders (SMS)" value={field.value} options={SCHEDULES} onChange={field.onChange} />}
            />
            {schedule === 'weekly' ? (
              <Controller
                control={form.control}
                name="due_reminder_weekday"
                render={({ field }) => <ChoiceField label="Day of the week" value={field.value} options={WEEKDAYS} onChange={field.onChange} />}
              />
            ) : (
              <span className="hidden sm:block" />
            )}
            {schedule !== 'off' && (
              <FormField label="Minimum amount owed" error={errors.due_reminder_min?.message} hint="Customers owing less are not reminded.">
                <Input inputMode="decimal" {...form.register('due_reminder_min')} />
              </FormField>
            )}
          </CardContent>
          <CardFooter className="justify-end pt-4">
            <Button type="submit" disabled={save.isPending || !isDirty}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save alerts
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
