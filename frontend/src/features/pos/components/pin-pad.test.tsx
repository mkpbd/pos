import { useState } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PinPad } from '@/features/pos/components/pin-pad'
import { formatCountdown, pinProblem } from '@/features/pos/till-api'
import { usePinProblem } from '@/features/pos/till-helpers'
import { AUTO_LOCK_MS, useIdleTimer } from '@/features/pos/till-lock'
import { ApiError } from '@/lib/api/client'

function Harness({ onSubmit }: { onSubmit: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  return <PinPad value={pin} onChange={setPin} onSubmit={onSubmit} submitLabel="Unlock" />
}

describe('PinPad', () => {
  it('takes digits from the pad and the keyboard, deletes, and submits with Enter from four digits', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '3' }))
    await user.keyboard('57')
    expect(screen.getByRole('status')).toHaveAccessibleName('PIN: 4 digits entered')

    await user.keyboard('{Backspace}')
    expect(screen.getByRole('status')).toHaveAccessibleName('PIN: 3 digits entered')
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '9' }))
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('1359')
  })

  it('submits by itself at six digits and ignores letters', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    await user.keyboard('24a68')
    expect(onSubmit).not.toHaveBeenCalled()
    await user.keyboard('02')
    expect(onSubmit).toHaveBeenCalledWith('246802')
    await user.keyboard('4')
    expect(screen.getByRole('status')).toHaveAccessibleName('PIN: 6 digits entered')
  })
})

describe('PIN problems', () => {
  it('says how many attempts are left, and counts down a lockout', () => {
    vi.useFakeTimers()
    expect(pinProblem(new ApiError(422, 'PIN_INVALID', 'Wrong PIN.', { attempts_left: 2 })).message).toBe('Wrong PIN. 2 attempts left.')
    expect(pinProblem(new ApiError(422, 'PIN_NOT_ALLOWED', 'x')).passwordOnly).toBe(true)

    const { result } = renderHook(() => usePinProblem())
    act(() => result.current.show(pinProblem(new ApiError(423, 'PIN_LOCKED', 'Locked.', { retry_after: 90 }))))
    expect(result.current.lockedOut).toBe(true)
    expect(formatCountdown(result.current.secondsLeft)).toBe('1:30')

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(formatCountdown(result.current.secondsLeft)).toBe('0:30')
    act(() => { vi.advanceTimersByTime(31_000) })
    expect(result.current.lockedOut).toBe(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('useIdleTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires after five minutes without input; any input starts the wait again', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    renderHook(() => useIdleTimer(onIdle, AUTO_LOCK_MS, true))

    act(() => { vi.advanceTimersByTime(4 * 60_000) })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    act(() => { vi.advanceTimersByTime(4 * 60_000) })
    expect(onIdle).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    renderHook(() => useIdleTimer(onIdle, AUTO_LOCK_MS, false))
    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(onIdle).not.toHaveBeenCalled()
  })
})
