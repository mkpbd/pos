import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import { PrinterIcon, ReceiptTextIcon, TriangleAlertIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, isZeroDecimal, subtractDecimal, sumDecimals } from '@/lib/money'
import { Spinner, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { dateFormat } from '../i18n/format'
import { useLocale } from '../i18n/locale'
import { formatPrice } from '../money'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { usePublicReceiptQuery, type PublicReceipt, type PublicReceiptExchange } from './receipt-api'

/** Prints only the receipt: everything else on the page (header, footer, buttons) is hidden on paper. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-print-receipt], [data-print-receipt] * { visibility: visible !important; }
  [data-print-receipt] { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; }
}`

const itemLabel = (l: { product_name: string; variant_name: string | null }) => (l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name)

/**
 * POS1d: /receipt/:token — a shop sale's receipt from the link in the receipt SMS / e-mail, in the
 * store's look, with a Print button; no sign-in, never indexed. A cancelled sale says so above the
 * receipt; an unknown link is "not found".
 */
export function ReceiptPage() {
  const { token = '' } = useParams()
  const { t } = useLocale()
  const query = usePublicReceiptQuery(token)
  const notFound = query.error instanceof ApiError && (query.error.code === 'RECEIPT_NOT_FOUND' || query.error.status === 404)
  useDocumentMeta(privatePage(query.data ? t('receipts.title', { number: query.data.number }) : notFound ? t('receipts.notFoundTitle') : t('receipts.titleShort')))

  if (query.data) return <ReceiptView receipt={query.data} />
  if (notFound) {
    return (
      <ReceiptMessage title={t('receipts.notFoundTitle')}>
        <p>{t('receipts.notFoundText')}</p>
      </ReceiptMessage>
    )
  }
  if (query.error) {
    return (
      <ReceiptMessage title={t('receipts.titleShort')}>
        <p>{t('receipts.errorText')}</p>
        <button type="button" className={`${primaryButtonClass} mt-4`} disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('common.tryAgain')}
        </button>
      </ReceiptMessage>
    )
  }
  return <Spinner label={t('receipts.loading')} />
}

function ReceiptMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="receipt-page">
      <ReceiptTextIcon aria-hidden className="mx-auto mb-4 size-14 text-sf-border" />
      <h1 className="text-2xl font-extrabold lg:text-3xl">{title}</h1>
      <div className="mt-2 flex flex-col items-center">{children}</div>
    </section>
  )
}

function ReceiptView({ receipt }: { receipt: PublicReceipt }) {
  const { t, formatNumber } = useLocale()
  const money = (amount: string) => formatPrice(amount, receipt.currency)
  const head = receipt.receipt
  const branch = head.branch
  const soldAt = receipt.sold_at
    ? (() => {
        const date = new Date(receipt.sold_at)
        return Number.isNaN(date.getTime()) ? receipt.sold_at : dateFormat({ dateStyle: 'medium', timeStyle: 'short', ...(head.timezone ? { timeZone: head.timezone } : {}) }).format(date)
      })()
    : ''
  const title = head.is_tax_invoice && head.tax_number ? t('receipts.taxInvoice', { number: receipt.number }) : t('receipts.title', { number: receipt.number })

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12" data-testid="receipt-page">
      <style>{PRINT_CSS}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-heading text-2xl font-extrabold text-sf-heading">{title}</h1>
        <button type="button" className={secondaryButtonClass} onClick={() => window.print()}>
          <PrinterIcon aria-hidden className="size-4" /> {t('receipts.print')}
        </button>
      </div>

      {receipt.status === 'cancelled' && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-sf-card border border-sf-sale bg-sf-surface p-4 text-sm font-semibold text-sf-sale" data-testid="receipt-cancelled">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('receipts.cancelled')}
        </div>
      )}

      <article data-print-receipt aria-label={title} className="flex flex-col gap-5 rounded-sf-card bg-sf-surface p-5 text-sm shadow-sm sm:p-8" data-testid="public-receipt">
        <header className="flex flex-col items-center gap-0.5 text-center">
          {head.organization_name && <p className="font-heading text-xl font-bold text-sf-heading">{head.organization_name}</p>}
          {head.tax_number && <p>{t('receipts.bin', { number: head.tax_number })}</p>}
          {branch?.name && <p>{branch.name}</p>}
          {branch?.address && <p className="whitespace-pre-line">{branch.address}</p>}
          {branch?.phone && <p>{t('receipts.phone', { phone: branch.phone })}</p>}
          {head.header && <p className="mt-1 whitespace-pre-line">{head.header}</p>}
        </header>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-y border-dashed border-sf-border py-3">
          <dt className="font-medium text-sf-heading">{t('receipts.date')}</dt>
          <dd data-testid="receipt-date">{soldAt}</dd>
          {receipt.customer_name && (
            <>
              <dt className="font-medium text-sf-heading">{t('receipts.customer')}</dt>
              <dd>{receipt.customer_name}</dd>
            </>
          )}
          {receipt.cashier_name && (
            <>
              <dt className="font-medium text-sf-heading">{t('receipts.cashier')}</dt>
              <dd>{receipt.cashier_name}</dd>
            </>
          )}
        </dl>

        {receipt.exchange && <ExchangeBlock exchange={receipt.exchange} money={money} />}

        <div>
          <h2 className="mb-2 font-heading text-base font-bold text-sf-heading">{receipt.exchange ? t('receipts.newItems') : t('receipts.items')}</h2>
          <ul className="flex flex-col divide-y divide-sf-border" aria-label={receipt.exchange ? t('receipts.newItems') : t('receipts.items')}>
            {receipt.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2" data-testid="receipt-line">
                <div className="min-w-0">
                  <p className="font-medium text-sf-heading">{itemLabel(l)}</p>
                  <p>
                    {formatNumber(l.quantity)}{l.unit_code ? ` ${l.unit_code}` : ''} × {money(l.unit_price)}
                  </p>
                  {!isZeroDecimal(l.discount_amount) && <p className="text-sf-sale">{t('receipts.lineDiscount', { amount: `−${money(l.discount_amount)}` })}</p>}
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{money(l.line_total)}</p>
              </li>
            ))}
          </ul>
        </div>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-dashed border-sf-border pt-3 tabular-nums" aria-label={t('receipts.total')}>
          <Row label={t('receipts.subtotal')} value={money(receipt.subtotal)} />
          {!isZeroDecimal(receipt.discount_total) && <Row label={t('receipts.discount')} value={`−${money(receipt.discount_total)}`} />}
          <Row label={receipt.tax_mode === 'inclusive' ? t('receipts.taxIncluded') : t('receipts.tax')} value={money(receipt.tax_total)} />
          <Row label={t('receipts.total')} value={money(receipt.total)} strong testId="receipt-total" />
        </dl>

        {receipt.payments.length > 0 && (
          <div>
            <h2 className="mb-2 font-heading text-base font-bold text-sf-heading">{t('receipts.payments')}</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums" data-testid="receipt-payments">
              {receipt.payments.map((p, i) => (
                <Row
                  key={i}
                  label={`${p.method_label}${p.reference ? ` (${p.reference})` : ''}${p.tendered ? ` · ${t('receipts.tendered', { amount: money(p.tendered) })}` : ''}`}
                  value={money(p.amount)}
                />
              ))}
              {!isZeroDecimal(receipt.change_total) && <Row label={t('receipts.change')} value={money(receipt.change_total)} />}
              {!isZeroDecimal(receipt.due_total) && <Row label={t('receipts.due')} value={money(receipt.due_total)} strong />}
              {receipt.savings_total && compareDecimal(receipt.savings_total, '0') > 0 && <Row label={t('receipts.saved')} value={money(receipt.savings_total)} strong />}
            </dl>
          </div>
        )}

        <footer className="border-t border-dashed border-sf-border pt-3 text-center">
          <p className="whitespace-pre-line">{head.footer || t('receipts.thanks')}</p>
        </footer>
      </article>
    </section>
  )
}

/** The items brought back in an exchange (as negative amounts) and what they paid. */
function ExchangeBlock({ exchange, money }: { exchange: PublicReceiptExchange; money: (amount: string) => string }) {
  const { t, formatNumber } = useLocale()
  const returned = sumDecimals(exchange.lines.map((l) => l.line_total))
  const owed = subtractDecimal(returned, exchange.value, 2)
  const refunded = subtractDecimal(exchange.value, exchange.applied, 2)
  return (
    <div data-testid="receipt-exchange">
      <h2 className="mb-2 font-heading text-base font-bold text-sf-heading">
        {t('receipts.exchange.title', { number: exchange.original_sale_number, returnNumber: exchange.return_number })}
      </h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
        {exchange.lines.map((l, i) => (
          <Row key={i} label={`${formatNumber(l.quantity)} × ${itemLabel(l)}`} value={`−${money(l.line_total)}`} />
        ))}
        {compareDecimal(owed, '0') > 0 && <Row label={t('receipts.exchange.owed')} value={money(owed)} />}
        <Row label={t('receipts.exchange.returned')} value={`−${money(exchange.value)}`} strong />
        {compareDecimal(refunded, '0') > 0 && <Row label={t('receipts.exchange.refunded')} value={money(refunded)} />}
      </dl>
    </div>
  )
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <>
      <dt className={strong ? 'font-bold text-sf-heading' : undefined}>{label}</dt>
      <dd className={`text-right ${strong ? 'font-bold text-sf-heading' : ''}`} data-testid={testId}>{value}</dd>
    </>
  )
}
