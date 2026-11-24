import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/use-auth'
import { usePaymentGatewaysQuery, useSavePaymentGatewayMutation, type PaymentGateway } from '@/features/online-payments/api'
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  DISPLAY_NAME_MAX,
  flattenSettingsErrors,
  GATEWAY_COPY,
  GATEWAY_FIELDS,
  gatewaySchema,
  INSTRUCTIONS_MAX,
  isSendMoneyCode,
  OFFLINE_CODES,
  SEND_MONEY_CODES,
  toGatewayInput,
  toGatewayValues,
  type ConfiguredCode,
  type GatewayValues,
} from '@/features/online-payments/gateway-form'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { handleTranslatedFormError, rhfBnErrors } from '@/features/translations/translations'

function GatewayCard({ gateway, currency }: { gateway: PaymentGateway; currency: string | undefined }) {
  const save = useSavePaymentGatewayMutation()
  const code = gateway.code as ConfiguredCode
  const copy = GATEWAY_COPY[code]
  const sendMoney = isSendMoneyCode(code)
  // "bKash (Send Money)" keeps its capitals; "cash on delivery" reads as a phrase.
  const name = sendMoney ? copy.title : copy.title.toLowerCase()
  const form = useForm<GatewayValues>({ resolver: zodResolver(gatewaySchema), defaultValues: toGatewayValues(gateway) })
  const { errors, isDirty } = form.formState
  const [enabled, displayName, instructions] = useWatch({ control: form.control, name: ['is_enabled', 'display_name', 'instructions'] })
  const switchId = `gateway-${code}-enabled`

  useEffect(() => {
    form.reset(toGatewayValues(gateway))
  }, [gateway, form])

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { code: gateway.code, input: toGatewayInput(gateway, values) },
      {
        onSuccess: (saved) => toast.success(`${copy.title} ${saved.is_enabled ? 'saved and offered at checkout' : 'saved (not offered at checkout)'}.`),
        onError: (error) => handleTranslatedFormError(flattenSettingsErrors(error), form.setError, GATEWAY_FIELDS),
      },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {copy.title}
          <Badge variant={gateway.is_enabled ? 'success' : 'outline'}>{gateway.is_enabled ? 'Enabled' : 'Disabled'}</Badge>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={`${copy.title} settings`}>
          <div className="flex items-center gap-2">
            <Switch id={switchId} checked={enabled} onCheckedChange={(v) => form.setValue('is_enabled', v, { shouldDirty: true })} />
            <Label htmlFor={switchId}>Offer {name} at checkout</Label>
          </div>
          <FormField label="Name at checkout" error={errors.display_name?.message}>
            <Input maxLength={DISPLAY_NAME_MAX} {...form.register('display_name')} />
          </FormField>
          {sendMoney && (
            <>
              <FormField label="Receiving number" error={errors.account_number?.message} hint="The number customers send the money to. It is shown to every customer who chooses this method.">
                <Input inputMode="tel" autoComplete="off" className="w-48 font-mono" maxLength={20} placeholder="01XXXXXXXXX" {...form.register('account_number')} />
              </FormField>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Account type</legend>
                <div className="flex flex-wrap gap-4">
                  {ACCOUNT_TYPES.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="radio" value={t} className="size-4 accent-primary" {...form.register('account_type')} />
                      {ACCOUNT_TYPE_LABELS[t]}
                    </label>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Customers use “Send Money” for a personal number and “Cash Out” or “Payment” for agent and merchant numbers.</p>
              </fieldset>
            </>
          )}
          <FormField label="Instructions" error={errors.instructions?.message} hint={copy.instructionsHint}>
            <Textarea rows={code === 'bank_transfer' ? 5 : 3} maxLength={INSTRUCTIONS_MAX} {...form.register('instructions')} />
          </FormField>
          {(code === 'bank_transfer' || sendMoney) && (
            <FormField label="Hold unpaid orders for (hours)" error={errors.hold_hours?.message} hint="1–168 hours. The stock stays reserved meanwhile.">
              <Input inputMode="numeric" className="w-32" {...form.register('hold_hours')} />
            </FormField>
          )}
          {code === 'cod' && (
            <FormField label={`Maximum order total${currency ? ` (${currency})` : ''}`} error={errors.max_order_total?.message} hint="Leave empty for no limit. Larger orders must pay another way.">
              <Input inputMode="decimal" className="w-40 font-mono" {...form.register('max_order_total')} />
            </FormField>
          )}
          <Controller control={form.control} name="translations.bn" render={({ field }) => (
            <BanglaTranslations
              fields={[
                { name: 'display_name', label: 'Name at checkout', base: displayName, max: DISPLAY_NAME_MAX },
                { name: 'instructions', label: 'Instructions', base: instructions, kind: 'textarea', rows: code === 'bank_transfer' ? 5 : 3, max: INSTRUCTIONS_MAX },
              ]}
              value={field.value}
              onChange={field.onChange}
              errors={rhfBnErrors(errors.translations)}
            />
          )} />
          <Button type="submit" className="self-start" disabled={save.isPending || !isDirty}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save {name}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function PaymentMethodsPage() {
  const me = useAuth()
  const gateways = usePaymentGatewaysQuery()
  const find = (codes: readonly string[]) => codes.map((code) => gateways.data?.find((g) => g.code === code)).filter((g): g is PaymentGateway => !!g)
  const offline = find(OFFLINE_CODES)
  const basic = find(['cod', 'bank_transfer'])
  const sendMoney = find(SEND_MONEY_CODES)

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <p className="max-w-2xl text-sm text-muted-foreground">How customers can pay for online orders. At least one method must be enabled for checkout to work.</p>
      {gateways.isPending ? (
        <LoadingState rows={4} label="Loading payment methods" />
      ) : gateways.error ? (
        <ErrorState error={gateways.error} onRetry={() => gateways.refetch()} />
      ) : offline.length === 0 ? (
        <EmptyState title="No payment methods" />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {basic.map((g) => <GatewayCard key={g.code} gateway={g} currency={me.organization?.base_currency} />)}
          </div>
          {sendMoney.length > 0 && (
            <section aria-labelledby="send-money-heading" className="flex flex-col gap-4">
              <div>
                <h2 id="send-money-heading" className="text-lg font-semibold">bKash, Nagad and Rocket — Send Money</h2>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  No payment gateway needed: customers send the money to your number and type the transaction ID. The order waits as “Awaiting payment” with a
                  “TrxID sent” mark in Web orders until you confirm the payment there. Also used for the advance delivery charge on cash on delivery orders.
                </p>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                {sendMoney.map((g) => <GatewayCard key={g.code} gateway={g} currency={me.organization?.base_currency} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
