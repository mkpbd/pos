import { useId, useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api/client'
import { changeAddress, lockedBy, slugify } from './collab-api'

/*
 * B16 "Change address…" for a campaign page (/p/<slug>): the new address with a preview of the
 * full link; the old address keeps working — it forwards to the new one (an automatic 301).
 */

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  /** The current slug (`landing:<slug>`). */
  slug: string
  storeUrl: string | null
  onChanged: (result: { key: string; path: string | null; preview_url: string | null }) => void
}

export function AddressDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <AddressForm {...rest} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function AddressForm({ documentId, slug, storeUrl, onChanged, onClose }: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [value, setValue] = useState(slug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const next = slugify(value)
  const preview = `${storeUrl ?? ''}/p/${next || '…'}`

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!next) {
      setError('Use letters, numbers and dashes, for example “eid-sale”.')
      return
    }
    if (next === slug) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      onChanged(await changeAddress(documentId, next))
      onClose()
    } catch (e) {
      const holder = lockedBy(e)
      setError(
        holder
          ? `${holder.name} is editing this page, so its address can’t change now.`
          : e instanceof ApiError && e.code === 'DOCUMENT_EXISTS'
            ? 'That address is taken. Try another one.'
            : e instanceof Error
              ? e.message
              : 'The address could not be changed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Change the page address</DialogTitle>
        <DialogDescription>Old links keep working — they forward to the new address.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>New address</Label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground" aria-hidden>
            /p/
          </span>
          <Input
            id={id}
            value={value}
            maxLength={120}
            autoFocus
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-preview${error ? ` ${id}-error` : ''}`}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            data-testid="address-input"
          />
        </div>
        <p id={`${id}-preview`} className="text-xs break-all text-muted-foreground" data-testid="address-preview">
          Shoppers will open it at {preview}
        </p>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" aria-hidden />} Change address
        </Button>
      </DialogFooter>
    </form>
  )
}
