import { LayoutDashboardIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BuilderNode, Section } from '@/storefront/builder/types'
import { hasLayoutVariants } from './layout-variants'
import { useLayoutUi } from './layout-ui'

/** B21: "Try another layout" in the inspector header of a section that has other arrangements. */
export function TryLayoutButton({ node }: { node: BuilderNode }) {
  const ui = useLayoutUi()
  if (!ui || node.type !== 'section' || !hasLayoutVariants(node as Section)) return null
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Try another layout" title="Try another layout" onClick={() => ui.openLayouts(node.id)} data-testid="inspector-try-layout">
      <LayoutDashboardIcon />
    </Button>
  )
}
