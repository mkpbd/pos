<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Sales\Application\Services\CustomerCredit;
use App\Modules\Sales\Application\Services\ReturnPlanner;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SaleLineStock;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLine;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLineStock;
use App\Modules\Sales\Infrastructure\Models\SaleReturnRefund;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Critical workflow #10 (second half): approves and posts a pending return in one transaction.
 *
 *  - Restocked lines go back to the exact batches they were sold from, at the cost they left
 *    with (written-off lines bring no stock back); serial numbers become sellable again.
 *  - The total is first credited against what the customer still owes on the invoice; the
 *    rest is refunded with the methods given (they must add up to it). Card, mobile and
 *    points refunds are limited to what was paid that way; cash leaves the approver's drawer.
 *  - Loyalty points earned on the returned share are taken back.
 */
class CompleteSaleReturn
{
    public function __construct(
        private readonly ReturnPlanner $planner,
        private readonly CustomerCredit $credit,
        private readonly StockLedger $stock,
        private readonly PaymentLedger $payments,
        private readonly LoyaltyProgram $loyalty,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  list<array{method: string, amount: string|int|float, reference?: ?string}>  $refunds
     */
    public function __invoke(TenantUser $actor, SaleReturn $return, array $refunds): SaleReturn
    {
        if (! $actor->canAccessBranch($return->branch_id)) {
            throw new NotFoundHttpException;
        }

        return DB::transaction(function () use ($actor, $return, $refunds) {
            // Same lock order as RequestSaleReturn: the sale first, then the return.
            /** @var Sale $sale */
            $sale = Sale::query()->whereKey($return->sale_id)->lockForUpdate()->firstOrFail();
            /** @var SaleReturn $locked */
            $locked = SaleReturn::query()->whereKey($return->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== ReturnStatus::Pending) {
                throw new BusinessRuleViolation('RETURN_ALREADY_DECIDED', "{$locked->number} is already {$locked->status->value}.");
            }
            if ($sale->customer_id !== null) {
                $this->credit->lock($sale->customer_id);
            }

            $settlement = $this->planner->settlement($sale, $locked->total);
            $refundLines = $this->refunds($refunds, $settlement, $sale->currency);
            $lines = $locked->lines()->get();

            $this->restock($sale, $locked, $lines);
            $now = now();
            foreach ($lines->filter(fn (SaleReturnLine $l) => ! empty($l->serials)) as $line) {
                SaleLineSerial::query()
                    ->where('sale_line_id', $line->sale_line_id)
                    ->whereNull('released_at')
                    ->whereIn(DB::raw('lower(serial)'), array_map(mb_strtolower(...), $line->serials))
                    ->update(['released_at' => $now]);
            }

            foreach ($refundLines as $refund) {
                SaleReturnRefund::query()->create([
                    'organization_id' => $locked->organization_id,
                    'sale_return_id' => $locked->id,
                    'method' => $refund['method'],
                    'amount' => $refund['amount'],
                    'reference' => $refund['reference'],
                    'created_by' => $actor->getAuthIdentifier(),
                    'created_at' => $now,
                ]);
            }
            $this->payments->record($actor, $locked->branch_id, array_values(array_map(
                fn (array $r) => new LedgerEntry(PaymentDirection::Out, LedgerMethod::from($r['method']->value), $r['amount'], $sale->customer_id, $r['reference']),
                array_filter($refundLines, fn (array $r) => $r['method'] !== PaymentMethod::LoyaltyPoints),
            )), new PaymentSource('sale_return', $locked->id, $locked->number));

            $locked->update([
                'status' => ReturnStatus::Completed,
                'credited_total' => $settlement['credit'],
                'refunded_total' => $settlement['refund_due'],
                'decided_by' => $actor->getAuthIdentifier(),
                'decided_at' => $now,
            ]);

            if ($sale->customer_id !== null) {
                $returned = (string) SaleReturn::query()->where('sale_id', $sale->id)->where('status', ReturnStatus::Completed)->sum('total');
                $pointsRefunded = array_reduce(
                    array_filter($refundLines, fn (array $r) => $r['method'] === PaymentMethod::LoyaltyPoints),
                    fn (string $sum, array $r) => Decimal::add($sum, $r['amount'], 2),
                    '0.00',
                );
                $share = Decimal::isZero($sale->total) ? '1' : Decimal::div(Decimal::round($returned, 2), $sale->total, 6);
                $this->loyalty->reverseReturn($sale->customer_id, $sale->id, $locked->id, $locked->number, $share, $pointsRefunded);
            }

            $this->audit->record('sale_return.completed', $locked, old: ['status' => ReturnStatus::Pending->value], new: [
                'status' => ReturnStatus::Completed->value,
                'number' => $locked->number,
                'sale' => $sale->number,
                'total' => $locked->total,
                'credited_total' => $locked->credited_total,
                'refunded_total' => $locked->refunded_total,
                'refunds' => array_map(fn (array $r) => ['method' => $r['method']->value, 'amount' => $r['amount']], $refundLines),
            ]);

            return $locked;
        });
    }

    /**
     * Restocked lines go back to the batches they were sold from (most recent allocation
     * first), at the allocation's cost, skipping what earlier returns already put back.
     *
     * @param  iterable<SaleReturnLine>  $lines
     */
    private function restock(Sale $sale, SaleReturn $return, iterable $lines): void
    {
        $changes = [];
        $records = [];
        foreach ($lines as $line) {
            if (! $line->restock) {
                continue;
            }
            $allocations = SaleLineStock::query()->where('sale_line_id', $line->sale_line_id)->orderByDesc('id')->get();
            if ($allocations->isEmpty()) {
                continue; // services and other untracked items
            }
            $back = SaleReturnLineStock::query()->whereIn('sale_line_stock_id', $allocations->pluck('id'))
                ->groupBy('sale_line_stock_id')->selectRaw('sale_line_stock_id, SUM(quantity) as quantity')->pluck('quantity', 'sale_line_stock_id');

            $left = $line->quantity;
            foreach ($allocations as $allocation) {
                if (Decimal::compare($left, '0') <= 0) {
                    break;
                }
                $free = Decimal::sub($allocation->quantity, Decimal::round((string) ($back[$allocation->id] ?? '0'), 3), 3);
                if (Decimal::compare($free, '0') <= 0) {
                    continue;
                }
                $take = Decimal::compare($free, $left) < 0 ? $free : $left;
                $changes[] = new StockChange($sale->store_id, $line->variant_id, $allocation->batch_id, MovementType::SaleReturn, $take, $allocation->unit_cost);
                $records[] = ['line' => $line, 'allocation' => $allocation, 'quantity' => $take];
                $left = Decimal::sub($left, $take, 3);
            }
            if (Decimal::compare($left, '0') > 0) {
                throw new LogicException("Return line {$line->id} exceeds the stock its sale line took.");
            }
        }

        $this->stock->post($changes, new StockReference('sale_return', $return->id, $return->number));
        foreach ($records as $record) {
            SaleReturnLineStock::query()->create([
                'organization_id' => $return->organization_id,
                'sale_return_line_id' => $record['line']->id,
                'sale_line_stock_id' => $record['allocation']->id,
                'batch_id' => $record['allocation']->batch_id,
                'quantity' => $record['quantity'],
                'unit_cost' => $record['allocation']->unit_cost,
            ]);
        }
    }

    /**
     * @param  list<array{method: string, amount: string|int|float, reference?: ?string}>  $refunds
     * @param  array{credit: string, refund_due: string, refundable: list<array{method: string, label: string, max: ?string}>}  $settlement
     * @return list<array{method: PaymentMethod, amount: string, reference: ?string}>
     *
     * @throws BusinessRuleViolation REFUND_MISMATCH
     * @throws ValidationException
     */
    private function refunds(array $refunds, array $settlement, string $currency): array
    {
        $limits = array_column($settlement['refundable'], 'max', 'method');
        $errors = [];
        $total = Money::zero($currency);
        $byMethod = [];
        $result = [];

        foreach (array_values($refunds) as $i => $refund) {
            $method = PaymentMethod::tryFrom((string) $refund['method']);
            $amount = Money::of((string) $refund['amount'], $currency);
            if ($method === null || ! array_key_exists($method->value, $limits)) {
                $errors["refunds.{$i}.method"] = ['Nothing was paid this way on the invoice; refund in cash or the way it was paid.'];

                continue;
            }
            if (! $amount->isPositive()) {
                $errors["refunds.{$i}.amount"] = ['The amount must be greater than zero.'];

                continue;
            }
            $byMethod[$method->value] = ($byMethod[$method->value] ?? Money::zero($currency))->plus($amount);
            if ($limits[$method->value] !== null && $byMethod[$method->value]->greaterThan(Money::of($limits[$method->value], $currency))) {
                $errors["refunds.{$i}.amount"] = ["At most {$limits[$method->value]} can be refunded by {$method->label()}."];
            }
            $total = $total->plus($amount);
            $result[] = ['method' => $method, 'amount' => $amount->amount(), 'reference' => filled($refund['reference'] ?? null) ? trim((string) $refund['reference']) : null];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        if (! $total->equals(Money::of($settlement['refund_due'], $currency))) {
            throw new BusinessRuleViolation('REFUND_MISMATCH', "Refunds must add up to {$settlement['refund_due']} ({$settlement['credit']} is credited against the customer's balance).", [
                'refund_due' => $settlement['refund_due'],
                'credit' => $settlement['credit'],
                'refunds_total' => $total->amount(),
            ]);
        }

        return $result;
    }
}
