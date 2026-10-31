import { useQueryClient } from '@tanstack/react-query'
import { StoreIcon } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/use-auth'
import { authKeys } from '@/features/auth/api'
import { useSessionStore } from '@/stores/session-store'

/**
 * Active branch for branch-scoped work. Changing it refetches everything except the session,
 * because every request carries the branch in X-Branch-Id.
 */
export function BranchSwitcher() {
  const me = useAuth()
  const queryClient = useQueryClient()
  const activeBranchId = useSessionStore((s) => s.activeBranchId)
  const setActiveBranch = useSessionStore((s) => s.setActiveBranch)
  const branches = me.branches.filter((b) => b.is_active)

  if (branches.length === 0) return null

  return (
    <Select
      value={activeBranchId ?? undefined}
      onValueChange={(id) => {
        setActiveBranch(id)
        void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== authKeys.me[0] })
      }}
    >
      <SelectTrigger size="sm" aria-label="Active branch" className="max-w-48">
        <StoreIcon className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue placeholder="Select branch" />
      </SelectTrigger>
      <SelectContent align="end">
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name} <span className="text-muted-foreground">({b.code})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
