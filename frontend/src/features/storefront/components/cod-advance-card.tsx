import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useSaveStorefrontSettingsMutation, type CodAdvanceAmount, type CodReviewMode, type StorefrontSettings } from '@/features/storefront/api'
import { codAdvanceChanges, toCodAdvanceDraft, validateCodAdvance, type CodAdvanceDraft } from '@/features/storefront/cod-advance'
import { fieldErrorMap } from '@/lib/forms'

const MODES: { value: CodReviewMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Cash on delivery orders pay everything on delivery.' },
  { value: 'risky', label: 'Only risky orders', hint: 'Uses the cash on delivery check rules: numbers below the minimum success rate (and new numbers, if switched on).' },
  { value: 'all', label: 'All orders', hint: 'Every cash on delivery order placed in the shop or on a campaign page.' },
]

const AMOUNTS: { value: CodAdvanceAmount; label: string }[] = [
  { value: 'delivery', label: 'The delivery charge (plus the cash on delivery fee)' },
  { value: 'fixed', label: 'A fixed amount' },
]

/**
 * BD1c: "Advance delivery charge for cash on delivery". Instead of a confirmation call, the shopper
 * pays the delivery charge (or a fixed amount) by bKash / Nagad / Rocket Send Money; the rest is paid
 * on delivery. Needs at least one Send Money method switched on (`cod_advance_ready`).
 */
export function CodAdvanceCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const id = useId()
  const can = useCan()
  const currency = useAuth().organization?.base_currency
  const save = useSaveStorefrontSettingsMutation()
  const [draft, setDraft] = useState<CodAdvanceDraft>(() => toCodAdvanceDraft(settings))
  const [errors, setErrors] = useState<ReturnType<typeof validateCodAdvance>>({})
  const set = (patch: Partial<CodAdvanceDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const input = codAdvanceChanges(draft, settings)
  const dirty = Object.keys(input).length > 0
  const ready = settings.cod_advance_ready ?? false
  const disabled = !canManage || save.isPending
  const mode = MODES.find((m) => m.value === draft.mode) ?? MODES[0]!

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found = validateCodAdvance(draft)
    setErrors(found)
    if (Object.keys(found).length > 0 || !dirty) return
    save.mutate(input, {
      onSuccess: (saved) => {
        setDraft(toCodAdvanceDraft(saved))
        toast.success(saved.cod_advance === 'off' || !saved.cod_advance ? 'Advance delivery charge turned off.' : 'Advance delivery charge saved.')
      },
      onError: (error) => {
        const map = fieldErrorMap(error)
        setErrors({
          fixed: map.cod_advance_fixed ?? map.cod_advance_amount,
          hours: map.cod_advance_hold_hours,
          form: map.cod_advance ?? map.form,
        })
      },
    })
  }

  return (
    <Card data-testid="cod-advance-card">
      <CardHeader>
        <CardTitle>Advance delivery charge for cash on delivery</CardTitle>
        <CardDescription>
          The customer pays the delivery charge by bKash, Nagad or Rocket Send Money after placing the order and the rest in cash on delivery — fewer fake
          orders and parcels sent back. Orders wait as “Awaiting payment” until you confirm the transaction ID; unpaid ones are cancelled. Orders your staff enter are never asked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label="Advance delivery charge">
          {!ready && (
            <p role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm" data-testid="cod-advance-not-ready">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Turn on bKash, Nagad or Rocket Send Money first
                {can('payment_gateways.manage') ? (
                  <> in <Link to="/storefront/payments" className="font-medium underline underline-offset-4">Payment methods</Link></>
                ) : null}
                . Until then no advance is asked.
              </span>
            </p>
          )}
          <fieldset className="flex flex-col gap-2" disabled={disabled}>
            <legend className="mb-1.5 text-sm font-medium">Ask for an advance</legend>
            <div className="flex flex-wrap gap-4">
              {MODES.map((m) => (
                <label key={m.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name={`${id}-mode`} className="size-4 accent-primary" checked={draft.mode === m.value} onChange={() => set({ mode: m.value })} />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{mode.hint}</p>
          </fieldset>
          {draft.mode !== 'off' && (
            <>
              <fieldset className="flex flex-col gap-2" disabled={disabled}>
                <legend className="mb-1.5 text-sm font-medium">Amount</legend>
                {AMOUNTS.map((a) => (
                  <label key={a.value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name={`${id}-amount`} className="size-4 accent-primary" checked={draft.amount === a.value} onChange={() => set({ amount: a.value })} />
                    {a.label}
                  </label>
                ))}
                <p className="text-sm text-muted-foreground">
                  {draft.amount === 'delivery' ? 'Orders with free delivery are not asked for an advance.' : 'Never more than the order total.'}
                </p>
              </fieldset>
              {draft.amount === 'fixed' && (
                <FormField label={`Fixed advance${currency ? ` (${currency})` : ''}`} error={errors.fixed}>
                  <Input inputMode="decimal" className="w-40 font-mono" disabled={disabled} value={draft.fixed} onChange={(e) => set({ fixed: e.target.value })} />
                </FormField>
              )}
            </>
          )}
          <FormField label="Hours to pay" error={errors.hours} hint="1–168 hours. Orders not paid by then are cancelled and their stock released.">
            <Input inputMode="numeric" className="w-32" disabled={disabled} value={draft.hours} onChange={(e) => set({ hours: e.target.value })} />
          </FormField>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          {canManage && (
            <Button type="submit" variant="outline" className="self-start" disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save advance settings
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
