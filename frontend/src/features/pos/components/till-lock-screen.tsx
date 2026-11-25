import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, LockIcon, LogOutIcon, UserRoundIcon, UsersRoundIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useLogoutMutation } from '@/features/auth/api'
import type { CurrentUser } from '@/features/auth/types'
import { useHoldMutation } from '@/features/pos/api'
import { cartOps, toCartInput, usePosCart } from '@/features/pos/cart-store'
import { PinPad, PinProblemMessage } from '@/features/pos/components/pin-pad'
import { usePinProblem } from '@/features/pos/till-helpers'
import { useTillLockStore } from '@/features/pos/till-lock'
import { hasTillPin, pinProblem, usePinSignInMutation, useTillTerminalQuery, useVerifyPinMutation, type TillTerminal } from '@/features/pos/till-api'
import { useSessionStore } from '@/stores/session-store'

type Mode = { kind: 'unlock' } | { kind: 'pick' } | { kind: 'switch'; user: { id: string; name: string } }

/**
 * The locked till: covers the whole screen (the cart included) until the cashier types their
 * PIN, or another cashier signs in on this till (the current cart is held first).
 */
export function TillLockScreen({ me, branchId }: { me: CurrentUser; branchId: string }) {
  const navigate = useNavigate()
  const unlock = useTillLockStore((s) => s.unlock)
  const terminal = useTillTerminalQuery()
  const verify = useVerifyPinMutation()
  const signIn = usePinSignInMutation()
  const logout = useLogoutMutation()
  const hold = useHoldMutation()
  const setActiveBranch = useSessionStore((s) => s.setActiveBranch)
  const { cart, apply } = usePosCart(branchId)
  const [mode, setMode] = useState<Mode>({ kind: 'unlock' })
  const [pin, setPin] = useState('')
  const problem = usePinProblem()
  const pinSet = hasTillPin(me)
  const till: TillTerminal | null = terminal.data ?? null
  const others = till?.users.filter((u) => u.id !== me.user.id) ?? []

  const go = (next: Mode) => {
    setMode(next)
    setPin('')
    problem.show(null)
  }

  const fail = (error: unknown) => {
    setPin('')
    problem.show(pinProblem(error))
  }

  const tryUnlock = (value: string) => {
    problem.show(null)
    verify.mutate(value, { onSuccess: unlock, onError: fail })
  }

  const trySwitch = async (user: { id: string; name: string }, value: string) => {
    problem.show(null)
    // The cart in progress is parked for later, under the cashier who rang it up.
    if (cart.lines.length > 0) {
      const input = toCartInput(cart)
      if (!input) {
        problem.show({ message: 'The cart has a quantity problem, so it cannot be held. Unlock and fix it first.', retryAfter: null, passwordOnly: false })
        setPin('')
        return
      }
      try {
        await hold.mutateAsync({ ...input, label: `${cart.customer?.name ?? 'Walk-in'} · held at cashier switch (${me.user.name})` })
        apply((c) => cartOps.empty(c.storeId))
        toast.success(`${me.user.name}'s cart was held. Resume it from “Held sales”.`)
      } catch (error) {
        fail(error)
        return
      }
    }
    signIn.mutate(
      { user_id: user.id, pin: value },
      {
        onSuccess: () => {
          unlock()
          if (till) setActiveBranch(till.store.branch_id)
          toast.success(`${user.name} is now signed in.`)
        },
        onError: fail,
      },
    )
  }

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        unlock()
        navigate(till ? '/pos/sign-in' : '/login', { replace: true })
      },
    })

  const pending = verify.isPending || signIn.isPending || hold.isPending

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Till locked" className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-canvas px-4 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-1 text-center">
          <LockIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="font-heading text-xl font-semibold">Till locked</h2>
          <p className="text-sm text-muted-foreground">
            {till ? `${till.name} · ${till.store.name}` : 'POS terminal'}
          </p>
        </div>

        {mode.kind === 'unlock' && (
          <>
            <p className="text-sm">
              <b>{me.user.name}</b> {pinSet ? 'can unlock with their PIN.' : 'has no till PIN. Switch cashier or sign out.'}
            </p>
            {pinSet && (
              <PinPad value={pin} onChange={setPin} onSubmit={tryUnlock} submitLabel="Unlock" pending={verify.isPending} disabled={problem.lockedOut} />
            )}
          </>
        )}

        {mode.kind === 'pick' && (
          <div className="flex w-full flex-col gap-2" role="group" aria-label="Cashiers on this till">
            <p className="text-sm text-muted-foreground">Who is taking over?{cart.lines.length > 0 && ' The current cart is held first.'}</p>
            {others.length === 0 ? (
              <p className="text-sm">No other cashier with a PIN can sign in on this till.</p>
            ) : (
              others.map((u) => (
                <Button key={u.id} type="button" variant="outline" size="lg" className="justify-start" onClick={() => go({ kind: 'switch', user: u })}>
                  <UserRoundIcon data-icon="inline-start" /> {u.name}
                </Button>
              ))
            )}
          </div>
        )}

        {mode.kind === 'switch' && (
          <>
            <p className="text-sm"><b>{mode.user.name}</b>, enter your PIN.</p>
            <PinPad
              value={pin}
              onChange={setPin}
              onSubmit={(value) => void trySwitch(mode.user, value)}
              submitLabel="Sign in"
              pending={signIn.isPending || hold.isPending}
              disabled={problem.lockedOut}
            />
          </>
        )}

        <PinProblemMessage problem={problem.problem} lockedOut={problem.lockedOut} secondsLeft={problem.secondsLeft} />

        <div className="flex w-full flex-wrap justify-center gap-2 border-t pt-4">
          {mode.kind !== 'unlock' ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => go({ kind: 'unlock' })}>
              <ArrowLeftIcon data-icon="inline-start" /> Back
            </Button>
          ) : (
            till && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => go({ kind: 'pick' })}>
                <UsersRoundIcon data-icon="inline-start" /> Switch cashier
              </Button>
            )
          )}
          <Button type="button" variant="ghost" disabled={pending || logout.isPending} onClick={signOut}>
            <LogOutIcon data-icon="inline-start" /> Sign out
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
