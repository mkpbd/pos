import { useId, useState, type FormEvent } from 'react'
import { CopyIcon, Loader2Icon, MailIcon, MessageSquareIcon, SendIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyText } from '@/features/marketing/clipboard'
import type { ReceiptChannel } from '@/features/sales/api'
import { sendReceiptError, useReceiptLinkQuery, useSendReceiptMutation, type SendReceiptResult } from '@/features/sales/receipt-send-api'
import { cn } from '@/lib/utils'

export type SendReceiptCustomer = { phone: string | null; email: string | null }

type Props = {
  saleId: string
  /** The sale's customer: their phone / e-mail fill the recipient (null for a walk-in sale). */
  customer: SendReceiptCustomer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ChannelInfo = { value: ReceiptChannel; label: string; icon: typeof MailIcon; field: string; type: string; inputMode: 'tel' | 'email'; placeholder: string }

const CHANNEL: Record<ReceiptChannel, ChannelInfo> = {
  sms: { value: 'sms', label: 'SMS', icon: MessageSquareIcon, field: 'Mobile number', type: 'tel', inputMode: 'tel', placeholder: '01XXXXXXXXX' },
  email: { value: 'email', label: 'E-mail', icon: MailIcon, field: 'E-mail address', type: 'email', inputMode: 'email', placeholder: 'name@example.com' },
}
const CHANNELS = [CHANNEL.sms, CHANNEL.email]

/**
 * POS1d: sends a sale's receipt to the customer by SMS (a short text with the receipt link) or
 * e-mail (the full receipt), and copies the public receipt link. Used at the till after a sale and
 * on the sale page.
 */
export function SendReceiptDialog({ open, onOpenChange, ...props }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening: the recipient starts from the customer each time. */}
        {open && <SendReceiptForm {...props} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SendReceiptForm({ saleId, customer, onClose }: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const id = useId()
  const defaults: Record<ReceiptChannel, string> = { sms: customer?.phone?.trim() ?? '', email: customer?.email?.trim() ?? '' }
  const [channel, setChannel] = useState<ReceiptChannel>(() => (!defaults.sms && defaults.email ? 'email' : 'sms'))
  const [to, setTo] = useState(defaults)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState<SendReceiptResult | null>(null)
  const send = useSendReceiptMutation(saleId)
  const link = useReceiptLinkQuery(saleId)
  const url = link.data?.url ?? null
  const current = CHANNEL[channel]

  const reset = () => {
    setFieldError(null)
    setFormError(null)
    setSent(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const recipient = to[channel].trim()
    if (recipient === '') {
      setFieldError(channel === 'sms' ? 'Enter the mobile number to send the receipt to.' : 'Enter the e-mail address to send the receipt to.')
      return
    }
    reset()
    send.mutate(
      { channel, to: recipient },
      {
        onSuccess: (result) => setSent(result),
        onError: (error) => {
          const problem = sendReceiptError(error)
          setFieldError(problem.field ?? null)
          setFormError(problem.form ?? null)
        },
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Send receipt</DialogTitle>
        <DialogDescription>By SMS with a link to the receipt, or by e-mail.</DialogDescription>
      </DialogHeader>
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Send by</legend>
          <div role="radiogroup" aria-label="Send by" className="grid grid-cols-2 gap-2">
            {CHANNELS.map((c) => (
              <label
                key={c.value}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  channel === c.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-channel`}
                  value={c.value}
                  checked={channel === c.value}
                  onChange={() => { setChannel(c.value); reset() }}
                  className="sr-only"
                />
                <c.icon className="size-4" aria-hidden />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-to`}>{current.field}</Label>
          <Input
            id={`${id}-to`}
            type={current.type}
            inputMode={current.inputMode}
            autoComplete="off"
            maxLength={channel === 'sms' ? 20 : 254}
            placeholder={current.placeholder}
            value={to[channel]}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-to-error` : undefined}
            onChange={(e) => {
              const value = e.target.value
              setTo((t) => ({ ...t, [channel]: value }))
              reset()
            }}
          />
          {fieldError && <p id={`${id}-to-error`} className="text-sm text-destructive">{fieldError}</p>}
        </div>

        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        {sent && (
          <p role="status" className={cn('text-sm', sent.status === 'queued' ? 'text-success' : 'text-destructive')} data-testid="receipt-sent">
            {sent.status === 'queued' ? `Sent to ${sent.recipient_masked}` : sent.status === 'skipped' ? `Not sent to ${sent.recipient_masked}: the message was skipped.` : `Sending to ${sent.recipient_masked} failed.`}
          </p>
        )}
      </form>
      <DialogFooter className="gap-2 sm:justify-between">
        {url ? (
          <Button type="button" variant="outline" onClick={() => void copyText(url, 'Receipt link copied.')}>
            <CopyIcon data-icon="inline-start" /> Copy link
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{sent ? 'Done' : 'Cancel'}</Button>
          <Button type="submit" form={`${id}-form`} disabled={send.isPending}>
            {send.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />}
            Send
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
