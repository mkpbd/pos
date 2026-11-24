import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import type { SystemStatusReport } from '@/features/system/api'
import { WARNING_HINTS, warningTitle } from '@/features/system/labels'

/** The status report's warnings in plain words, worst news first as the server orders them. */
export function WarningsList({ warnings }: { warnings: SystemStatusReport['warnings'] }) {
  if (warnings.length === 0) {
    return (
      <section aria-labelledby="ops-warnings-heading" className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
        <CircleCheckIcon className="size-5 shrink-0 text-success" aria-hidden />
        <h2 id="ops-warnings-heading" className="font-medium">
          Nothing needs attention
        </h2>
      </section>
    )
  }

  return (
    <section aria-labelledby="ops-warnings-heading" className="rounded-lg border border-warning/50 bg-warning/10 p-4">
      <h2 id="ops-warnings-heading" className="flex items-center gap-2 font-medium">
        <TriangleAlertIcon className="size-5 shrink-0 text-warning-soft-foreground" aria-hidden />
        Needs attention ({warnings.length})
      </h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {warnings.map((w) => {
          const title = warningTitle(w.code)
          const hint = WARNING_HINTS[w.code]
          return (
            <li key={w.code} data-code={w.code} className="rounded-md bg-background/60 px-3 py-2">
              <p className="font-medium">{title ?? w.message}</p>
              {title && w.message && <p className="break-words text-muted-foreground">{w.message}</p>}
              {hint && <p className="break-words text-muted-foreground">{hint}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
