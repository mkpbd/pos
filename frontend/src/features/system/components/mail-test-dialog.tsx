import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSendTestMailMutation } from '@/features/system/api'
import { ApiError } from '@/lib/api/client'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** POST /platform/system/mail-test — sent synchronously, so a mail server failure shows up right here. */
export function MailTestDialog({ open, onOpenChange, defaultTo }: { open: boolean; onOpenChange: (open: boolean) => void; defaultTo: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a test e-mail</DialogTitle>
          <DialogDescription>Sends a short plain e-mail right now with the configured mailer, so you can see whether e-mail works.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: every opening starts from a clean form. */}
        {open && <MailTestForm defaultTo={defaultTo} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function MailTestForm({ defaultTo, onDone, onCancel }: { defaultTo: string; onDone: () => void; onCancel: () => void }) {
  const send = useSendTestMailMutation()
  const [to, setTo] = useState(defaultTo)
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [failure, setFailure] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const address = to.trim()
    setFailure(null)
    if (!EMAIL.test(address)) {
      setFieldError('Enter a valid e-mail address.')
      return
    }
    setFieldError(undefined)
    send.mutate(address, {
      onSuccess: () => {
        toast.success(`Test e-mail sent to ${address}.`)
        onDone()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED' && error.fieldErrors.to?.[0]) {
          setFieldError(error.fieldErrors.to[0])
          return
        }
        // MAIL_FAILED already reads "The test e-mail could not be sent: <reason>".
        setFailure(error.message)
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField label="Send to" error={fieldError}>
        <Input type="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} />
      </FormField>
      {failure && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm break-words text-destructive">
          {failure}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden />}
          Send test e-mail
        </Button>
      </DialogFooter>
    </form>
  )
}
