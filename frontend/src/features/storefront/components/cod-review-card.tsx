import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/features/auth/use-auth'
import { useSaveStorefrontSettingsMutation, type CodReviewMode, type StorefrontSettings } from '@/features/storefront/api'
import { fieldErrorMap } from '@/lib/forms'

const MODES: { value: CodReviewMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'risky', label: 'Only risky orders' },
  { value: 'all', label: 'All orders' },
]

const HINTS: Record<CodReviewMode, string> = {
  off: 'Cash on delivery orders are confirmed straight away.',
  risky: 'Orders from numbers with a poor delivery record wait as “Awaiting confirmation” until someone calls the customer.',
  all: 'Every cash on delivery order waits as “Awaiting confirmation” until someone calls the customer.',
}

/** Whole percent 0–100, or null. */
function parsePercent(value: string): number | null {
  const v = value.trim()
  if (!/^\d{1,3}$/.test(v)) return null
  const n = Number(v)
  return n <= 100 ? n : null
}

function MinRateForm({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const current = String(settings.cod_review_min_success_rate ?? 70)
  const [value, setValue] = useState(current)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const rate = parsePercent(value)
    if (rate === null) {
      setError('Enter a whole percentage from 0 to 100.')
      return
    }
    setError(null)
    save.mutate(
      { cod_review_min_success_rate: rate },
      {
        onSuccess: (s) => toast.success(`Numbers below ${s.cod_review_min_success_rate ?? rate}% successful deliveries are held for a call.`),
        onError: (err) => setError(fieldErrorMap(err).cod_review_min_success_rate ?? err.message),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <FormField label="Minimum success rate (%)" error={error ?? undefined} hint="Delivered ÷ (delivered + returned) of earlier orders with the number." className="w-64">
        <Input inputMode="numeric" value={value} disabled={!canManage} onChange={(e) => setValue(e.target.value)} />
      </FormField>
      {canManage && (
        <Button type="submit" variant="outline" disabled={save.isPending || value.trim() === current}>
          Save rate
        </Button>
      )}
    </form>
  )
}

/** BD1b: which cash-on-delivery orders wait for a confirmation call before they can be processed. */
export function CodReviewCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const id = useId()
  const can = useCan()
  const save = useSaveStorefrontSettingsMutation()
  const [error, setError] = useState<string | null>(null)
  const mode = settings.cod_review ?? 'off'
  const newNumbers = settings.cod_review_new_numbers ?? false

  const change = (input: { cod_review: CodReviewMode } | { cod_review_new_numbers: boolean }) => {
    setError(null)
    save.mutate(input, {
      onSuccess: () => toast.success('Cash on delivery check saved.'),
      onError: (e) => {
        const map = fieldErrorMap(e)
        setError(map.cod_review ?? map.cod_review_new_numbers ?? map.form ?? e.message)
      },
    })
  }

  return (
    <Card data-testid="cod-review-card">
      <CardHeader>
        <CardTitle>Cash on delivery check</CardTitle>
        <CardDescription>
          Hold cash on delivery orders until you have called the customer — fewer parcels sent back. Held orders show as “Awaiting confirmation” in{' '}
          {can('web_orders.view') ? <Link to="/web-orders?status=pending_confirmation" className="text-primary underline-offset-4 hover:underline">Web orders</Link> : 'Web orders'}; orders your staff enter are never held.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-mode`}>Hold for a call</Label>
          <Select value={mode} onValueChange={(v) => change({ cod_review: v as CodReviewMode })} disabled={!canManage || save.isPending}>
            <SelectTrigger id={`${id}-mode`} className="w-full sm:w-64" aria-describedby={`${id}-mode-hint`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p id={`${id}-mode-hint`} className="text-sm text-muted-foreground">{HINTS[mode]}</p>
        </div>
        {mode === 'risky' && (
          <>
            {/* Keyed by the saved value, so the field resets when the setting changes. */}
            <MinRateForm key={settings.cod_review_min_success_rate ?? 70} settings={settings} canManage={canManage} />
            <div className="flex items-start gap-2">
              <Switch id={`${id}-new`} checked={newNumbers} disabled={!canManage || save.isPending} onCheckedChange={(on) => change({ cod_review_new_numbers: on })} aria-describedby={`${id}-new-hint`} />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-new`}>Also hold first orders from new numbers</Label>
                <p id={`${id}-new-hint`} className="text-sm text-muted-foreground">Numbers that have never had an order delivered.</p>
              </div>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
