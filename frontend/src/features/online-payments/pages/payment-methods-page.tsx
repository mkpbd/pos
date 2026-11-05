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
import { DISPLAY_NAME_MAX, GATEWAY_COPY, GATEWAY_FIELDS, gatewaySchema, INSTRUCTIONS_MAX, OFFLINE_CODES, toGatewayInput, toGatewayValues, type GatewayValues } from '@/features/online-payments/gateway-form'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { handleTranslatedFormError, rhfBnErrors } from '@/features/translations/translations'

function GatewayCard({ gateway, currency }: { gateway: PaymentGateway; currency: string | undefined }) {
  const save = useSavePaymentGatewayMutation()
  const code = gateway.code as (typeof OFFLINE_CODES)[number]
  const copy = GATEWAY_COPY[code]
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
        onError: (error) => handleTranslatedFormError(error, form.setError, GATEWAY_FIELDS),
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
            <Label htmlFor={switchId}>Offer {copy.title.toLowerCase()} at checkout</Label>
          </div>
          <FormField label="Name at checkout" error={errors.display_name?.message}>
            <Input maxLength={DISPLAY_NAME_MAX} {...form.register('display_name')} />
          </FormField>
          <FormField label="Instructions" error={errors.instructions?.message} hint={copy.instructionsHint}>
            <Textarea rows={code === 'bank_transfer' ? 5 : 3} maxLength={INSTRUCTIONS_MAX} {...form.register('instructions')} />
          </FormField>
          {code === 'bank_transfer' && (
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
            Save {copy.title.toLowerCase()}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function PaymentMethodsPage() {
  const me = useAuth()
  const gateways = usePaymentGatewaysQuery()
  const offline = OFFLINE_CODES.map((code) => gateways.data?.find((g) => g.code === code)).filter((g): g is PaymentGateway => !!g)

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
        <div className="grid gap-6 lg:grid-cols-2">
          {offline.map((g) => <GatewayCard key={g.code} gateway={g} currency={me.organization?.base_currency} />)}
        </div>
      )}
    </div>
  )
}
