<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Expenses\Application\Contracts\ExpenseRecorder;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Domain\RemittanceMethod;
use App\Modules\Orders\Infrastructure\Models\CodRemittance;
use App\Modules\Orders\Infrastructure\Models\CodRemittanceLine;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A courier's cash-on-delivery remittance (E10a): the courier pays for a batch of delivered
 * COD orders, minus its fee. All or nothing: every order must be this organization's,
 * cash on delivery, delivered, unpaid and shipped with this courier, else REMITTANCE_INVALID
 * with a reason per offending order. In one transaction, with the orders locked in id order:
 * the REM- number, the courier fee as an expense in "Courier fees" (Expenses module, through
 * the ledger, method cash_on_delivery — the fee was kept out of the collected cash), the
 * remittance and its lines, and per order the shared COD payment path
 * (OrderWorkflow::recordCodPaymentLocked: `cash_on_delivery` for the order total, order paid,
 * reference = the REM number). Remittances are append-only.
 */
class RecordCodRemittance
{
    public const FEE_CATEGORY = 'Courier fees';

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly CourierDirectory $couriers,
        private readonly SequenceGenerator $sequences,
        private readonly ExpenseRecorder $expenses,
        private readonly OrderWorkflow $workflow,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{courier_id: string, reference?: ?string, received_at: string, method: string, fee_amount: string, order_ids: list<string>, note?: ?string}  $data
     *
     * @throws BusinessRuleViolation REMITTANCE_INVALID (details.orders: [{id, number, reason}])
     * @throws ValidationException courier_id, fee_amount
     */
    public function __invoke(array $data, string $actorId): CodRemittance
    {
        $organizationId = $this->tenant->requireOrganization();
        $courier = $this->couriers->find($data['courier_id'])
            ?? throw ValidationException::withMessages(['courier_id' => ['The selected courier does not exist.']]);
        $currency = $this->organizations->summary($organizationId)['base_currency'] ?? config('pos.default_currency');
        $fee = Money::of($data['fee_amount'], $currency);
        $method = RemittanceMethod::from($data['method']);
        $orderIds = array_values(array_unique($data['order_ids']));
        $clean = fn (string $key) => filled($data[$key] ?? null) ? trim((string) $data[$key]) : null;

        return DB::transaction(function () use ($organizationId, $courier, $currency, $fee, $method, $orderIds, $clean, $data, $actorId) {
            $orders = Order::query()->whereIn('id', $orderIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $shipments = Shipment::query()->whereIn('order_id', $orders->keys()->all())->get()->keyBy('order_id');

            $invalid = [];
            foreach ($orderIds as $id) {
                /** @var Order|null $order */
                $order = $orders->get($id);
                $reason = match (true) {
                    $order === null => 'not_found',
                    $order->payment_method !== OrderPaymentMethod::CashOnDelivery => 'not_cod',
                    $order->payment_status === PaymentStatus::Paid => 'already_paid',
                    $order->status !== OrderStatus::Delivered => 'not_delivered',
                    $shipments->get($id)?->courier_id !== $courier['id'] => 'other_courier',
                    default => null,
                };
                if ($reason !== null) {
                    $invalid[] = ['id' => $id, 'number' => $order?->number, 'reason' => $reason];
                }
            }
            if ($invalid !== []) {
                throw new BusinessRuleViolation(
                    'REMITTANCE_INVALID',
                    count($invalid) === 1 ? 'One order cannot be part of this remittance.' : count($invalid).' orders cannot be part of this remittance.',
                    ['orders' => $invalid],
                );
            }

            $sorted = $orders->values();
            $gross = $sorted->reduce(fn (Money $sum, Order $o) => $sum->plus(Money::of((string) $o->total, $currency)), Money::zero($currency));
            if ($fee->greaterThan($gross)) {
                throw ValidationException::withMessages(['fee_amount' => ["The courier fee cannot be more than the collected amount ({$gross->amount()})."]]);
            }

            $number = $this->sequences->next($organizationId, 'cod_remittance', 'REM-');
            $reference = $clean('reference');
            $receivedAt = (string) $data['received_at'];

            $expense = null;
            if ($fee->isPositive()) {
                $expense = $this->expenses->recordSystemExpense([
                    'branch_id' => $sorted->first()->branch_id,
                    'category' => self::FEE_CATEGORY,
                    'amount' => $fee->amount(),
                    'method' => PaymentMethod::CashOnDelivery,
                    'occurred_on' => $receivedAt,
                    'reference' => $number,
                    'party' => $courier['name'],
                    'notes' => trim("Courier fee of COD remittance {$number}".($reference !== null ? " (statement {$reference})" : '')),
                ], $actorId);
            }

            $remittance = CodRemittance::query()->create([
                'organization_id' => $organizationId,
                'number' => $number,
                'courier_id' => $courier['id'],
                'reference' => $reference,
                'received_at' => $receivedAt,
                'method' => $method,
                'currency' => $currency,
                'gross_amount' => $gross->amount(),
                'fee_amount' => $fee->amount(),
                'net_amount' => $gross->minus($fee)->amount(),
                'expense_id' => $expense['id'] ?? null,
                'expense_number' => $expense['number'] ?? null,
                'note' => $clean('note'),
                'created_by' => $actorId,
                'created_at' => now(),
            ]);

            foreach ($sorted as $order) {
                CodRemittanceLine::query()->create([
                    'organization_id' => $organizationId,
                    'remittance_id' => $remittance->id,
                    'order_id' => $order->id,
                    'amount' => (string) $order->total,
                ]);
                $this->workflow->recordCodPaymentLocked($order, $number, $actorId);
            }

            $this->audit->record('cod_remittance.recorded', $remittance, new: [
                'number' => $number,
                'courier' => $courier['name'],
                'reference' => $reference,
                'orders' => $sorted->pluck('number')->all(),
                'gross_amount' => $remittance->gross_amount,
                'fee_amount' => $remittance->fee_amount,
                'net_amount' => $remittance->net_amount,
                'expense' => $expense['number'] ?? null,
            ]);

            return $remittance;
        });
    }
}
