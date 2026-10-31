<?php

namespace App\Modules\Notifications\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LowStockNotificationTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_stock_managers_of_the_branch_get_an_inbox_alert(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $variant = $this->stockedVariant($org, 'Mango Juice', reorderLevel: '5');
        $store = $this->mainStoreId($org);
        $mainClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        $northClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$this->createBranch($org, 'NORTH')->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);

        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '6', 'unit_cost' => '1']);
        $this->adjust($store, 'damage', ['variant_id' => $variant->id, 'quantity' => '-2']);

        $this->actingAsUser($mainClerk)->getJson('/api/v1/notifications/unread-count')->assertOk()->assertJsonPath('data.count', 1);
        $inbox = $this->getJson('/api/v1/notifications')->assertOk()->json('data.0');
        $this->assertSame('inventory.low_stock', $inbox['type']);
        $this->assertSame('Low stock: Mango Juice', $inbox['data']['title']);
        $this->assertStringContainsString('is at 4.000 pcs in Main Store — reorder level 5.000', $inbox['data']['message']);

        $this->postJson("/api/v1/notifications/{$inbox['id']}/read")->assertNoContent();
        $this->getJson('/api/v1/notifications?unread=1')->assertJsonCount(0, 'data');

        // Admin (access to all branches) is notified too; other branches and cashiers are not.
        $this->actingAsUser($admin)->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.count', 1);
        $this->actingAsUser($northClerk)->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.count', 0);
        $this->actingAsUser($cashier)->getJson('/api/v1/notifications/unread-count')->assertJsonPath('data.count', 0);

        // Users cannot read each other's notifications.
        $this->actingAsUser($northClerk)->postJson("/api/v1/notifications/{$inbox['id']}/read")->assertNotFound();
    }
}
