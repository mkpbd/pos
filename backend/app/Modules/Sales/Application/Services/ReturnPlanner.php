<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\ReturnShare;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLine;
use App\Modules\Sales\Infrastructure\Models\SaleReturnRefund;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Validation\ValidationException;

/**
 * Validates and values a return against its invoice, and works out how its total is
 * settled. Used for the preview and, under the sale lock, for the real thing.
 *
 * Rules: lines must be on the invoice; at most what is not yet returned or requested
 * (pending requests reserve their quantities); whole units unless the product allows
 * decimals; serial-numbered goods name the serials coming back.
 */
class ReturnPlanner
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly ProductDirectory $products,
        private readonly CustomerDirectory $customers,
        private readonly CustomerCredit $credit,
    ) {}

    /**
     * @param  list<array{sale_line_id: string, quantity: string|int|float, restock?: ?bool, serials?: ?list<string>}>  $requested
     * @return array{
     *   lines: list<array{sale_line: SaleLine, quantity: string, restock: bool, serials: ?list<string>, net_amount: string, tax_amount: string, line_total: string, cost_total: string}>,
     *   subtotal: string, tax_total: string, total: string
     * }
     *
     * @throws ValidationException
     */
    public function lines(Sale $sale, array $requested, ?ReturnReason $reason): array
    {
        $saleLines = $sale->lines()->get()->keyBy('id');
        $variants = $this->products->variants($this->context->organizationId(), $saleLines->pluck('variant_id')->unique()->values()->all());
        $reserved = $this->reserved($sale);
        $serials = $this->availableSerials($sale);

        $errors = [];
        $seen = [];
        $lines = [];
        foreach (array_values($requested) as $i => $line) {
            $saleLine = $saleLines[$line['sale_line_id']] ?? null;
            if ($saleLine === null) {
                $errors["lines.{$i}.sale_line_id"] = ['This line is not on the invoice.'];

                continue;
            }
            if (isset($seen[$saleLine->id])) {
                $errors["lines.{$i}.sale_line_id"] = ["{$saleLine->product_name} is listed twice."];

                continue;
            }
            $seen[$saleLine->id] = true;

            $quantity = Decimal::round((string) $line['quantity'], 3);
            $before = $reserved[$saleLine->id] ?? ['quantity' => '0', 'line_total' => '0', 'tax_amount' => '0', 'cost_total' => '0'];
            $remaining = Decimal::sub($saleLine->quantity, $before['quantity'], 3);
            if (Decimal::compare($quantity, '0') <= 0) {
                $errors["lines.{$i}.quantity"] = ['The quantity must be greater than zero.'];

                continue;
            }
            if (Decimal::compare($quantity, $remaining) > 0) {
                $errors["lines.{$i}.quantity"] = [Decimal::isZero($remaining) ? 'This line has already been returned.' : "Only {$remaining} can still be returned."];

                continue;
            }
            if (! ($variants[$saleLine->variant_id]['allow_decimal'] ?? false) && ! Decimal::isWhole($quantity)) {
                $errors["lines.{$i}.quantity"] = ['This product is returned in whole units.'];

                continue;
            }

            $returningSerials = null;
            if (isset($serials[$saleLine->id])) {
                $given = array_values(array_filter(array_map(fn ($s) => trim((string) $s), $line['serials'] ?? []), fn (string $s) => $s !== ''));
                $available = $serials[$saleLine->id];
                $matched = [];
                foreach ($given as $serial) {
                    $key = mb_strtolower($serial);
                    if (! isset($available[$key]) || isset($matched[$key])) {
                        $errors["lines.{$i}.serials"] = ["Serial {$serial} was not sold on this line or is already being returned."];

                        continue 2;
                    }
                    $matched[$key] = $available[$key];
                }
                if (! Decimal::isWhole($quantity) || count($matched) !== (int) Decimal::round($quantity, 0)) {
                    $errors["lines.{$i}.serials"] = ['Name one serial number per unit returned ('.Decimal::round($quantity, 0).' needed).'];

                    continue;
                }
                $returningSerials = array_values($matched);
            }

            $lines[] = [
                'sale_line' => $saleLine,
                'quantity' => $quantity,
                'restock' => (bool) ($line['restock'] ?? $reason?->restock_by_default ?? true),
                'serials' => $returningSerials,
                ...ReturnShare::of(
                    ['quantity' => $saleLine->quantity, 'line_total' => $saleLine->line_total, 'tax_amount' => $saleLine->tax_amount, 'cost_total' => $saleLine->cost_total],
                    $before,
                    $quantity,
                    $sale->currency,
                ),
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        if ($lines === []) {
            throw ValidationException::withMessages(['lines' => ['Choose at least one line to return.']]);
        }

        $sum = fn (string $field) => array_reduce($lines, fn (Money $s, array $l) => $s->plus(Money::of($l[$field], $sale->currency)), Money::zero($sale->currency))->amount();

        return ['lines' => $lines, 'subtotal' => $sum('net_amount'), 'tax_total' => $sum('tax_amount'), 'total' => $sum('line_total')];
    }

    /**
     * How a return of $total would be settled now: first against what the customer still owes
     * on this invoice (and overall), the rest refunded. Card, mobile and points refunds are
     * limited to what was paid that way (less earlier refunds); cash can always be refunded.
     *
     * @return array{credit: string, refund_due: string, refundable: list<array{method: string, label: string, max: ?string}>}
     */
    public function settlement(Sale $sale, string $total): array
    {
        $currency = $sale->currency;
        $credit = Money::zero($currency);

        if ($sale->customer_id !== null && ($customer = $this->customers->find($sale->customer_id, $this->context->organizationId())) !== null) {
            $credited = SaleReturn::query()->where('sale_id', $sale->id)->where('status', ReturnStatus::Completed)->sum('credited_total');
            $invoiceDue = Money::of($sale->due_total, $currency)->minus(Money::of(Decimal::round((string) $credited, 2), $currency));
            $outstanding = Money::of($this->credit->outstanding($customer), $currency);

            $credit = Money::of($total, $currency);
            foreach ([$invoiceDue, $outstanding] as $cap) {
                $cap = $cap->isNegative() ? Money::zero($currency) : $cap;
                $credit = $credit->greaterThan($cap) ? $cap : $credit;
            }
        }

        $paid = $sale->payments()->where('kind', 'payment')->get()->groupBy(fn ($p) => $p->method->value)
            ->map(fn ($payments) => $payments->reduce(fn (Money $s, $p) => $s->plus(Money::of($p->amount, $currency)), Money::zero($currency)));
        $refunded = SaleReturnRefund::query()
            ->whereIn('sale_return_id', SaleReturn::query()->where('sale_id', $sale->id)->where('status', ReturnStatus::Completed)->select('id'))
            ->get()
            ->groupBy(fn (SaleReturnRefund $r) => $r->method->value)
            ->map(fn ($refunds) => $refunds->reduce(fn (Money $s, SaleReturnRefund $r) => $s->plus(Money::of($r->amount, $currency)), Money::zero($currency)));

        $refundable = [['method' => PaymentMethod::Cash->value, 'label' => PaymentMethod::Cash->label(), 'max' => null]];
        foreach ([PaymentMethod::Card, PaymentMethod::MobileBanking, PaymentMethod::LoyaltyPoints] as $method) {
            $left = ($paid[$method->value] ?? Money::zero($currency))->minus($refunded[$method->value] ?? Money::zero($currency));
            if ($left->isPositive()) {
                $refundable[] = ['method' => $method->value, 'label' => $method->label(), 'max' => $left->amount()];
            }
        }

        return [
            'credit' => $credit->amount(),
            'refund_due' => Money::of($total, $currency)->minus($credit)->amount(),
            'refundable' => $refundable,
        ];
    }

    /**
     * Quantities and amounts per invoice line already returned or requested.
     *
     * @return array<string, array{quantity: string, line_total: string, tax_amount: string, cost_total: string}>
     */
    private function reserved(Sale $sale): array
    {
        return SaleReturnLine::query()
            ->whereIn('sale_return_id', SaleReturn::query()->where('sale_id', $sale->id)->whereIn('status', [ReturnStatus::Pending, ReturnStatus::Completed])->select('id'))
            ->groupBy('sale_line_id')
            ->selectRaw('sale_line_id, SUM(quantity) as quantity, SUM(line_total) as line_total, SUM(tax_amount) as tax_amount, SUM(cost_total) as cost_total')
            ->get()
            ->mapWithKeys(fn (SaleReturnLine $l) => [$l->sale_line_id => [
                'quantity' => Decimal::round((string) $l->getRawOriginal('quantity'), 3),
                'line_total' => Decimal::round((string) $l->getRawOriginal('line_total'), 2),
                'tax_amount' => Decimal::round((string) $l->getRawOriginal('tax_amount'), 2),
                'cost_total' => Decimal::round((string) $l->getRawOriginal('cost_total'), 2),
            ]])
            ->all();
    }

    /**
     * Serial numbers per serial-tracked line that are still out with the customer and not
     * named by a pending return, keyed by lowercase serial.
     *
     * @return array<string, array<string, string>>
     */
    private function availableSerials(Sale $sale): array
    {
        $lineIds = $sale->lines()->pluck('id');
        $all = SaleLineSerial::query()->whereIn('sale_line_id', $lineIds)->get()->groupBy('sale_line_id');
        $pending = SaleReturnLine::query()
            ->whereIn('sale_return_id', SaleReturn::query()->where('sale_id', $sale->id)->where('status', ReturnStatus::Pending)->select('id'))
            ->get()
            ->flatMap(fn (SaleReturnLine $l) => array_map(mb_strtolower(...), $l->serials ?? []))
            ->flip();

        $result = [];
        foreach ($all as $lineId => $serials) {
            $result[$lineId] = [];
            foreach ($serials as $serial) {
                $key = mb_strtolower($serial->serial);
                if ($serial->released_at === null && ! isset($pending[$key])) {
                    $result[$lineId][$key] = $serial->serial;
                }
            }
        }

        return $result;
    }
}
