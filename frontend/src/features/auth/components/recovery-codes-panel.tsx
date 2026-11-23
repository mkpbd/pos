import { useId, useState } from 'react'
import { CopyIcon, DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { copyText } from '@/features/marketing/clipboard'

/**
 * Recovery codes, shown once (after turning two-factor on or making new ones): copy, download as
 * .txt, and an "I've saved these" tick before the user can move on.
 */
export function RecoveryCodesPanel({ codes, doneLabel, onDone }: { codes: string[]; doneLabel: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const checkboxId = useId()
  const text = codes.join('\n')
  // A data URL needs no clean-up (a few hundred bytes).
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(
    `Enterprise POS recovery codes\nEach code signs you in once if you can't use your authenticator app.\n\n${text}\n`,
  )}`

  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <p className="font-medium">Save these recovery codes now — they won’t be shown again.</p>
        <p className="text-muted-foreground">If you lose your phone, each code lets you sign in once. Keep them somewhere safe, away from this device.</p>
      </div>
      <ol aria-label="Recovery codes" className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-sm min-[360px]:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="tracking-wide">{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copyText(text, 'Recovery codes copied.')}>
          <CopyIcon data-icon="inline-start" /> Copy codes
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={href} download="recovery-codes.txt">
            <DownloadIcon data-icon="inline-start" /> Download .txt
          </a>
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id={checkboxId} checked={saved} onCheckedChange={(checked) => setSaved(checked === true)} />
        <Label htmlFor={checkboxId} className="font-normal">I’ve saved these codes</Label>
      </div>
      <Button type="button" className="self-start" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}
