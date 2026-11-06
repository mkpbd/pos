<?php

namespace App\Modules\Purchasing\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Services\LandedCostCalculator;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostAllocator;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostVoucherStatus;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostAllocation;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucher;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucherCharge;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;

/**
 * Output shapes of landed cost vouchers and their allocation tables (SC3).
 */
class LandedCostPresenter
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly SupplierDirectory $suppliers,
        private readonly ProductDirectory $products,
        private readonly BatchDirectory $batches,
        private readonly UserDirectory $users,
        private readonly LandedCostCalculator $calculator,
    ) {}

    /**
     * @param  Collection<int, LandedCostVoucher>  $vouchers
     * @return callable(LandedCostVoucher): array<string, mixed>
     */
    public function headers(Collection $vouchers): callable
    {
        $org = $this->tenant->requireOrganization();
        $branches = collect($this->branches->summaries($org, $vouchers->pluck('branch_id')->unique()->values()->all()))->keyBy('id');
        $suppliers = $this->suppliers->summaries($org, $vouchers->pluck('charge_supplier_id')->unique()->values()->all());
        $names = $this->users->names($org, $vouchers->flatMap(fn (LandedCostVoucher $v) => [$v->created_by, $v->posted_by])->filter()->unique()->values()->all());
        $receipts = GoodsReceipt::query()
            ->join('landed_cost_voucher_receipts as vr', 'vr.goods_receipt_id', '=', 'goods_receipts.id')
            ->whereIn('vr.landed_cost_voucher_id', $vouchers->pluck('id')->all())
            ->orderBy('vr.sort_order')
            ->get(['goods_receipts.number', 'vr.landed_cost_voucher_id'])
            ->groupBy('landed_cost_voucher_id');

        return fn (LandedCostVoucher $v) => [
            'id' => $v->id,
            'number' => $v->number,
            'status' => $v->status->value,
            'branch' => isset($branches[$v->branch_id]) ? ['id' => $v->branch_id, 'name' => $branches[$v->branch_id]['name']] : null,
            'voucher_date' => $v->voucher_date->toDateString(),
            'charge_supplier' => $suppliers[$v->charge_supplier_id] ?? null,
            'reference' => $v->reference,
            'notes' => $v->notes,
            'currency' => $v->currency,
            'charges_total' => $v->charges_total,
            'tax_total' => $v->tax_total,
            'total' => $v->total,
            'on_hand_total' => $v->on_hand_total,
            'consumed_total' => $v->consumed_total,
            'expense' => $v->expense_id === null ? null : ['id' => $v->expense_id, 'number' => $v->expense_number],
            'receipt_numbers' => ($receipts[$v->id] ?? collect())->pluck('number')->values()->all(),
            'receipt_count' => ($receipts[$v->id] ?? collect())->count(),
            'posted_at' => $v->posted_at?->toIso8601String(),
            'posted_by' => $v->posted_by === null ? null : ['id' => $v->posted_by, 'name' => $names[$v->posted_by] ?? null],
            'created_by' => $v->created_by === null ? null : ['id' => $v->created_by, 'name' => $names[$v->created_by] ?? null],
            'created_at' => $v->created_at?->toIso8601String(),
            'updated_at' => $v->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The voucher with its charges, receipts and allocation table: the stored rows once
     * posted, a live preview (stock on hand now) while it is a draft.
     *
     * @return array<string, mixed>
     */
    public function document(LandedCostVoucher $voucher): array
    {
        $org = $this->tenant->requireOrganization();
        $charges = $voucher->charges()->get();
        $receiptIds = $voucher->receipts()->pluck('goods_receipt_id')->all();
        $found = GoodsReceipt::query()->whereKey($receiptIds)->get()->keyBy('id');
        $receipts = collect($receiptIds)->map(fn (string $id) => $found[$id] ?? null)->filter()->values();

        if ($voucher->status === LandedCostVoucherStatus::Posted) {
            $numbers = $receipts->pluck('number', 'id');
            $allocations = $voucher->allocations()->get();
            $lines = GoodsReceiptLine::query()->whereKey($allocations->pluck('goods_receipt_line_id')->all())->get()->keyBy('id');
            // What vouchers posted before this one had already added to the same lines.
            $earlier = LandedCostAllocation::query()
                ->whereIn('goods_receipt_line_id', $lines->keys()->all())
                ->where('landed_cost_voucher_id', '!=', $voucher->id)
                ->where('created_at', '<', $allocations->first()?->getRawOriginal('created_at'))
                ->get(['goods_receipt_line_id', 'amount'])
                ->groupBy('goods_receipt_line_id')
                ->map(fn (Collection $g) => $g->reduce(fn (string $sum, LandedCostAllocation $a) => Decimal::add($sum, $a->amount, 2), '0.00'));
            $rows = $allocations->map(function (LandedCostAllocation $a) use ($numbers, $lines, $earlier) {
                $line = $lines[$a->goods_receipt_line_id];
                $previous = $earlier[$a->goods_receipt_line_id] ?? '0.00';

                return [
                    'goods_receipt_id' => $a->goods_receipt_id,
                    'goods_receipt_number' => $numbers[$a->goods_receipt_id] ?? null,
                    'goods_receipt_line_id' => $a->goods_receipt_line_id,
                    'store_id' => $a->store_id,
                    'variant_id' => $a->variant_id,
                    'batch_id' => $a->batch_id,
                    'received_quantity' => $a->received_quantity,
                    'returned_quantity' => $line->returned_quantity,
                    'on_hand_quantity' => $a->on_hand_quantity,
                    'consumed_quantity' => Decimal::sub($a->received_quantity, $a->on_hand_quantity, 3),
                    'line_value' => $line->line_subtotal,
                    'amount' => $a->amount,
                    'on_hand_amount' => $a->on_hand_amount,
                    'consumed_amount' => $a->consumed_amount,
                    'landed_unit_cost' => $line->landed_unit_cost,
                    'previous_voucher_cost' => $previous,
                    'new_landed_unit_cost' => LandedCostAllocator::landedUnitCost($line->landed_unit_cost, Decimal::add($previous, $a->amount, 2), $line->quantity),
                    'average_cost_before' => $a->average_cost_before,
                    'average_cost_after' => $a->average_cost_after,
                    'stock_movement_id' => $a->stock_movement_id,
                ];
            })->all();
            $source = 'posted';
        } else {
            $table = $this->calculator->calculate($org, $voucher->currency, $charges->map(fn (LandedCostVoucherCharge $c) => [
                'amount' => $c->amount,
                'allocation' => $c->allocation->value,
            ])->all(), $receipts);
            $rows = array_map(fn (array $r) => $r + ['stock_movement_id' => null], $table['lines']);
            $source = 'preview';
        }

        return ($this->headers(collect([$voucher])))($voucher) + [
            'charges' => $charges->map(fn (LandedCostVoucherCharge $c) => self::charge($c))->values()->all(),
            'receipts' => $this->receipts($receipts),
            'allocation_source' => $source,
            'allocations' => $this->allocationRows($rows),
        ];
    }

    /**
     * The preview of a draft body (not saved).
     *
     * @param  array{charges: list<array<string, mixed>>, receipts: Collection<int, GoodsReceipt>, charges_total: string, tax_total: string, total: string}  $draft
     * @return array<string, mixed>
     */
    public function preview(array $draft, string $currency): array
    {
        $table = $this->calculator->calculate($this->tenant->requireOrganization(), $currency, $draft['charges'], $draft['receipts']);

        return [
            'currency' => $currency,
            'charges_total' => $draft['charges_total'],
            'tax_total' => $draft['tax_total'],
            'total' => $draft['total'],
            'on_hand_total' => $table['on_hand_total'],
            'consumed_total' => $table['consumed_total'],
            'receipts' => $this->receipts($draft['receipts']),
            'allocations' => $this->allocationRows(array_map(fn (array $r) => $r + ['stock_movement_id' => null], $table['lines'])),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function charge(LandedCostVoucherCharge $c): array
    {
        return [
            'id' => $c->id,
            'type' => $c->type->value,
            'type_label' => $c->type->label(),
            'description' => $c->description,
            'amount' => $c->amount,
            'tax_amount' => $c->tax_amount,
            'allocation' => $c->allocation->value,
        ];
    }

    /**
     * @param  Collection<int, GoodsReceipt>  $receipts
     * @return list<array<string, mixed>>
     */
    private function receipts(Collection $receipts): array
    {
        $org = $this->tenant->requireOrganization();
        $suppliers = $this->suppliers->summaries($org, $receipts->pluck('supplier_id')->unique()->values()->all());
        $stores = $this->branches->storeSummaries($org, $receipts->pluck('store_id')->unique()->values()->all());

        return $receipts->map(fn (GoodsReceipt $r) => [
            'id' => $r->id,
            'number' => $r->number,
            'supplier' => $suppliers[$r->supplier_id] ?? null,
            'store' => $stores[$r->store_id] ?? null,
            'supplier_invoice_number' => $r->supplier_invoice_number,
            'invoice_date' => $r->invoice_date->toDateString(),
            'subtotal' => $r->subtotal,
            'charges_total' => $r->charges_total,
            'landed_total' => $r->landed_total,
        ])->values()->all();
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function allocationRows(array $rows): array
    {
        $org = $this->tenant->requireOrganization();
        $variants = $this->products->variants($org, array_values(array_unique(array_column($rows, 'variant_id'))));
        $batches = $this->batches->summaries($org, array_values(array_unique(array_filter(array_column($rows, 'batch_id')))));
        $stores = $this->branches->storeSummaries($org, array_values(array_unique(array_column($rows, 'store_id'))));

        return array_map(function (array $row) use ($variants, $batches, $stores) {
            $variant = $variants[$row['variant_id']] ?? null;
            unset($row['level_key']);

            return [
                'goods_receipt_id' => $row['goods_receipt_id'],
                'goods_receipt_number' => $row['goods_receipt_number'],
                'goods_receipt_line_id' => $row['goods_receipt_line_id'],
                'store' => $stores[$row['store_id']] ?? null,
                'variant' => $variant === null ? null : [
                    'id' => $variant['variant_id'],
                    'product_name' => $variant['product_name'],
                    'variant_name' => $variant['variant_name'],
                    'sku' => $variant['sku'],
                    'unit_code' => $variant['unit_code'],
                ],
                'batch' => $row['batch_id'] === null ? null : ($batches[$row['batch_id']] ?? null),
            ] + array_diff_key($row, array_flip(['goods_receipt_id', 'goods_receipt_number', 'goods_receipt_line_id', 'store_id', 'variant_id', 'batch_id']));
        }, $rows);
    }
}
