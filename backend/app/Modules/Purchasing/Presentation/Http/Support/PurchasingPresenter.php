<?php

namespace App\Modules\Purchasing\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptCharge;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostAllocation;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturn;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturnLine;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Output shapes of purchasing documents, with display data from the owning modules.
 */
class PurchasingPresenter
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SupplierDirectory $suppliers,
        private readonly BranchDirectory $branches,
        private readonly ProductDirectory $products,
        private readonly BatchDirectory $batches,
    ) {}

    public function scopeBranches(Builder $query, TenantUser $user): void
    {
        $accessible = $user->accessibleBranchIds();
        if ($accessible !== null) {
            $query->whereIn('branch_id', $accessible);
        }
    }

    public function assertVisible(TenantUser $user, ?string $branchId): void
    {
        if ($branchId !== null && ! $user->canAccessBranch($branchId)) {
            throw new NotFoundHttpException;
        }
    }

    /**
     * @param  Collection<int, PurchaseOrder|GoodsReceipt|PurchaseReturn>  $documents
     * @return callable(PurchaseOrder|GoodsReceipt|PurchaseReturn): array<string, mixed>
     */
    public function headers(Collection $documents): callable
    {
        $org = $this->tenant->requireOrganization();
        $suppliers = $this->suppliers->summaries($org, $documents->pluck('supplier_id')->all());
        $stores = $this->branches->storeSummaries($org, $documents->pluck('store_id')->all());

        return fn ($doc) => $this->header($doc, $suppliers, $stores);
    }

    /**
     * @return array<string, mixed>
     */
    public function document(PurchaseOrder|GoodsReceipt|PurchaseReturn $doc): array
    {
        $lines = $doc->lines()->get();
        $org = $this->tenant->requireOrganization();
        $variants = $this->products->variants($org, $lines->pluck('variant_id')->all());
        $batches = $this->batches->summaries($org, $lines->pluck('batch_id')->filter()->values()->all());
        $voucherCosts = $doc instanceof GoodsReceipt ? $this->voucherCostsByLine($doc) : [];

        $document = ($this->headers(collect([$doc])))($doc) + [
            'lines' => $lines->map(function (PurchaseOrderLine|GoodsReceiptLine|PurchaseReturnLine $l) use ($variants, $batches, $voucherCosts) {
                $variant = $variants[$l->variant_id] ?? null;
                $batch = ($l->batch_id ?? null) === null ? null : $batches[$l->batch_id] ?? null;

                return array_filter([
                    'id' => $l->id,
                    'variant' => $variant === null ? null : [
                        'id' => $variant['variant_id'],
                        'product_name' => $variant['product_name'],
                        'variant_name' => $variant['variant_name'],
                        'sku' => $variant['sku'],
                        'unit_code' => $variant['unit_code'],
                        'allow_decimal' => $variant['allow_decimal'],
                        'track_batches' => $variant['track_batches'],
                    ],
                    'batch' => $batch,
                    'quantity' => $l->quantity,
                    'received_quantity' => $l instanceof PurchaseOrderLine ? $l->received_quantity : false,
                    'requisition_line_id' => $l instanceof PurchaseOrderLine ? $l->requisition_line_id : false,
                    'returned_quantity' => $l instanceof GoodsReceiptLine ? $l->returned_quantity : false,
                    'purchase_order_line_id' => $l instanceof GoodsReceiptLine ? $l->purchase_order_line_id : false,
                    'goods_receipt_line_id' => $l instanceof PurchaseReturnLine ? $l->goods_receipt_line_id : false,
                    'unit_cost' => $l->unit_cost,
                    'tax_rate' => $l->tax_rate,
                    'line_subtotal' => $l->line_subtotal,
                    'line_tax' => $l->line_tax,
                    'line_total' => $l->line_total,
                    // SC3: landed cost from the receipt's charges, the cost the stock entered at,
                    // and what posted landed cost vouchers added later.
                    'landed_cost' => $l instanceof GoodsReceiptLine ? $l->landed_cost : false,
                    'landed_unit_cost' => $l instanceof GoodsReceiptLine ? $l->landed_unit_cost : false,
                    'voucher_landed_cost' => $l instanceof GoodsReceiptLine ? ($voucherCosts[$l->id] ?? '0.00') : false,
                ], fn ($v) => $v !== false);
            })->values()->all(),
        ];

        if ($doc instanceof GoodsReceipt) {
            $document += $this->receiptLandedCost($doc);
        }

        return $document;
    }

    /**
     * SC3: the receipt's charges and the posted landed cost vouchers applied to it.
     *
     * @return array{charges: list<array<string, mixed>>, landed_cost_vouchers: list<array<string, mixed>>}
     */
    private function receiptLandedCost(GoodsReceipt $receipt): array
    {
        $org = $this->tenant->requireOrganization();
        $charges = $receipt->charges()->get();
        $suppliers = $this->suppliers->summaries($org, $charges->pluck('charge_supplier_id')->filter()->values()->all());

        $vouchers = LandedCostAllocation::query()
            ->join('landed_cost_vouchers as v', 'v.id', '=', 'landed_cost_allocations.landed_cost_voucher_id')
            ->where('landed_cost_allocations.goods_receipt_id', $receipt->id)
            ->groupBy('v.id', 'v.number', 'v.voucher_date')
            ->orderBy('v.number')
            ->get(['v.id', 'v.number', 'v.voucher_date', DB::raw('SUM(landed_cost_allocations.amount) as amount')]);

        return [
            'charges' => $charges->map(fn (GoodsReceiptCharge $c) => [
                'id' => $c->id,
                'type' => $c->type->value,
                'type_label' => $c->type->label(),
                'description' => $c->description,
                'amount' => $c->amount,
                'tax_amount' => $c->tax_amount,
                'allocation' => $c->allocation->value,
                'charge_supplier' => $c->charge_supplier_id === null ? null : ($suppliers[$c->charge_supplier_id] ?? null),
            ])->values()->all(),
            'landed_cost_vouchers' => $vouchers->map(fn ($v) => [
                'id' => $v->id,
                'number' => $v->number,
                'voucher_date' => substr((string) $v->voucher_date, 0, 10),
                'amount' => Decimal::round((string) $v->amount, 2),
            ])->values()->all(),
        ];
    }

    /**
     * @return array<string, string> receipt line id => Σ amounts of posted vouchers
     */
    private function voucherCostsByLine(GoodsReceipt $receipt): array
    {
        return LandedCostAllocation::query()
            ->where('goods_receipt_id', $receipt->id)
            ->groupBy('goods_receipt_line_id')
            ->get(['goods_receipt_line_id', DB::raw('SUM(amount) as amount')])
            ->mapWithKeys(fn ($row) => [$row->goods_receipt_line_id => Decimal::round((string) $row->amount, 2)])
            ->all();
    }

    /**
     * @param  array<string, array<string, mixed>>  $suppliers
     * @param  array<string, array<string, mixed>>  $stores
     * @return array<string, mixed>
     */
    private function header(PurchaseOrder|GoodsReceipt|PurchaseReturn $doc, array $suppliers, array $stores): array
    {
        $base = [
            'id' => $doc->id,
            'number' => $doc->number,
            'supplier' => $suppliers[$doc->supplier_id] ?? null,
            'store' => $stores[$doc->store_id] ?? null,
            'currency' => $doc->currency,
            'subtotal' => $doc->subtotal,
            'tax_total' => $doc->tax_total,
            'total' => $doc->total,
            'notes' => $doc->notes,
            'created_at' => $doc->created_at?->toIso8601String(),
        ];

        return match (true) {
            $doc instanceof PurchaseOrder => $base + [
                'status' => $doc->status->value,
                'order_date' => $doc->order_date->toDateString(),
                'expected_date' => $doc->expected_date?->toDateString(),
                'ordered_at' => $doc->ordered_at?->toIso8601String(),
                // SC2: approval.
                'requisition_id' => $doc->requisition_id,
                'rfq_id' => $doc->rfq_id,
                'approval_level' => $doc->approval_level?->value,
                'submitted_at' => $doc->submitted_at?->toIso8601String(),
            ],
            $doc instanceof GoodsReceipt => $base + [
                'purchase_order_id' => $doc->purchase_order_id,
                'supplier_invoice_number' => $doc->supplier_invoice_number,
                'invoice_date' => $doc->invoice_date->toDateString(),
                'due_date' => $doc->due_date?->toDateString(),
                // SC3: goods total = subtotal/tax_total/total; charges (capitalised) and their
                // tax; landed total = subtotal + charges; payable = what the main supplier billed.
                'charges_total' => $doc->charges_total,
                'charges_tax_total' => $doc->charges_tax_total,
                'landed_total' => $doc->landed_total,
                'payable_total' => $doc->payable_total,
            ],
            default => $base + [
                'goods_receipt_id' => $doc->goods_receipt_id,
                'reason' => $doc->reason,
            ],
        };
    }
}
