import { useId, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useUpdateOrganizationMutation, type Organization, type TwoFactorPolicy } from '@/features/organization/api'

const POLICIES: { value: TwoFactorPolicy; label: string; help: string }[] = [
  { value: 'optional', label: 'Optional', help: 'Everyone can turn two-factor sign-in on for themselves from their profile.' },
  {
    value: 'admins',
    label: 'Required for admins',
    help: 'People who can manage users, roles or organization settings must use it. Others can choose.',
  },
  { value: 'everyone', label: 'Required for everyone', help: 'Every staff account must use it, including till and warehouse staff.' },
]

const STRICTNESS: Record<TwoFactorPolicy, number> = { optional: 0, admins: 1, everyone: 2 }

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Organization → Security (G1a, organization.update): who must use two-factor sign-in, with how
 * many people already do. Tightening the policy asks for confirmation first.
 */
export function SecurityCard({ organization }: { organization: Organization }) {
  const update = useUpdateOrganizationMutation()
  const saved = organization.settings.two_factor_policy ?? 'optional'
  const [policy, setPolicy] = useState<TwoFactorPolicy>(saved)
  const [confirming, setConfirming] = useState(false)
  const selectId = useId()
  const helpId = `${selectId}-help`
  const summary = organization.two_factor_summary
  const selected = POLICIES.find((p) => p.value === policy) ?? POLICIES[0]!

  // Follow the saved policy when it changes elsewhere (another tab, a refetch).
  const [lastSaved, setLastSaved] = useState(saved)
  if (saved !== lastSaved) {
    setLastSaved(saved)
    setPolicy(saved)
  }

  const save = () =>
    update.mutate(
      { settings: { two_factor_policy: policy } },
      {
        onSuccess: () => {
          setConfirming(false)
          toast.success('Two-factor policy saved.')
        },
        onError: (error) => {
          setConfirming(false)
          toast.error(error.message)
        },
      },
    )

  const onSave = () => (STRICTNESS[policy] > STRICTNESS[saved] ? setConfirming(true) : save())

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Two-factor sign-in asks for a 6-digit code from a phone app after the password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex max-w-md flex-col gap-1.5">
          <Label htmlFor={selectId}>Two-factor sign-in</Label>
          <Select value={policy} onValueChange={(v) => setPolicy(v as TwoFactorPolicy)}>
            <SelectTrigger id={selectId} aria-describedby={helpId} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {POLICIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p id={helpId} className="text-sm text-muted-foreground">{selected.help}</p>
        </div>
        {summary && (
          <dl aria-label="Two-factor sign-in in your organization" className="grid grid-cols-1 gap-2 text-sm min-[420px]:grid-cols-3">
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Staff accounts</dt>
              <dd className="text-lg font-semibold">{summary.users}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Two-factor on</dt>
              <dd className="text-lg font-semibold">{summary.enabled}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Required, not set up</dt>
              <dd className={summary.required_missing > 0 ? 'text-lg font-semibold text-warning-soft-foreground' : 'text-lg font-semibold'}>{summary.required_missing}</dd>
            </div>
          </dl>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={policy === saved || update.isPending} onClick={() => setPolicy(saved)}>Discard</Button>
          <Button type="button" disabled={policy === saved || update.isPending} onClick={onSave}>
            {update.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save security settings
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={policy === 'everyone' ? 'Require two-factor sign-in for everyone?' : 'Require two-factor sign-in for admins?'}
        description={
          <>
            People this covers who haven’t set it up
            {summary && policy === 'everyone' ? ` (${plural(summary.users - summary.enabled, 'person', 'people')} today)` : ''} must do so the next time
            they use the app, and their devices stop working until they do. Make sure they have a phone with an authenticator app.
          </>
        }
        confirmLabel="Require it"
        destructive={false}
        pending={update.isPending}
        onConfirm={save}
      />
    </Card>
  )
}
