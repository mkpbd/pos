<?php

namespace App\Modules\Sales\Application\Queries;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\CustomerPayment;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Customer statement: every document that changed what the customer owes, with a running
 * balance. Positive = the customer owes us. Same arithmetic as CustomerCredit:
 * invoices (+total, −paid at the till), cancellations (−due), returns (−total, +refunded),
 * payments (−amount).
 */
class CustomerAccount
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
    ) {}

    /**
     * @return array{customer: array<string, mixed>, opening_balance: string, entries: list<array<string, mixed>>, closing_balance: string}
     */
    public function statement(string $customerId, ?string $from, ?string $to): array
    {
        $customer = $this->customers->find($customerId, $this->context->organizationId()) ?? throw new NotFoundHttpException;
        $balance = Decimal::round($customer['opening_balance'], 2);
        $rows = [];

        foreach ($this->entries($customerId) as $entry) {
            if ($to !== null && $entry['date'] > $to) {
                continue;
            }
            if ($from !== null && $entry['date'] < $from) {
                $balance = Decimal::add($balance, $entry['amount'], 2); // carried into the opening balance

                continue;
            }
            $rows[] = $entry;
        }

        $opening = $balance;
        foreach ($rows as $i => $row) {
            $balance = Decimal::add($balance, $row['amount'], 2);
            $rows[$i]['balance'] = $balance;
        }

        return [
            'customer' => ['id' => $customer['id'], 'code' => $customer['code'], 'name' => $customer['name'], 'phone' => $customer['phone'], 'credit_limit' => Decimal::round($customer['credit_limit'], 2)],
            'opening_balance' => $opening,
            'entries' => $rows,
            'closing_balance' => $balance,
        ];
    }

    /**
     * @return Collection<int, array{date: string, type: string, id: string, number: string, description: string, amount: string}>
     */
    private function entries(string $customerId): Collection
    {
        $timezone = $this->context->organization()['timezone'] ?? config('app.timezone');
        $day = fn (Carbon $at) => $at->copy()->setTimezone($timezone)->toDateString();
        $entry = fn (Carbon $at, string $type, string $id, string $number, string $description, string $amount) => [
            'date' => $day($at), 'type' => $type, 'id' => $id, 'number' => $number, 'description' => $description, 'amount' => $amount, 'at' => $at,
        ];

        $rows = collect();
        foreach (Sale::query()->where('customer_id', $customerId)->get() as $sale) {
            $rows->push($entry($sale->sold_at, 'sale', $sale->id, $sale->number, 'Invoice', $sale->total));
            if (Decimal::compare($sale->paid_total, '0') > 0) {
                $rows->push($entry($sale->sold_at, 'sale_payment', $sale->id, $sale->number, 'Paid at the till', Decimal::negate($sale->paid_total, 2)));
            }
            if ($sale->status === SaleStatus::Cancelled && $sale->cancelled_at !== null) {
                $rows->push($entry($sale->cancelled_at, 'sale_cancellation', $sale->id, $sale->number, 'Invoice cancelled', Decimal::negate($sale->due_total, 2)));
            }
        }
        foreach (SaleReturn::query()->where('customer_id', $customerId)->where('status', ReturnStatus::Completed)->get() as $return) {
            $rows->push($entry($return->decided_at ?? $return->requested_at, 'sale_return', $return->id, $return->number, 'Goods returned', Decimal::negate($return->total, 2)));
            if (Decimal::compare($return->refunded_total, '0') > 0) {
                $rows->push($entry($return->decided_at ?? $return->requested_at, 'refund', $return->id, $return->number, 'Refunded', $return->refunded_total));
            }
        }
        foreach (CustomerPayment::query()->where('customer_id', $customerId)->get() as $payment) {
            $rows->push($entry($payment->created_at, 'payment', $payment->id, $payment->number, 'Payment received'.($payment->reference ? " ({$payment->reference})" : ''), Decimal::negate($payment->amount, 2)));
        }

        return $rows->sortBy(fn (array $r) => $r['at']->getTimestamp())->values()
            ->map(fn (array $r) => array_diff_key($r, ['at' => true]));
    }
}
