import { createContext, useContext } from 'react'
import type { Approval, ApprovalAction } from '@/features/pos/till-api'

export type ApprovalRequest = {
  action: ApprovalAction
  /** What is being approved, in words (e.g. “Sell Mango Juice at 20.00 instead of 25.00.”). */
  description: string
  /** Bound to the approval by the server (e.g. `{ variant_id, unit_price }` or `{ scope: 'line' }`). */
  details?: Record<string, unknown>
}

export type RequestApproval = (request: ApprovalRequest) => Promise<Approval | null>

export const ApprovalContext = createContext<RequestApproval>(() => Promise.resolve(null))

/** Ask a manager to approve something by PIN; resolves with the approval, or null when cancelled. */
export function useManagerApproval(): RequestApproval {
  return useContext(ApprovalContext)
}
