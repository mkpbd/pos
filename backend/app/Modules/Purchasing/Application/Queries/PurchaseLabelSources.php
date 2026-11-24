<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Products\Application\Contracts\LabelSources;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Shared\Application\Contracts\TenantUser;

/**
 * ST1: implements Products' LabelSources — the lines of a goods receipt (received quantity,
 * batch and expiry) or of a purchase order (ordered quantity) for printing labels, only for
 * documents of the organization in a branch the user may access.
 */
final class PurchaseLabelSources implements LabelSources
{
    public function __construct(private readonly BatchDirectory $batches) {}

    public function goodsReceiptLines(TenantUser $user, string $organizationId, string $goodsReceiptId): ?array
    {
        $receipt = GoodsReceipt::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)->whereKey($goodsReceiptId)->first();
        if ($receipt === null || ! $user->canAccessBranch($receipt->branch_id)) {
            return null;
        }

        $lines = GoodsReceiptLine::query()->withoutGlobalScope('organization')
            ->where('goods_receipt_id', $receipt->id)->orderBy('id')->get(['variant_id', 'batch_id', 'quantity']);
        $batches = $this->batches->summaries($organizationId, $lines->pluck('batch_id')->filter()->unique()->values()->all());

        return $lines->map(fn (GoodsReceiptLine $line) => [
            'variant_id' => $line->variant_id,
            'quantity' => (string) $line->quantity,
            'batch_number' => $line->batch_id === null ? null : ($batches[$line->batch_id]['batch_number'] ?? null),
            'expires_on' => $line->batch_id === null ? null : ($batches[$line->batch_id]['expires_on'] ?? null),
        ])->all();
    }

    public function purchaseOrderLines(TenantUser $user, string $organizationId, string $purchaseOrderId): ?array
    {
        $order = PurchaseOrder::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)->whereKey($purchaseOrderId)->first();
        if ($order === null || ! $user->canAccessBranch($order->branch_id)) {
            return null;
        }

        return PurchaseOrderLine::query()->withoutGlobalScope('organization')
            ->where('purchase_order_id', $order->id)->orderBy('sort_order')->orderBy('id')->get(['variant_id', 'quantity'])
            ->map(fn (PurchaseOrderLine $line) => [
                'variant_id' => $line->variant_id,
                'quantity' => (string) $line->quantity,
                'batch_number' => null,
                'expires_on' => null,
            ])->all();
    }
}
