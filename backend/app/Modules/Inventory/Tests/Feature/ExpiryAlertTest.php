<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * R1: the daily batch-expiry alert — from 08:00 local time, once per store and day, to
 * `inventory.view` holders of the store's branch; the count and the first five batches.
 */
class ExpiryAlertTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_expiry_alert_once_per_store_and_local_day(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant(); // Asia/Dhaka (UTC+6)
        $north = $this->createBranch($org, 'NORTH');
        $stockKeeper = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        $northKeeper = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]); // no inventory.view
        $pills = $this->sellable($org, 'Paracetamol', '5.00', ['batches' => true]);
        $syrup = $this->sellable($org, 'Cough Syrup', '90.00', ['batches' => true]);
        $store = $this->mainStoreId($org);
        $count = fn (User $user) => $this->actingAsUser($user)->getJson('/api/v1/notifications/unread-count')->json('data.count');

        $this->travelTo(CarbonImmutable::parse('2026-11-06 01:30:00', 'UTC')); // 07:30 in Dhaka
        $this->actingAsUser($admin);
        $this->stockUp($store, $pills, '10', '1.00', 'P-OLD', '2026-11-01');   // expired
        $this->stockUp($store, $pills, '20', '1.00', 'P-SOON', '2026-11-20');  // within 30 days
        $this->stockUp($store, $syrup, '4', '50.00', 'S-EDGE', '2026-12-06');  // exactly 30 days
        $this->stockUp($store, $syrup, '6', '50.00', 'S-LATER', '2027-03-01'); // later
        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 0 expiry alert(s).')->assertSuccessful();

        // 08:30: one alert for the main store (the north store holds nothing).
        $this->travelTo(CarbonImmutable::parse('2026-11-06 02:30:00', 'UTC'));
        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 1 expiry alert(s).')->assertSuccessful();
        $this->assertSame(1, $count($stockKeeper));
        $inbox = $this->getJson('/api/v1/notifications')->json('data.0');
        $this->assertSame('inventory.expiry_alert', $inbox['type']);
        $data = $inbox['data'];
        $this->assertSame('Expiring stock: Main Store', $data['title']);
        $this->assertSame('3 batches at Main Store have expired or expire within 30 days.', $data['message']);
        $this->assertSame([3, 1, 30, $store, $main->id, '2026-11-06'], [$data['count'], $data['expired'], $data['days'], $data['store_id'], $data['branch_id'], $data['date']]);
        $this->assertSame(['P-OLD', 'P-SOON', 'S-EDGE'], array_column($data['items'], 'batch'));
        $this->assertEquals(['product' => 'Paracetamol', 'batch' => 'P-OLD', 'expires_on' => '2026-11-01', 'quantity' => '10.000'],
            array_intersect_key($data['items'][0], array_flip(['product', 'batch', 'expires_on', 'quantity'])));
        $this->assertSame("/reports/expiry?store_id={$store}", $data['link']);
        $this->assertSame(1, $count($admin));
        $this->assertSame(0, $count($northKeeper));
        $this->assertSame(0, $count($cashier));

        // Later the same day: nothing new; the next day again.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 10:30:00', 'UTC'));
        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 0 expiry alert(s).');
        $this->travelTo(CarbonImmutable::parse('2026-11-07 02:00:00', 'UTC'));
        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 1 expiry alert(s).');
        $this->assertSame(2, $count($stockKeeper));
    }

    public function test_at_most_five_listed_the_setting_and_other_organizations(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $rivalAdmin] = $this->provisionTenant('Rival');
        $this->travelTo(CarbonImmutable::parse('2026-11-06 04:00:00', 'UTC'));
        $pills = $this->sellable($org, 'Paracetamol', '5.00', ['batches' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        foreach (range(1, 7) as $i) {
            $this->stockUp($store, $pills, '1', '1.00', "B-{$i}", '2026-11-'.str_pad((string) (10 + $i), 2, '0', STR_PAD_LEFT));
        }
        $this->patchJson('/api/v1/settings/alerts', ['expiry_alert_days' => 7])->assertOk(); // up to 13 Nov: B-1, B-2, B-3

        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 1 expiry alert(s).');
        $this->assertSame(3, $this->getJson('/api/v1/notifications')->json('data.0.data.count'));
        $this->assertSame(0, $rivalAdmin->notifications()->count());

        $this->patchJson('/api/v1/settings/alerts', ['expiry_alert_days' => 60])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-07 04:00:00', 'UTC'));
        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 1 expiry alert(s).');
        $data = $this->getJson('/api/v1/notifications')->json('data.0.data');
        $this->assertSame(7, $data['count']);
        $this->assertSame(['B-1', 'B-2', 'B-3', 'B-4', 'B-5'], array_column($data['items'], 'batch'));

        // Off.
        $this->patchJson('/api/v1/settings/alerts', ['expiry_alert_days' => 0])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-08 04:00:00', 'UTC'));
        $this->artisan('inventory:expiry-alerts')->expectsOutputToContain('Sent 0 expiry alert(s).');
        $this->assertSame(0, $rivalAdmin->notifications()->count());
    }

    public function test_the_command_is_scheduled_hourly(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'inventory:expiry-alerts'));

        $this->assertNotNull($event);
        $this->assertSame('0 * * * *', $event->expression);
    }
}
