<?php

namespace App\Modules\Inventory\Infrastructure\Notifications;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Events\StockFellBelowReorderLevel;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Notification;

/**
 * Tells everyone who manages stock in the branch that a product needs reordering.
 * Queued, so posting a sale or adjustment never waits for notification delivery.
 */
class NotifyLowStock implements ShouldQueue
{
    public function __construct(
        private readonly UserDirectory $users,
        private readonly ProductDirectory $products,
        private readonly BranchDirectory $branches,
    ) {}

    public function handle(StockFellBelowReorderLevel $event): void
    {
        $recipients = $this->users->withPermissionInBranch($event->organizationId, 'inventory.view', $event->branchId);
        if ($recipients->isEmpty()) {
            return;
        }

        $variant = $this->products->variants($event->organizationId, [$event->variantId])[$event->variantId] ?? null;
        $store = $this->branches->storeSummaries($event->organizationId, [$event->storeId])[$event->storeId] ?? null;

        Notification::send($recipients, new LowStockNotification([
            'title' => 'Low stock: '.($variant['product_name'] ?? 'product'),
            'message' => sprintf('%s (%s) is at %s %s in %s — reorder level %s.',
                $variant['product_name'] ?? '?', $variant['sku'] ?? '?', $event->quantity, $variant['unit_code'] ?? '',
                $store['name'] ?? 'a store', $event->reorderLevel),
            'variant_id' => $event->variantId,
            'store_id' => $event->storeId,
            'branch_id' => $event->branchId,
            'quantity' => $event->quantity,
            'reorder_level' => $event->reorderLevel,
            'link' => '/inventory?low_stock=1',
        ]));
    }
}
