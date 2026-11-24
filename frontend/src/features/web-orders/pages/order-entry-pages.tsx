import { Link, useParams } from 'react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { useWebOrderQuery } from '@/features/web-orders/api'
import { OrderEntryForm } from '@/features/web-orders/components/order-entry-form'
import { draftFromOrder, emptyDraft } from '@/features/web-orders/order-entry'

/** /web-orders/new — an order taken by phone, Facebook, WhatsApp… (web_orders.create). */
export function NewWebOrderPage() {
  return <OrderEntryForm mode="create" initial={emptyDraft()} />
}

function CannotEdit({ orderId, number, message }: { orderId: string; number: string; message: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to the order"><Link to={`/web-orders/${orderId}`}><ArrowLeftIcon /></Link></Button>
        <h1 className="text-2xl font-semibold tracking-tight">Change order <span className="font-mono">{number}</span></h1>
      </div>
      <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">{message}</p>
      <div><Button asChild variant="outline"><Link to={`/web-orders/${orderId}`}>Back to the order</Link></Button></div>
    </div>
  )
}

/** /web-orders/:orderId/edit — change an unpaid order before it ships (web_orders.edit). */
export function EditWebOrderPage() {
  const { orderId } = useParams()
  const { data: order, error, isPending, refetch } = useWebOrderQuery(orderId)

  if (isPending) return <LoadingState rows={6} label="Loading order" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  if (!order.allowed_actions.includes('edit')) {
    return <CannotEdit orderId={order.id} number={order.number} message="This order can no longer be changed: only unpaid orders that have not been shipped can be changed." />
  }
  const initial = draftFromOrder(order)
  if (!initial) {
    return <CannotEdit orderId={order.id} number={order.number} message="This order is missing details needed to change it (product variants or the delivery district)." />
  }
  // Keyed by revision: a newer version of the order starts the form again.
  return <OrderEntryForm key={`${order.id}-${order.revision ?? 1}`} mode="edit" order={order} initial={initial} />
}
