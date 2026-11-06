import { useState } from 'react'
import { Loader2Icon, RotateCwIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AI_PERMISSIONS, aiEnabledFor, useExplainReorderMutation } from '@/features/ai/api'
import { AiByline, AiErrorAlert } from '@/features/ai/components/ai-states'
import { SafeMarkdown } from '@/features/ai/components/safe-markdown'
import { useAuth, useCan } from '@/features/auth/use-auth'

const numberFormat = new Intl.NumberFormat('en-US')

/**
 * Reorder page: "Explain with AI" (ai.ask; the page itself needs purchases.view) opens a side
 * panel with a prioritized explanation of the store's deterministic reorder suggestions.
 * Hidden when AI is off for the organization.
 */
export function ExplainReorderButton({ storeId, storeName, disabled }: { storeId: string | null; storeName: string; disabled?: boolean }) {
  const me = useAuth()
  const can = useCan()
  const [open, setOpen] = useState(false)
  const explain = useExplainReorderMutation()

  if (!can(AI_PERMISSIONS.ask) || !aiEnabledFor(me)) return null

  const run = () => {
    if (storeId) explain.mutate(storeId)
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={!storeId || disabled}
        onClick={() => {
          setOpen(true)
          // Re-explain only when the store changed or nothing was explained yet.
          if (explain.variables !== storeId || !explain.data) run()
        }}
      >
        <SparklesIcon data-icon="inline-start" /> Explain with AI
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Reorder priorities</SheetTitle>
            <SheetDescription>What to order first at {storeName}, and why — explained from this store’s reorder suggestions.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4" aria-live="polite" aria-busy={explain.isPending}>
            {explain.isPending ? (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" aria-hidden /> Reading the suggestions…
              </div>
            ) : explain.isError ? (
              <AiErrorAlert error={explain.error} />
            ) : explain.data ? (
              <div className="flex flex-col gap-3" data-testid="reorder-explanation">
                {explain.data.narrative ? <SafeMarkdown text={explain.data.narrative} /> : <p className="text-sm text-muted-foreground">There is nothing to explain: no reorder suggestions for this store.</p>}
                <AiByline generatedAt={explain.data.generated_at} />
                {explain.data.usage && (
                  <p className="text-xs text-muted-foreground">Used {numberFormat.format(explain.data.usage.input_tokens)} input and {numberFormat.format(explain.data.usage.output_tokens)} output tokens.</p>
                )}
              </div>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end">
            <Button variant="outline" disabled={explain.isPending || !storeId} onClick={run}>
              <RotateCwIcon data-icon="inline-start" /> Explain again
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
