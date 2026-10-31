<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\PurchaseTotals;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturn;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Returns goods to the supplier against the receipt they came on. Each line is limited to
 * what is still returnable on its receipt line (locked while checked), leaves stock at the
 * original receipt cost and reduces the amount owed to the supplier.
 */
class PostPurchaseReturn
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly ProductDirectory $products,
        private readonly StockLedger $ledger,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{reason: string, notes?: ?string, lines: list<array{goods_receipt_line_id: string, quantity: string}>}  $data
     */
    public function __invoke(TenantUser $actor, GoodsReceipt $receipt, array $data): PurchaseReturn
    {
        if (! $actor->canAccessBranch($receipt->branch_id)) {
            throw new NotFoundHttpException;
        }
        $organizationId = $this->context->organizationId();
        $requested = array_values($data['lines']);

        return DB::transaction(function () use ($actor, $organizationId, $receipt, $data, $requested) {
            $receiptLines = GoodsReceiptLine::query()
                ->where('goods_receipt_id', $receipt->id)
                ->whereKey(array_column($requested, 'goods_receipt_line_id'))
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');
            $variants = $this->products->variants($organizationId, $receiptLines->pluck('variant_id')->all());

            $errors = [];
            $returning = [];
            foreach ($requested as $i => $line) {
                $receiptLine = $receiptLines[$line['goods_receipt_line_id']] ?? null;
                if ($receiptLine === null) {
                    $errors["lines.{$i}.goods_receipt_line_id"] = ['This line is not on the receipt.'];

                    continue;
                }
                $returning[$receiptLine->id] = Decimal::add($returning[$receiptLine->id] ?? '0', $line['quantity'], 3);
                $returnable = Decimal::sub($receiptLine->quantity, $receiptLine->returned_quantity, 3);
                if (Decimal::compare($returning[$receiptLine->id], $returnable) > 0) {
                    $errors["lines.{$i}.quantity"] = ["Only {$returnable} can still be returned."];
                }
                if (! ($variants[$receiptLine->variant_id]['allow_decimal'] ?? false) && ! Decimal::isWhole($line['quantity'])) {
                    $errors["lines.{$i}.quantity"] = ['This product is returned in whole units.'];
                }
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $priced = array_map(fn (array $l) => [
                'quantity' => $l['quantity'],
                'unit_cost' => $receiptLines[$l['goods_receipt_line_id']]->unit_cost,
                'tax_rate' => $receiptLines[$l['goods_receipt_line_id']]->tax_rate,
            ], $requested);
            $totals = PurchaseTotals::calculate($priced, $receipt->currency);

            $return = PurchaseReturn::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'purchase_return', 'PRN-'),
                'supplier_id' => $receipt->supplier_id,
                'branch_id' => $receipt->branch_id,
                'store_id' => $receipt->store_id,
                'goods_receipt_id' => $receipt->id,
                'reason' => $data['reason'],
                'notes' => $data['notes'] ?? null,
                'currency' => $receipt->currency,
                'subtotal' => $totals['subtotal'],
                'tax_total' => $totals['tax_total'],
                'total' => $totals['total'],
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $changes = [];
            foreach ($requested as $i => $line) {
                $receiptLine = $receiptLines[$line['goods_receipt_line_id']];
                $return->lines()->create([
                    'organization_id' => $organizationId,
                    'goods_receipt_line_id' => $receiptLine->id,
                    'variant_id' => $receiptLine->variant_id,
                    'batch_id' => $receiptLine->batch_id,
                    'quantity' => Decimal::round($line['quantity'], 3),
                    'unit_cost' => $receiptLine->unit_cost,
                    'tax_rate' => $receiptLine->tax_rate,
                    ...$totals['lines'][$i],
                ]);
                $changes[] = new StockChange($receipt->store_id, $receiptLine->variant_id, $receiptLine->batch_id, MovementType::PurchaseReturn, $line['quantity'], $receiptLine->unit_cost);
            }

            foreach ($returning as $lineId => $quantity) {
                $receiptLine = $receiptLines[$lineId];
                $receiptLine->returned_quantity = Decimal::add($receiptLine->returned_quantity, $quantity, 3);
                $receiptLine->save();
            }

            $this->ledger->post($changes, new StockReference('purchase_return', $return->id, $return->number));

            $this->audit->record('purchase_return.posted', $return, new: [
                'number' => $return->number,
                'goods_receipt_id' => $receipt->id,
                'total' => $return->total,
                'reason' => $return->reason,
            ]);

            return $return;
        });
    }
}
