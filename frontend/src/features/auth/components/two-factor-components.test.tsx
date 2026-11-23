import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RecoveryCodesPanel } from '@/features/auth/components/recovery-codes-panel'
import { TwoFactorQr } from '@/features/auth/components/two-factor-qr'
import { OTPAUTH_URI, RECOVERY_CODES } from '@/features/auth/two-factor-test-data'

describe('TwoFactorQr (G1a)', () => {
  it('draws the otpauth URI as a QR code', () => {
    render(<TwoFactorQr uri={OTPAUTH_URI} />)
    const svg = screen.getByRole('img', { name: 'QR code to scan with your authenticator app' })
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M/)
  })

  it('falls back to the key when the URI is too long for a QR code', () => {
    render(<TwoFactorQr uri={`otpauth://totp/${'x'.repeat(400)}`} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/enter the key below in your app instead/)).toBeInTheDocument()
  })
})

describe('RecoveryCodesPanel (G1a)', () => {
  it('lists the codes and only lets the user go on once they are saved', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<RecoveryCodesPanel codes={RECOVERY_CODES} doneLabel="Done" onDone={onDone} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByRole('note')).toHaveTextContent('they won’t be shown again')
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done).toBeDisabled()
    await user.click(screen.getByLabelText('I’ve saved these codes'))
    await user.click(done)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
