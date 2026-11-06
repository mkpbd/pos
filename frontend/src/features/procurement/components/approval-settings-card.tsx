import { useEffect } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/features/auth/use-auth'
import { useApprovalSettingsQuery, useSaveApprovalSettingsMutation, type ApprovalSettings } from '@/features/procurement/api'
import { handleFormError } from '@/lib/forms'
import { compareDecimal, formatMoney, MONEY_PATTERN, trimDecimal } from '@/lib/money'

const amount = z.string().trim().regex(MONEY_PATTERN, 'An amount with up to 2 decimals.')

const schema = z
  .object({ auto_approve_limit: amount, manager_limit: amount, require_po_approval: z.boolean() })
  .refine((v) => !MONEY_PATTERN.test(v.auto_approve_limit) || !MONEY_PATTERN.test(v.manager_limit) || compareDecimal(v.auto_approve_limit, v.manager_limit) <= 0, {
    path: ['manager_limit'],
    message: 'Must be at least the auto-approve limit.',
  })
type Values = z.infer<typeof schema>

const toValues = (s: ApprovalSettings | undefined): Values => ({
  auto_approve_limit: trimDecimal(s?.auto_approve_limit ?? '10000.00'),
  manager_limit: trimDecimal(s?.manager_limit ?? '100000.00'),
  require_po_approval: s?.require_po_approval ?? true,
})

/** Purchasing → Settings: amount tiers that decide who approves requisitions and purchase orders. */
export function ApprovalSettingsCard() {
  const me = useAuth()
  const settings = useApprovalSettingsQuery()
  const save = useSaveApprovalSettingsMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(undefined) })
  const { errors, isDirty } = form.formState
  const currency = settings.data?.currency ?? me.organization?.base_currency
  const autoLimit = useWatch({ control: form.control, name: 'auto_approve_limit' })

  useEffect(() => {
    if (settings.data) form.reset(toValues(settings.data))
  }, [settings.data, form])

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      { auto_approve_limit: v.auto_approve_limit.trim(), manager_limit: v.manager_limit.trim(), require_po_approval: v.require_po_approval },
      {
        onSuccess: (saved) => {
          form.reset(toValues(saved))
          toast.success('Approval limits saved.')
        },
        onError: (e) => handleFormError(e, form.setError, ['auto_approve_limit', 'manager_limit', 'require_po_approval']),
      },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval limits</CardTitle>
        <CardDescription>
          The estimated total incl. tax ({currency}) decides who approves a requisition or purchase order. One approval completes it; nobody approves their own document.
        </CardDescription>
      </CardHeader>
      {settings.isPending ? (
        <CardContent><LoadingState rows={3} label="Loading approval limits" /></CardContent>
      ) : settings.error ? (
        <CardContent><ErrorState error={settings.error} onRetry={() => settings.refetch()} /></CardContent>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label={`Auto-approve up to (${currency})`} error={errors.auto_approve_limit?.message} hint="At or below: approved on submit, no approver needed.">
              <Input inputMode="decimal" {...form.register('auto_approve_limit')} />
            </FormField>
            <FormField label={`Manager approves up to (${currency})`} error={errors.manager_limit?.message} hint="Above the auto limit up to this: a branch approver. Above: a high-value approver.">
              <Input inputMode="decimal" {...form.register('manager_limit')} />
            </FormField>
            <div className="flex items-start gap-3 sm:col-span-2">
              <Controller
                control={form.control}
                name="require_po_approval"
                render={({ field }) => <Switch id="require-po-approval" checked={field.value} onCheckedChange={field.onChange} />}
              />
              <Label htmlFor="require-po-approval" className="flex flex-col items-start gap-0.5 font-normal">
                <span>Purchase orders need approval</span>
                <span className="text-xs text-muted-foreground">
                  Orders above {formatMoney(autoLimit || '0', currency)} wait for approval before they are placed, unless they come from an approved requisition within its amount.
                </span>
              </Label>
            </div>
          </CardContent>
          <CardFooter className="justify-end pt-4">
            <Button type="submit" disabled={save.isPending || !isDirty}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save limits
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
