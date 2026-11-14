import type { AddSeveralResult } from './add-several'

export type AddSeveralMessages = {
  chooseOne: string
  added: (count: number) => string
  partial: (added: number, count: number) => string
  none: string
}

/** The polite live region under a "buy these together" button: added, nothing ticked, or what failed and why. */
export function AddSeveralStatus({ result, messages, testId }: { result: AddSeveralResult; messages: AddSeveralMessages; testId?: string }) {
  return (
    <div role="status" aria-live="polite" className="text-sm empty:hidden" data-testid={testId}>
      {result === 'choose' && <p>{messages.chooseOne}</p>}
      {result && result !== 'choose' && result.failures.length === 0 && <p className="font-semibold">{messages.added(result.added)}</p>}
      {result && result !== 'choose' && result.failures.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-sf-sale p-3">
          <p className="font-semibold">{result.added > 0 ? messages.partial(result.added, result.count) : messages.none}</p>
          <ul className="list-disc pl-5">
            {result.failures.map((failure, i) => (
              <li key={`${failure.name}-${i}`}>
                {failure.name} — {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
