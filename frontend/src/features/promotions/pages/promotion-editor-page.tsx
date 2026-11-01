import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, InfoIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import {
  PROMOTION_SCOPES,
  PROMOTION_TYPES,
  useDeletePromotionMutation,
  usePromotionQuery,
  useSavePromotionMutation,
  type Promotion,
  type PromotionScope,
  type PromotionTrigger,
  type PromotionType,
} from '@/features/promotions/api'
import { CouponsPanel } from '@/features/promotions/components/coupons-panel'
import { RedemptionsPanel } from '@/features/promotions/components/redemptions-panel'
import { ReportPanel } from '@/features/promotions/components/report-panel'
import { TargetPicker } from '@/features/promotions/components/target-picker'
import {
  APPLICATION_RULE,
  countdownAllowed,
  isInUse,
  isProductScope,
  offerLabel,
  promotionErrorMap,
  SCOPE_LABELS,
  stateBadge,
  toDraft,
  toInput,
  TYPE_LABELS,
  validateDraft,
  type PromotionDraft,
} from '@/features/promotions/promotions'

type Errors = Record<string, string>

/** Error keys the form shows next to a field; anything else is listed above the form. */
const SHOWN = new Set(['name', 'description', 'type', 'value', 'scope', 'target_ids', 'min_subtotal', 'max_discount', 'trigger', 'starts_at', 'ends_at', 'show_countdown', 'usage_limit', 'usage_limit_per_customer', 'form'])

const TABS = ['details', 'coupons', 'redemptions', 'report'] as const
type Tab = (typeof TABS)[number]

function DetailsForm({ promotion, readOnly, onSaved }: { promotion?: Promotion; readOnly: boolean; onSaved: (saved: Promotion) => void }) {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency ?? ''
  const save = useSavePromotionMutation()
  const [draft, setDraft] = useState<PromotionDraft>(() => toDraft(promotion, timeZone))
  const [errors, setErrors] = useState<Errors>({})
  const set = (patch: Partial<PromotionDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch }
      if (next.type === 'free_shipping' && next.scope !== 'order') Object.assign(next, { scope: 'order', targets: [] })
      if (!countdownAllowed(next)) next.showCountdown = false
      return next
    })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly || save.isPending) return
    const local = validateDraft(draft)
    if (Object.keys(local).length > 0) {
      setErrors(local)
      toast.error('Please correct the highlighted fields.')
      return
    }
    setErrors({})
    save.mutate(
      { id: promotion?.id, input: toInput(draft, timeZone) },
      {
        onSuccess: (saved) => {
          setDraft(toDraft(saved, timeZone))
          onSaved(saved)
        },
        onError: (error) => {
          const map = promotionErrorMap(error)
          setErrors(map)
          toast.error(map.form ?? 'Please correct the highlighted fields.')
        },
      },
    )
  }

  const productScope = isProductScope(draft.scope)
  const allowed = countdownAllowed(draft)
  const other = Object.entries(errors).filter(([key]) => !SHOWN.has(key))

  return (
    <form id="promotion-form" noValidate onSubmit={submit}>
      <fieldset disabled={readOnly || save.isPending} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <legend className="sr-only">Promotion details</legend>
        <div className="flex flex-col gap-6">
          {(errors.form || other.length > 0) && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {errors.form && <p>{errors.form}</p>}
              {other.map(([key, message]) => <p key={key}>{message}</p>)}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Offer</CardTitle>
              <CardDescription>What the shopper gets and on what.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Name" error={errors.name} hint="Shown to shoppers on cards, in the cart and on the order.">
                <Input maxLength={80} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </FormField>
              <FormField label="Description" error={errors.description} hint={`Optional, shown to shoppers, e.g. “10% off juices”. ${draft.description.length}/200`}>
                <Textarea maxLength={200} rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Discount type" error={errors.type}>
                  <Select value={draft.type} onValueChange={(v) => set({ type: v as PromotionType })}>
                    <SelectTrigger className="w-full" aria-label="Discount type"><SelectValue /></SelectTrigger>
                    <SelectContent>{PROMOTION_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
                {draft.type !== 'free_shipping' && (
                  <FormField
                    label={draft.type === 'percent' ? 'Percentage off (%)' : `Amount off (${currency})`}
                    error={errors.value}
                    hint={draft.type === 'percent' ? '0.01 to 100.' : productScope ? 'Per unit; never more than the item costs.' : 'Taken off the order subtotal.'}
                  >
                    <Input inputMode="decimal" value={draft.value} onChange={(e) => set({ value: e.target.value })} />
                  </FormField>
                )}
              </div>
              <FormField label="Applies to" error={errors.scope} hint={draft.type === 'free_shipping' ? 'Free shipping always applies to the whole order. The cash-on-delivery fee is still charged.' : undefined}>
                <Select value={draft.scope} disabled={draft.type === 'free_shipping' || readOnly} onValueChange={(v) => set({ scope: v as PromotionScope, targets: [] })}>
                  <SelectTrigger className="w-full sm:w-72" aria-label="Applies to"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROMOTION_SCOPES.map((s) => <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
              {draft.scope !== 'order' && (
                <TargetPicker key={draft.scope} scope={draft.scope} value={draft.targets} onChange={(targets) => set({ targets })} disabled={readOnly} error={errors.target_ids} />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label={`Minimum subtotal (${currency})`}
                  error={errors.min_subtotal}
                  hint={productScope ? 'Optional. Subtotal of the matching items, before discounts.' : 'Optional. Cart subtotal before discounts.'}
                >
                  <Input inputMode="decimal" value={draft.minSubtotal} onChange={(e) => set({ minSubtotal: e.target.value })} />
                </FormField>
                {draft.type === 'percent' && (
                  <FormField label={`Maximum discount (${currency})`} error={errors.max_discount} hint="Optional cap per order.">
                    <Input inputMode="decimal" value={draft.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} />
                  </FormField>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>How shoppers get it</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField
                label="Trigger"
                error={errors.trigger}
                hint={draft.trigger === 'coupon' ? (promotion ? 'Shoppers enter one of its codes in the cart. Manage codes on the Coupons tab.' : 'Shoppers enter a code in the cart. Add codes after creating the promotion.') : 'Applies by itself to every qualifying cart.'}
              >
                <Select value={draft.trigger} onValueChange={(v) => set({ trigger: v as PromotionTrigger })}>
                  <SelectTrigger className="w-full" aria-label="Trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automatic</SelectItem>
                    <SelectItem value="coupon">Coupon code</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <div className="flex items-center gap-2">
                <Switch id="promotion-active" checked={draft.isActive} onCheckedChange={(isActive) => set({ isActive })} />
                <Label htmlFor="promotion-active">Active</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <CardDescription>Optional. Times are in {timeZone ?? 'local time'}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Starts" error={errors.starts_at} hint="Empty: right away.">
                <Input type="datetime-local" value={draft.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
              </FormField>
              <FormField label="Ends" error={errors.ends_at} hint="Empty: until you switch it off.">
                <Input type="datetime-local" value={draft.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
              </FormField>
              {allowed ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Switch id="promotion-countdown" checked={draft.showCountdown} onCheckedChange={(showCountdown) => set({ showCountdown })} />
                    <Label htmlFor="promotion-countdown">Flash sale countdown</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">Shows a countdown to the end on product cards and pages, and lists the offer in hot-deals sections.</p>
                  {errors.show_countdown && <p className="text-sm text-destructive">{errors.show_countdown}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="countdown-unavailable">
                  A flash-sale countdown is available for automatic product, category or brand offers with an end time.
                  {errors.show_countdown && <span className="block text-destructive">{errors.show_countdown}</span>}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage limits</CardTitle>
              <CardDescription>Optional. Counted when orders are placed.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Total uses" error={errors.usage_limit} hint="Empty: no limit.">
                <Input inputMode="numeric" value={draft.usageLimit} onChange={(e) => set({ usageLimit: e.target.value })} />
              </FormField>
              <FormField label="Uses per customer" error={errors.usage_limit_per_customer} hint="Counted by customer account, or by e-mail for guests.">
                <Input inputMode="numeric" value={draft.usageLimitPerCustomer} onChange={(e) => set({ usageLimitPerCustomer: e.target.value })} />
              </FormField>
            </CardContent>
          </Card>
        </div>
      </fieldset>
    </form>
  )
}

function DeleteAction({ promotion }: { promotion: Promotion }) {
  const navigate = useNavigate()
  const remove = useDeletePromotionMutation()
  const save = useSavePromotionMutation()
  const [step, setStep] = useState<'confirm' | 'in_use' | null>(null)

  return (
    <>
      <Button type="button" variant="ghost" className="text-destructive" onClick={() => setStep('confirm')}>
        <Trash2Icon data-icon="inline-start" /> Delete
      </Button>
      <ConfirmDialog
        open={step === 'confirm'}
        onOpenChange={(open) => !open && setStep(null)}
        title="Delete this promotion?"
        description="Shoppers stop getting it right away. A promotion that orders have already used cannot be deleted; you can deactivate it instead."
        confirmLabel="Delete promotion"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(promotion.id, {
            onSuccess: () => {
              toast.success(`${promotion.name} deleted.`)
              void navigate('/promotions')
            },
            onError: (error) => {
              if (isInUse(error)) return setStep('in_use')
              setStep(null)
              toast.error(error.message)
            },
          })
        }
      />
      <ConfirmDialog
        open={step === 'in_use'}
        onOpenChange={(open) => !open && setStep(null)}
        title="This promotion has been used"
        description={promotion.is_active ? 'Orders received it, so it stays for the record. Deactivate it so shoppers no longer get it?' : 'Orders received it, so it stays for the record. It is already inactive.'}
        confirmLabel={promotion.is_active ? 'Deactivate' : 'Close'}
        destructive={false}
        pending={save.isPending}
        onConfirm={() => {
          if (!promotion.is_active) return setStep(null)
          save.mutate(
            { id: promotion.id, input: { is_active: false } },
            {
              onSuccess: () => {
                toast.success(`${promotion.name} deactivated.`)
                setStep(null)
              },
              onError: (error) => toast.error(error.message),
            },
          )
        }}
      />
    </>
  )
}

function PromotionView({ promotion }: { promotion?: Promotion }) {
  const me = useAuth()
  const can = useCan()
  const navigate = useNavigate()
  const canManage = can('promotions.manage')
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab') as Tab | null
  const hasCoupons = promotion?.trigger === 'coupon'
  const tab: Tab = promotion && requested && TABS.includes(requested) && (requested !== 'coupons' || hasCoupons) ? requested : 'details'
  const badge = promotion ? stateBadge(promotion.state) : null
  const onSaved = (saved: Promotion) => {
    if (promotion) {
      toast.success('Promotion saved.')
      return
    }
    toast.success(saved.trigger === 'coupon' ? 'Promotion created. Now add its coupon codes.' : 'Promotion created.')
    void navigate(`/promotions/${saved.id}${saved.trigger === 'coupon' ? '?tab=coupons' : ''}`, { replace: true })
  }

  const form = <DetailsForm promotion={promotion} readOnly={!canManage} onSaved={onSaved} />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={promotion ? promotion.name : 'New promotion'}
        description={promotion ? `${offerLabel(promotion.type, promotion.value, me.organization?.base_currency)} · ${SCOPE_LABELS[promotion.scope] ?? promotion.scope}` : 'A discount, free shipping or coupon offer for the online store.'}
        actions={
          <>
            {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
            <Button asChild variant="ghost">
              <Link to="/promotions"><ArrowLeftIcon data-icon="inline-start" /> All promotions</Link>
            </Button>
            {promotion && canManage && tab === 'details' && <DeleteAction promotion={promotion} />}
            {canManage && tab === 'details' && (
              <Button type="submit" form="promotion-form">
                {promotion ? 'Save promotion' : 'Create promotion'}
              </Button>
            )}
          </>
        }
      />

      <p role="note" className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{APPLICATION_RULE}</span>
      </p>

      {promotion ? (
        <Tabs value={tab} onValueChange={(v) => setSearchParams(v === 'details' ? {} : { tab: v }, { replace: true })}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            {hasCoupons && <TabsTrigger value="coupons">Coupons ({promotion.coupon_count})</TabsTrigger>}
            <TabsTrigger value="redemptions">Redemptions ({promotion.redemption_count})</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="pt-2">{form}</TabsContent>
          {hasCoupons && <TabsContent value="coupons" className="pt-2"><CouponsPanel promotion={promotion} canManage={canManage} /></TabsContent>}
          <TabsContent value="redemptions" className="pt-2"><RedemptionsPanel promotion={promotion} /></TabsContent>
          <TabsContent value="report" className="pt-2"><ReportPanel promotion={promotion} /></TabsContent>
        </Tabs>
      ) : (
        form
      )}
    </div>
  )
}

export function PromotionEditorPage() {
  const { promotionId } = useParams()
  const query = usePromotionQuery(promotionId)

  if (!promotionId) return <PromotionView />
  if (query.isPending) return <LoadingState label="Loading promotion" />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return <PromotionView key={query.data.id} promotion={query.data} />
}

