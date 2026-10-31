<?php

namespace App\Modules\Purchasing\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturn;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturnLine;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
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

        return ($this->headers(collect([$doc])))($doc) + [
            'lines' => $lines->map(function (PurchaseOrderLine|GoodsReceiptLine|PurchaseReturnLine $l) use ($variants, $batches) {
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
                    'returned_quantity' => $l instanceof GoodsReceiptLine ? $l->returned_quantity : false,
                    'purchase_order_line_id' => $l instanceof GoodsReceiptLine ? $l->purchase_order_line_id : false,
                    'goods_receipt_line_id' => $l instanceof PurchaseReturnLine ? $l->goods_receipt_line_id : false,
                    'unit_cost' => $l->unit_cost,
                    'tax_rate' => $l->tax_rate,
                    'line_subtotal' => $l->line_subtotal,
                    'line_tax' => $l->line_tax,
                    'line_total' => $l->line_total,
                ], fn ($v) => $v !== false);
            })->values()->all(),
        ];
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
            ],
            $doc instanceof GoodsReceipt => $base + [
                'purchase_order_id' => $doc->purchase_order_id,
                'supplier_invoice_number' => $doc->supplier_invoice_number,
                'invoice_date' => $doc->invoice_date->toDateString(),
                'due_date' => $doc->due_date?->toDateString(),
            ],
            default => $base + [
                'goods_receipt_id' => $doc->goods_receipt_id,
                'reason' => $doc->reason,
            ],
        };
    }
}
