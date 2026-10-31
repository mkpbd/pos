<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\AdjustmentReason;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Posts a stock adjustment: opening stock, physical-count differences, damage, expiry, theft
 * or corrections. Lines carry a signed quantity; increases are valued at the given unit cost
 * (or the product's purchase price), decreases at the current average cost.
 */
class PostStockAdjustment
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly ResolveBatch $resolveBatch,
        private readonly StockLedger $ledger,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{store_id: string, reason: string, note?: ?string, lines: list<array{variant_id: string, quantity: string, unit_cost?: ?string, batch_id?: ?string, batch_number?: ?string, expires_on?: ?string}>}  $data
     */
    public function __invoke(TenantUser $actor, array $data): StockAdjustment
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $reason = AdjustmentReason::from($data['reason']);
        $lines = array_values($data['lines']);

        $errors = [];
        foreach ($lines as $i => $line) {
            $negative = Decimal::isNegative($line['quantity']);
            if (Decimal::isZero($line['quantity'])) {
                $errors["lines.{$i}.quantity"] = ['Enter a quantity other than zero.'];
            } elseif ($reason->isLossOnly() && ! $negative) {
                $errors["lines.{$i}.quantity"] = ['This reason can only reduce stock.'];
            } elseif ($reason === AdjustmentReason::Opening && $negative) {
                $errors["lines.{$i}.quantity"] = ['Opening stock must be positive.'];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $increases = array_filter($lines, fn (array $l) => ! Decimal::isNegative($l['quantity']));
        $decreases = array_map(fn (array $l) => [...$l, 'quantity' => Decimal::negate($l['quantity'], 3)], array_filter($lines, fn (array $l) => Decimal::isNegative($l['quantity'])));
        $variants = $this->lineRules->validate($organizationId, $increases, 'in') + $this->lineRules->validate($organizationId, $decreases, 'out');

        return DB::transaction(function () use ($actor, $organizationId, $store, $reason, $data, $lines, $variants) {
            $adjustment = StockAdjustment::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'number' => $this->sequences->next($organizationId, 'stock_adjustment', 'ADJ-'),
                'reason' => $reason->value,
                'note' => $data['note'] ?? null,
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $changes = [];
            $batchIds = [];
            foreach ($lines as $i => $line) {
                $increase = ! Decimal::isNegative($line['quantity']);
                $batchIds[$i] = $line['batch_id'] ?? (filled($line['batch_number'] ?? null)
                    ? ($this->resolveBatch)($line['variant_id'], $line['batch_number'], $line['expires_on'] ?? null)->id
                    : null);

                $changes[] = new StockChange(
                    storeId: $store['id'],
                    variantId: $line['variant_id'],
                    batchId: $batchIds[$i],
                    type: $reason === AdjustmentReason::Opening ? MovementType::Opening : ($increase ? MovementType::AdjustmentIn : MovementType::AdjustmentOut),
                    quantity: $increase ? $line['quantity'] : Decimal::negate($line['quantity'], 3),
                    unitCost: $increase ? ($line['unit_cost'] ?? $variants[$line['variant_id']]['purchase_price']) : null,
                );
            }

            $posted = $this->ledger->post($changes, new StockReference('stock_adjustment', $adjustment->id, $adjustment->number));

            foreach ($lines as $i => $line) {
                $adjustment->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $line['variant_id'],
                    'batch_id' => $batchIds[$i],
                    'quantity' => Decimal::round($line['quantity'], 3),
                    'unit_cost' => $posted[$i]['unit_cost'] ?? '0',
                ]);
            }

            $this->audit->record('stock_adjustment.posted', $adjustment, new: [
                'number' => $adjustment->number,
                'reason' => $reason->value,
                'store_id' => $store['id'],
                'lines' => count($lines),
            ]);

            return $adjustment;
        });
    }
}
