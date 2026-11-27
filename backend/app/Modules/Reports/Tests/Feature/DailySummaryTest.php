<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Reports\Infrastructure\Notifications\DailySummaryNotification;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * R1: the owners' daily summary — from `alerts.daily_summary_hour` local time, once per
 * organization and day, to `reports.view` holders with the figures of their branches.
 */
class DailySummaryTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_daily_summary_from_the_local_hour_once_a_day_in_each_recipients_branch_scope(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant(); // Asia/Dhaka (UTC+6)
        $north = $this->createBranch($org, 'NORTH');
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$main->id]);
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$main->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]); // dashboard.view, no reports.view
        $juice = $this->sellable($org, 'Mango Juice', '15.00');
        $water = $this->sellable($org, 'Water', '20.00');
        $store = $this->mainStoreId($org);
        $count = fn (User $user) => $this->actingAsUser($user)->getJson('/api/v1/notifications/unread-count')->json('data.count');

        // 20:30 in Dhaka: two cash sales, then too early for the 21:00 summary.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 14:30:00', 'UTC'));
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '50');
        $this->stockUp($store, $water, '50');
        $this->checkout($this->cart($store, [[$juice, '2'], [$water, '1']], [['cash', '50']]))->assertCreated();
        $this->checkout($this->cart($store, [[$water, '3']], [['cash', '60']]))->assertCreated();
        $this->artisan('reports:daily-summary')->expectsOutputToContain('Sent 0 daily summaries.')->assertSuccessful();

        // 21:30: admin, branch manager, accountant and the other branch's manager.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 15:30:00', 'UTC'));
        $this->artisan('reports:daily-summary')->expectsOutputToContain('Sent 4 daily summaries.')->assertSuccessful();
        $this->assertSame(0, $count($cashier));
        $this->assertSame(1, $count($manager));
        $inbox = $this->getJson('/api/v1/notifications')->json('data.0');
        $this->assertSame('reports.daily_summary', $inbox['type']);
        $data = $inbox['data'];
        $this->assertSame('Daily summary for 6 Nov 2026', $data['title']);
        $this->assertSame('2026-11-06', $data['date']);
        $this->assertSame('BDT', $data['currency']);
        $this->assertSame('110.00', $data['sales_total']);
        $this->assertSame(2, $data['sales_count']);
        $this->assertSame(0, $data['web_orders']);
        $this->assertSame('110.00', $data['cash_collected']);
        $this->assertSame('0.00', $data['refunds']);
        $this->assertSame(['Water', 'Mango Juice'], array_column($data['top_products'], 'name'));
        $this->assertSame('80.00', $data['top_products'][0]['net_sales']);
        $this->assertSame(0, $data['low_stock_count']);
        $this->assertSame('/dashboard', $data['link']);
        $this->assertSame('Sales 110.00 BDT from 2 sales and 0 web orders; cash collected 110.00 BDT; refunds 0.00 BDT; 0 items low on stock.', $data['message']);

        // The other branch's manager sees only their branch.
        $this->assertSame(1, $count($northManager));
        $north = $this->getJson('/api/v1/notifications')->json('data.0.data');
        $this->assertSame(['0.00', 0, '0.00', []], [$north['sales_total'], $north['sales_count'], $north['cash_collected'], $north['top_products']]);
        $this->assertSame(1, $count($accountant));
        $this->assertSame(1, $count($admin));

        // Later the same day: nothing new; the next day from 21:00 again.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 17:30:00', 'UTC'));
        $this->artisan('reports:daily-summary')->expectsOutputToContain('Sent 0 daily summaries.');
        $this->travelTo(CarbonImmutable::parse('2026-11-07 15:00:00', 'UTC'));
        $this->artisan('reports:daily-summary')->expectsOutputToContain('Sent 4 daily summaries.');
        $this->assertSame(2, $count($manager));
        $this->assertSame('0.00', $this->getJson('/api/v1/notifications')->json('data.0.data.sales_total'));
    }

    public function test_the_summary_is_also_e_mailed_and_follows_the_settings(): void
    {
        Notification::fake();
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $rivalAdmin, 'organization' => $rival] = $this->provisionTenant('Rival');
        $this->actingAsUser($admin)->patchJson('/api/v1/settings/alerts', ['daily_summary_hour' => 9])->assertOk();
        $this->actingAsUser($rivalAdmin)->patchJson('/api/v1/settings/alerts', ['daily_summary' => false])->assertOk();

        // 10:00 in Dhaka: past the organization's 09:00; the rival switched it off.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 04:00:00', 'UTC'));
        $this->artisan('reports:daily-summary')->expectsOutputToContain('Sent 1 daily summary.')->assertSuccessful();

        Notification::assertSentTo($admin, DailySummaryNotification::class, function (DailySummaryNotification $n, array $channels) use ($admin) {
            $mail = $n->toMail($admin);
            $lines = implode("\n", $mail->introLines);

            return $channels === ['database', 'mail'] && $n->viaConnections() === ['database' => 'sync'] && $n instanceof ShouldQueue
                && $mail->subject === 'Daily summary for 6 Nov 2026'
                && str_contains($lines, 'Sales: 0.00 BDT from 0 sale(s)') && str_contains($lines, 'Cash collected: 0.00 BDT')
                && str_ends_with((string) $mail->actionUrl, '/admin/dashboard');
        });
        Notification::assertNotSentTo($rivalAdmin, DailySummaryNotification::class);

        // Switched off: nothing on later days.
        $this->actingAsUser($admin)->patchJson('/api/v1/settings/alerts', ['daily_summary' => false])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-07 04:00:00', 'UTC'));
        $this->artisan('reports:daily-summary')->expectsOutputToContain('Sent 0 daily summaries.');

        // Suspended organizations are skipped.
        $this->actingAsUser($admin)->patchJson('/api/v1/settings/alerts', ['daily_summary' => true])->assertOk();
        $org->forceFill(['status' => 'suspended'])->save();
        $this->artisan('reports:daily-summary', ['--any-hour' => true])->expectsOutputToContain('Sent 0 daily summaries.');
        Notification::assertSentToTimes($admin, DailySummaryNotification::class, 1);
    }

    public function test_the_command_is_scheduled_hourly(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'reports:daily-summary'));

        $this->assertNotNull($event);
        $this->assertSame('0 * * * *', $event->expression);
    }
}
