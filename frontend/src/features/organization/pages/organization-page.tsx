import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AiSettingsCard } from '@/features/ai/components/ai-settings-card'
import { useCan } from '@/features/auth/use-auth'
import { useOrganizationQuery, useUpdateOrganizationMutation, type Organization } from '@/features/organization/api'
import { handleFormError } from '@/lib/forms'

const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(255),
  legal_name: z.string().trim().max(255),
  tax_number: z.string().trim().max(64),
  email: z.union([z.email('Invalid e-mail.'), z.literal('')]),
  phone: z.string().trim().max(32),
  address: z.string().trim().max(1000),
  timezone: z.string().trim().min(1, 'Required.'),
  tax_mode: z.enum(['exclusive', 'inclusive']),
  receipt_header: z.string().max(500),
  receipt_footer: z.string().max(500),
  invoice_prefix: z.string().max(10).regex(/^[A-Z0-9-]*$/, 'Uppercase letters, digits and - only.'),
})
type Values = z.infer<typeof schema>
const FIELDS = ['name', 'legal_name', 'tax_number', 'email', 'phone', 'address', 'timezone', 'tax_mode'] as const

function toValues(o: Organization): Values {
  return {
    name: o.name,
    legal_name: o.legal_name ?? '',
    tax_number: o.tax_number ?? '',
    email: o.email ?? '',
    phone: o.phone ?? '',
    address: o.address ?? '',
    timezone: o.timezone,
    tax_mode: o.tax_mode,
    receipt_header: o.settings.receipt_header ?? '',
    receipt_footer: o.settings.receipt_footer ?? '',
    invoice_prefix: o.settings.invoice_prefix ?? '',
  }
}

function OrganizationForm({ organization, readOnly }: { organization: Organization; readOnly: boolean }) {
  const update = useUpdateOrganizationMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(organization) })
  const { errors, isDirty } = form.formState
  const watchedTaxMode = useWatch({ control: form.control, name: 'tax_mode' })

  useEffect(() => form.reset(toValues(organization)), [organization, form])

  const onSubmit = form.handleSubmit(({ receipt_header, receipt_footer, invoice_prefix, ...v }) =>
    update.mutate(
      {
        ...v,
        legal_name: v.legal_name || null,
        tax_number: v.tax_number || null,
        email: v.email || null,
        phone: v.phone || null,
        address: v.address || null,
        settings: { receipt_header: receipt_header || null, receipt_footer: receipt_footer || null, invoice_prefix: invoice_prefix || null },
      },
      {
        onSuccess: () => toast.success('Organization settings saved.'),
        onError: (error) => handleFormError(error, form.setError, FIELDS),
      },
    ),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>Business profile</CardTitle>
            <CardDescription>Printed on invoices and receipts.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Trading name" error={errors.name?.message}><Input {...form.register('name')} /></FormField>
            <FormField label="Legal name" error={errors.legal_name?.message}><Input {...form.register('legal_name')} /></FormField>
            <FormField label="Tax / VAT registration no." error={errors.tax_number?.message}><Input {...form.register('tax_number')} /></FormField>
            <FormField label="E-mail" error={errors.email?.message}><Input type="email" {...form.register('email')} /></FormField>
            <FormField label="Phone" error={errors.phone?.message}><Input type="tel" {...form.register('phone')} /></FormField>
            <FormField label="Timezone" error={errors.timezone?.message}><Input {...form.register('timezone')} /></FormField>
            <FormField label="Address" error={errors.address?.message} className="sm:col-span-2"><Textarea rows={2} {...form.register('address')} /></FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing & tax</CardTitle>
            <CardDescription>Base currency is fixed at sign-up ({organization.base_currency}) to protect historical amounts.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Catalogue prices" error={errors.tax_mode?.message}>
              <Select value={watchedTaxMode} onValueChange={(v) => form.setValue('tax_mode', v as Values['tax_mode'], { shouldDirty: true })} disabled={readOnly}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclusive">Exclude tax (tax added at checkout)</SelectItem>
                  <SelectItem value="inclusive">Include tax</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Base currency"><Input value={organization.base_currency} disabled readOnly /></FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Invoice number prefix" error={errors.invoice_prefix?.message}><Input className="uppercase" {...form.register('invoice_prefix', { setValueAs: (v: string) => v.toUpperCase() })} /></FormField>
            <div className="hidden sm:block" />
            <FormField label="Receipt header" error={errors.receipt_header?.message}><Textarea rows={3} {...form.register('receipt_header')} /></FormField>
            <FormField label="Receipt footer" error={errors.receipt_footer?.message}><Textarea rows={3} {...form.register('receipt_footer')} /></FormField>
          </CardContent>
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={!isDirty || update.isPending} onClick={() => form.reset(toValues(organization))}>Discard</Button>
          <Button type="submit" disabled={!isDirty || update.isPending}>
            {update.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save settings
          </Button>
        </div>
      )}
    </form>
  )
}

function OrganizationSettings() {
  const can = useCan()
  const { data, error, isPending, refetch } = useOrganizationQuery()

  return isPending ? (
    <LoadingState rows={6} label="Loading organization" />
  ) : error ? (
    <ErrorState error={error} onRetry={() => refetch()} />
  ) : (
    <OrganizationForm organization={data} readOnly={!can('organization.update')} />
  )
}

/** Organization profile (organization.view) and the AI assistant card (ai.manage, Phase 8). */
export function OrganizationPage() {
  const can = useCan()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title="Organization" description="Profile, tax mode and receipt settings for every branch." />
      {can('organization.view') && <OrganizationSettings />}
      {can('ai.manage') && <AiSettingsCard />}
    </div>
  )
}
