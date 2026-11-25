import { cloneElement, useState, type ReactElement } from 'react'
import type { DiscountInput } from '@/features/pos/api'
import { DiscountPopover } from '@/features/pos/components/line-controls'
import { useManagerApproval } from '@/features/pos/manager-approval-context'

/**
 * A discount control that works for everyone: with `sales.discount` (or once a manager approved
 * discounts on this cart) it opens the discount editor; otherwise the trigger asks a manager first
 * and the editor opens after the approval.
 */
export function GatedDiscount({
  allowed,
  scope,
  description,
  onApproved,
  value,
  onChange,
  label,
  hint,
  trigger,
}: {
  allowed: boolean
  scope: 'line' | 'invoice'
  description: string
  onApproved: (approvalId: string) => void
  value: DiscountInput | null
  onChange: (discount: DiscountInput | null) => void
  label: string
  hint?: string
  trigger: ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
}) {
  const requestApproval = useManagerApproval()
  const [justApproved, setJustApproved] = useState(false)

  if (allowed) {
    return (
      <DiscountPopover value={value} onChange={onChange} label={label} hint={hint} defaultOpen={justApproved}>
        {trigger}
      </DiscountPopover>
    )
  }

  return cloneElement(trigger, {
    onClick: () => {
      void requestApproval({ action: 'discount', description, details: { scope } }).then((approval) => {
        if (!approval) return
        setJustApproved(true)
        onApproved(approval.id)
      })
    },
  })
}
