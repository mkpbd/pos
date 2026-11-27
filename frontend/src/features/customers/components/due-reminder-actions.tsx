import { Loader2Icon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCan } from '@/features/auth/use-auth'
import { useCustomerQuery, useSendDueReminderMutation, type Customer } from '@/features/customers/api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

function reminderError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Something went wrong.'
  if (error.code === 'SMS_NOT_READY') return 'SMS is not set up — Settings → SMS.'
  if (error.code === 'SMS_TEMPLATE_OFF') return 'The “Due reminder” SMS is switched off — Settings → SMS.'
  if (error.code === 'NO_DUE') return 'This customer has nothing to pay.'
  if (error.status === 429) return 'Too many reminders sent just now. Wait a minute and try again.'
  if (error.code === 'VALIDATION_FAILED') return Object.values(error.fieldErrors).flat()[0] ?? error.message
  return error.message
}

/**
 * R1: on a customer who owes money, "Send due reminder (SMS)" (customers.manage or
 * payments.collect) and a WhatsApp click-to-chat link with the same text (from the customer's
 * detail; null without a phone or a balance).
 */
export function DueReminderActions({ customer, balance }: { customer: Customer; balance: string }) {
  const can = useCan()
  const detail = useCustomerQuery(customer.id)
  const send = useSendDueReminderMutation(customer.id)
  const owes = compareDecimal(balance, '0') > 0
  const whatsapp = detail.data?.whatsapp_reminder_url ?? null
  const canSend = (can('customers.manage') || can('payments.collect')) && !!customer.phone

  if (!owes || (!canSend && !whatsapp)) return null
  const sent = send.data

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canSend && (
          <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />}
            Send due reminder (SMS)
          </Button>
        )}
        {whatsapp && whatsapp.startsWith('https://wa.me/') && (
          <Button size="sm" variant="outline" asChild>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircleIcon data-icon="inline-start" /> WhatsApp
            </a>
          </Button>
        )}
      </div>
      {send.error && <p role="alert" className="text-sm text-destructive">{reminderError(send.error)}</p>}
      {sent && (
        <p role="status" className={cn('text-sm', sent.status === 'failed' || sent.status === 'skipped' ? 'text-destructive' : 'text-success')} data-testid="due-reminder-sent">
          {sent.status === 'failed' ? `Sending to ${sent.recipient_masked} failed.` : sent.status === 'skipped' ? `Not sent to ${sent.recipient_masked}: the message was skipped.` : `Sent to ${sent.recipient_masked}`}
        </p>
      )}
    </div>
  )
}
