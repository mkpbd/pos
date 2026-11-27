<?php

namespace App\Modules\Payments\Tests\Feature;

use App\Modules\Payments\Tests\Concerns\InteractsWithRegisters;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * R1: reminders about register sessions open longer than `alerts.register_open_hours` — to the
 * cashier who opened it and `cash_registers.view` holders of its branch, once per session and day.
 */
class OpenRegisterReminderTest extends TestCase
{
    use InteractsWithRegisters, InteractsWithTenancy, RefreshDatabase;

    public function test_sessions_open_too_long_are_reminded_once_a_day(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant(); // Asia/Dhaka (UTC+6)
        $north = $this->createBranch($org, 'NORTH');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        $otherCashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$main->id]);
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $count = fn (User $user) => $this->actingAsUser($user)->getJson('/api/v1/notifications/unread-count')->json('data.count');

        // Opened at 09:00 in Dhaka.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 03:00:00', 'UTC'));
        $session = $this->openSession($cashier, $main->id);
        $closed = $this->openSession($otherCashier, $main->id);
        $this->actingAsUser($admin)->postJson("/api/v1/register-sessions/{$closed->id}/close", ['counted_cash' => '0'])->assertOk();

        // 13 hours later: not yet (14 by default).
        $this->travelTo(CarbonImmutable::parse('2026-11-06 16:00:00', 'UTC'));
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 0 open register reminder(s).')->assertSuccessful();

        // 15 hours (00:00 → the 7th in Dhaka).
        $this->travelTo(CarbonImmutable::parse('2026-11-06 18:00:00', 'UTC'));
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 1 open register reminder(s).')->assertSuccessful();
        $this->assertSame(1, $count($cashier));
        $inbox = $this->getJson('/api/v1/notifications')->json('data.0');
        $this->assertSame('payments.register_open', $inbox['type']);
        $data = $inbox['data'];
        $this->assertStringStartsWith('Register still open: Till ', $data['title']);
        $this->assertSame("Session {$session->number} on ".substr($data['title'], 21).' has been open for 15 hours (since 6 Nov, 9:00 AM). Count the cash and close it.', $data['message']);
        $this->assertSame([$session->id, $session->number, $main->id, 15, '2026-11-07', "/cash-registers/sessions/{$session->id}"],
            [$data['session_id'], $data['number'], $data['branch_id'], $data['hours'], $data['date'], $data['link']]);
        $this->assertSame('2026-11-06T09:00:00+06:00', $data['opened_at']);
        $this->assertSame(1, $count($manager));
        $this->assertSame(1, $count($admin));
        $this->assertSame(0, $count($otherCashier));
        $this->assertSame(0, $count($northManager));

        // The same local day: nothing new; the next local day again; closed: no more.
        $this->travelTo(CarbonImmutable::parse('2026-11-07 10:00:00', 'UTC'));
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 0 open register reminder(s).');
        $this->travelTo(CarbonImmutable::parse('2026-11-07 18:30:00', 'UTC'));
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 1 open register reminder(s).');
        $this->assertSame(2, $count($cashier));
        $this->actingAsUser($admin)->postJson("/api/v1/register-sessions/{$session->id}/close", ['counted_cash' => '0'])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-08 18:30:00', 'UTC'));
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 0 open register reminder(s).');
    }

    public function test_the_setting_and_other_organizations(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        ['admin' => $rivalAdmin, 'organization' => $rival, 'branch' => $rivalMain] = $this->provisionTenant('Rival');
        $this->travelTo(CarbonImmutable::parse('2026-11-06 03:00:00', 'UTC'));
        $this->openSession($admin, $main->id);
        $this->openSession($rivalAdmin, $rivalMain->id);
        $this->actingAsUser($admin)->patchJson('/api/v1/settings/alerts', ['register_open_hours' => 2])->assertOk();
        $this->actingAsUser($rivalAdmin)->patchJson('/api/v1/settings/alerts', ['register_open_hours' => 0])->assertOk();

        $this->travelTo(CarbonImmutable::parse('2026-11-06 05:30:00', 'UTC'));
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 1 open register reminder(s).');
        $this->assertSame(1, $admin->notifications()->count());
        $this->assertSame(0, $rivalAdmin->notifications()->count());

        $this->actingAsUser($rivalAdmin)->patchJson('/api/v1/settings/alerts', ['register_open_hours' => 1])->assertOk();
        $this->artisan('payments:open-register-reminders')->expectsOutputToContain('Sent 1 open register reminder(s).');
        $this->assertSame(1, $admin->notifications()->count());
        $this->assertSame(1, $rivalAdmin->notifications()->count());
        $this->assertSame($rival->id, $rivalAdmin->notifications()->first()->notifiable->organization_id);
    }

    public function test_the_command_is_scheduled_hourly(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'payments:open-register-reminders'));

        $this->assertNotNull($event);
        $this->assertSame('0 * * * *', $event->expression);
    }
}
