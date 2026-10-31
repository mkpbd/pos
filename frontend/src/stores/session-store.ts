import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SessionState = {
  /** Branch the user is working in; sent as X-Branch-Id on every API request. */
  activeBranchId: string | null
  setActiveBranch: (branchId: string | null) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      activeBranchId: null,
      setActiveBranch: (activeBranchId) => set({ activeBranchId }),
    }),
    { name: 'pos-session' },
  ),
)
