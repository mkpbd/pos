import { useState } from 'react'
import { Link } from 'react-router'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { pointsValue, useLoyaltySettingsQuery, useSaveLoyaltySettingsMutation, type LoyaltySettings } from '@/features/loyalty/api'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney, isZeroDecimal, MONEY_PATTERN } from '@/lib/money'

type Draft = { is_enabled: boolean; spend_amount: string; points_per_spend: string; point_value: string; min_redeem_points: string }

const toDraft = (s: LoyaltySettings): Draft => ({
  is_enabled: s.is_enabled,
  spend_amount: s.spend_amount,
  points_per_spend: String(s.points_per_spend),
  point_value: s.point_value,
  min_redeem_points: String(s.min_redeem_points),
})

const WHOLE = /^\d{1,9}$/

export function LoyaltyPage() {
  const me = useAuth()
  const can = useCan()
  const currency = me.organization?.base_currency
  const canManage = can('loyalty.manage')
  const { data, error, isPending, refetch } = useLoyaltySettingsQuery()
  const save = useSaveLoyaltySettingsMutation()
  // Server values until the user edits; saving returns to them.
  const [edited, setEdited] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (isPending) return <LoadingState rows={4} label="Loading loyalty settings" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const draft = edited ?? toDraft(data)
  const set = (patch: Partial<Draft>) => setEdited({ ...draft, ...patch })
  const validSpend = MONEY_PATTERN.test(draft.spend_amount.trim()) && !isZeroDecimal(draft.spend_amount)
  const validValue = MONEY_PATTERN.test(draft.point_value.trim()) && !isZeroDecimal(draft.point_value)
  const validPoints = WHOLE.test(draft.points_per_spend.trim()) && draft.points_per_spend.trim() !== '0'
  const validMin = WHOLE.test(draft.min_redeem_points.trim())

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (!validSpend) local.spend_amount = 'An amount greater than zero with up to 2 decimals.'
    if (!validPoints) local.points_per_spend = 'A whole number of at least 1.'
    if (!validValue) local.point_value = 'An amount greater than zero with up to 2 decimals.'
    if (!validMin) local.min_redeem_points = 'A whole number (0 = no minimum).'
    if (Object.keys(local).length > 0) return setErrors(local)
    setErrors({})
    save.mutate({
      is_enabled: draft.is_enabled,
      spend_amount: draft.spend_amount.trim(),
      points_per_spend: Number(draft.points_per_spend.trim()),
      point_value: draft.point_value.trim(),
      min_redeem_points: Number(draft.min_redeem_points.trim()),
    }, {
      onSuccess: () => { setEdited(null); toast.success('Loyalty program saved.') },
      onError: (err) => setErrors(fieldErrorMap(err)),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Loyalty program" description="Customers earn points on what they spend and pay with them at the till. Balances and adjustments are on each customer's account (Customers page)." />
      <Card>
        <CardHeader><CardTitle>Program rules</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="loyalty-enabled" checked={draft.is_enabled} onCheckedChange={(v) => set({ is_enabled: v })} disabled={!canManage} />
              <Label htmlFor="loyalty-enabled" className="font-normal">Program is on (points are earned and redeemable)</Label>
            </div>
            <FormField label={`For every (${currency ?? ''} spent)`} error={errors.spend_amount}>
              <Input inputMode="decimal" className="font-mono" disabled={!canManage} value={draft.spend_amount} onChange={(e) => set({ spend_amount: e.target.value })} />
            </FormField>
            <FormField label="…the customer earns (points)" error={errors.points_per_spend}>
              <Input inputMode="numeric" className="font-mono" disabled={!canManage} value={draft.points_per_spend} onChange={(e) => set({ points_per_spend: e.target.value })} />
            </FormField>
            <FormField label={`One point is worth (${currency ?? ''})`} error={errors.point_value}>
              <Input inputMode="decimal" className="font-mono" disabled={!canManage} value={draft.point_value} onChange={(e) => set({ point_value: e.target.value })} />
            </FormField>
            <FormField label="Minimum points per redemption" error={errors.min_redeem_points}>
              <Input inputMode="numeric" className="font-mono" disabled={!canManage} value={draft.min_redeem_points} onChange={(e) => set({ min_redeem_points: e.target.value })} />
            </FormField>
            {validSpend && validPoints && validValue && (
              <p className="text-sm text-muted-foreground sm:col-span-2" data-testid="loyalty-example">
                Example: spending {formatMoney(draft.spend_amount, currency)} earns {draft.points_per_spend.trim()} points, worth {formatMoney(pointsValue(Number(draft.points_per_spend.trim()), draft.point_value.trim()), currency)} at the till.
                Points are earned on the invoice total minus any points redeemed, and reversed on cancellations and returns.
              </p>
            )}
            {errors.form && <p role="alert" className="text-sm text-destructive sm:col-span-2">{errors.form}</p>}
            {canManage && (
              <div className="sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                  Save
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        See a customer's points history on <Link to="/customers" className="underline">Customers</Link> → account.
      </p>
    </div>
  )
}
