<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * SC1: the daily "items need reordering" inbox alert — from 07:00 in the organization's
 * timezone, once per store and day, to purchases.manage holders of the store's branch.
 */
class ReorderNotificationTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_daily_reorder_alert_once_per_store_and_local_day(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant(); // Asia/Dhaka (UTC+6)
        $this->stockedVariant($org, 'Mango Juice', reorderLevel: '10');
        $this->stockedVariant($org, 'Water', reorderLevel: '5');
        $store = $this->mainStoreId($org);
        $north = $this->createBranch($org, 'NORTH'); // its store has the same two items to reorder
        $mainBuyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        $northBuyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$main->id]); // purchases.view only
        $count = fn ($user) => $this->actingAsUser($user)->getJson('/api/v1/notifications/unread-count')->json('data.count');

        // 06:30 in Dhaka: too early.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 00:30:00', 'UTC'));
        $this->artisan('purchasing:reorder-notifications')->expectsOutputToContain('Sent 0 reorder notification(s).')->assertSuccessful();
        $this->assertSame(0, $count($mainBuyer));

        // 07:30 in Dhaka: one notification per store.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 01:30:00', 'UTC'));
        $this->artisan('purchasing:reorder-notifications')->expectsOutputToContain('Sent 2 reorder notification(s).')->assertSuccessful();
        $this->assertSame(1, $count($mainBuyer));
        $inbox = $this->getJson('/api/v1/notifications')->json('data.0');
        $this->assertSame('purchasing.reorder_needed', $inbox['type']);
        $this->assertSame('2 items need reordering at Main Store.', $inbox['data']['message']);
        $this->assertSame($store, $inbox['data']['store_id']);
        $this->assertSame(2, $inbox['data']['items']);
        $this->assertSame('2026-11-06', $inbox['data']['date']);
        $this->assertSame("/purchasing/reorder?store_id={$store}", $inbox['data']['link']);
        $this->assertSame(2, $count($admin)); // all branches: both stores
        $this->assertSame(1, $count($northBuyer));
        $this->assertSame(0, $count($cashier));
        $this->assertSame(0, $count($accountant));

        // Later the same day: nothing new.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 10:30:00', 'UTC'));
        $this->artisan('purchasing:reorder-notifications')->expectsOutputToContain('Sent 0 reorder notification(s).');
        $this->assertSame(1, $count($mainBuyer));

        // Next local day (00:30 UTC on the 7th is 06:30 in Dhaka — wait for 07:00).
        $this->travelTo(CarbonImmutable::parse('2026-11-07 00:30:00', 'UTC'));
        $this->artisan('purchasing:reorder-notifications')->expectsOutputToContain('Sent 0 reorder notification(s).');
        $this->travelTo(CarbonImmutable::parse('2026-11-07 01:00:00', 'UTC'));
        $this->artisan('purchasing:reorder-notifications')->expectsOutputToContain('Sent 2 reorder notification(s).');
        $this->assertSame(2, $count($mainBuyer));
    }

    public function test_stores_without_suggestions_and_suspended_organizations_are_skipped(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $rivalAdmin, 'organization' => $rival] = $this->provisionTenant('Rival');
        $juice = $this->stockedVariant($org, 'Mango Juice', reorderLevel: '10');
        $this->stockedVariant($rival, 'Rival Juice', reorderLevel: '10');
        $this->actingAsUser($admin)->adjust($this->mainStoreId($org), 'opening', ['variant_id' => $juice->id, 'quantity' => '50', 'unit_cost' => '1']);
        $rival->forceFill(['status' => 'suspended'])->save();

        $this->artisan('purchasing:reorder-notifications', ['--any-hour' => true])->expectsOutputToContain('Sent 0 reorder notification(s).')->assertSuccessful();
        $this->assertSame(0, $this->getJson('/api/v1/notifications/unread-count')->json('data.count'));
        $this->assertSame(0, $rivalAdmin->notifications()->count());
    }

    public function test_the_command_is_scheduled_hourly(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'purchasing:reorder-notifications'));

        $this->assertNotNull($event);
        $this->assertSame('0 * * * *', $event->expression);
    }
}
