import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { ArrowLeftIcon, Loader2Icon, UserRoundIcon } from 'lucide-react'
import { ErrorState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { useCartStore } from '@/features/pos/cart-store'
import { PinPad, PinProblemMessage } from '@/features/pos/components/pin-pad'
import { usePinProblem } from '@/features/pos/till-helpers'
import { useTillLockStore } from '@/features/pos/till-lock'
import { pinProblem, usePinSignInMutation, useTillTerminalQuery } from '@/features/pos/till-api'
import { useSessionStore } from '@/stores/session-store'

/** Where the password sign-in sends the cashier back to (the till). */
export const PASSWORD_SIGN_IN_PATH = '/login?method=password&redirect=%2Fpos'

/**
 * POS1a: sign in on a till with a user tile and a PIN (no e-mail or password). Only on a device
 * set up as a till; anywhere else it sends people to the password sign-in.
 */
export function TillSignInPage() {
  const navigate = useNavigate()
  const terminal = useTillTerminalQuery()
  const signIn = usePinSignInMutation()
  const setActiveBranch = useSessionStore((s) => s.setActiveBranch)
  const unlock = useTillLockStore((s) => s.unlock)
  const [userId, setUserId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const problem = usePinProblem()

  if (terminal.isPending) {
    return (
      <AuthLayout title="Till sign-in">
        <div role="status" aria-label="Loading till" className="flex justify-center py-6"><Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden /></div>
      </AuthLayout>
    )
  }
  if (terminal.error) {
    return (
      <AuthLayout title="Till sign-in">
        <ErrorState title="Could not load this till" error={terminal.error} onRetry={() => terminal.refetch()} />
      </AuthLayout>
    )
  }
  const till = terminal.data
  if (!till) return <Navigate to={PASSWORD_SIGN_IN_PATH} replace />

  const user = till.users.find((u) => u.id === userId) ?? null

  const choose = (id: string | null) => {
    setUserId(id)
    setPin('')
    problem.show(null)
  }

  const submit = (value: string) => {
    if (!user || signIn.isPending) return
    problem.show(null)
    signIn.mutate(
      { user_id: user.id, pin: value },
      {
        onSuccess: () => {
          unlock()
          // Sell from this till's branch and store.
          setActiveBranch(till.store.branch_id)
          useCartStore.getState().update(till.store.branch_id, (c) => (c.lines.length === 0 ? { ...c, storeId: till.store.id } : c))
          navigate('/pos', { replace: true })
        },
        onError: (error) => {
          setPin('')
          problem.show(pinProblem(error))
        },
      },
    )
  }

  return (
    <AuthLayout
      title={user ? `Hello, ${user.name}` : 'Who is selling?'}
      description={<>{till.name} · {till.store.name}</>}
      footer={
        <Link to={PASSWORD_SIGN_IN_PATH} className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in with e-mail and password
        </Link>
      }
    >
      {!user ? (
        till.users.length === 0 ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Nobody can sign in on this till with a PIN yet. Cashiers set their till PIN under Profile & security.
          </p>
        ) : (
          <div role="group" aria-label="Cashiers" className="grid grid-cols-2 gap-2">
            {till.users.map((u) => (
              <Button key={u.id} type="button" variant="outline" className="h-16 flex-col gap-1" onClick={() => choose(u.id)}>
                <UserRoundIcon aria-hidden />
                <span className="truncate">{u.name}</span>
              </Button>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">Enter your till PIN.</p>
          <PinPad value={pin} onChange={setPin} onSubmit={submit} submitLabel="Sign in" pending={signIn.isPending} disabled={problem.lockedOut} />
          <PinProblemMessage problem={problem.problem} lockedOut={problem.lockedOut} secondsLeft={problem.secondsLeft}>
            {problem.problem?.passwordOnly && (
              <div className="mt-1">
                <Link to={PASSWORD_SIGN_IN_PATH} className="font-medium underline underline-offset-4">Sign in with password and code</Link>
              </div>
            )}
          </PinProblemMessage>
          <Button type="button" variant="ghost" onClick={() => choose(null)} disabled={signIn.isPending}>
            <ArrowLeftIcon data-icon="inline-start" /> Someone else
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}
