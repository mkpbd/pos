import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { LogOutIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { authKeys, useLogoutMutation } from '@/features/auth/api'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { TwoFactorSetupFlow } from '@/features/auth/components/two-factor-setup-flow'
import { safeRedirect } from '@/features/auth/redirect'
import { useTwoFactorStatusQuery } from '@/features/auth/two-factor-api'
import { useAuth } from '@/features/auth/use-auth'

/**
 * /two-factor/setup (G1a) — full screen, outside the admin shell. The only screen open while the
 * organization requires two-factor sign-in and it is off (RequireAuth sends the user here).
 */
export function TwoFactorSetupPage() {
  const me = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const status = useTwoFactorStatusQuery()
  const logout = useLogoutMutation()
  // Once the flow is showing it stays: confirming turns two-factor on (the status refetches as
  // enabled) while the recovery codes still have to be shown.
  const [flowShown, setFlowShown] = useState(false)
  if (status.data && !status.data.enabled && !flowShown) setFlowShown(true)

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => navigate('/login', { replace: true }),
      onError: () => toast.error('Signed out locally. The server session could not be closed.'),
    })

  const continueToApp = async () => {
    // The fresh session summary (setup no longer required) must be in place before leaving, or the
    // gate would send the user straight back here.
    await queryClient.invalidateQueries({ queryKey: authKeys.me })
    navigate(safeRedirect(params.get('redirect')), { replace: true })
  }

  const required = status.data?.required ?? me.two_factor?.required ?? false
  const organization = me.organization?.name ?? 'Your organization'

  return (
    <AuthLayout
      title="Set up two-factor sign-in"
      description={required ? `${organization} requires two-factor sign-in for your account. Set it up to continue.` : 'Add a code from your phone to every sign-in.'}
      actions={
        <Button variant="ghost" size="sm" onClick={signOut} disabled={logout.isPending}>
          <LogOutIcon data-icon="inline-start" /> Sign out
        </Button>
      }
    >
      {status.isPending ? (
        <LoadingState rows={3} label="Loading two-factor status" />
      ) : status.error ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : status.data.enabled && !flowShown ? (
        <AlreadyOn onContinue={() => void continueToApp()} />
      ) : (
        <TwoFactorSetupFlow doneLabel="Continue to the app" onDone={() => void continueToApp()} />
      )}
    </AuthLayout>
  )
}

function AlreadyOn({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="flex items-center gap-2 text-sm">
        <ShieldCheckIcon className="size-4 text-success" aria-hidden /> Two-factor sign-in is on for your account.
      </p>
      <Button onClick={onContinue}>Continue to the app</Button>
    </div>
  )
}
