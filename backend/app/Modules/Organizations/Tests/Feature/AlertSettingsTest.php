<?php

namespace App\Modules\Organizations\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * R1: Settings → Alerts & reminders (`organizations.settings.alerts`).
 */
class AlertSettingsTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const DEFAULTS = [
        'daily_summary' => true,
        'daily_summary_hour' => 21,
        'expiry_alert_days' => 30,
        'register_open_hours' => 14,
        'due_reminders' => 'off',
        'due_reminder_min' => '100.00',
        'due_reminder_weekday' => 6,
    ];

    public function test_defaults_partial_updates_and_audit(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['organization' => $rival] = $this->provisionTenant('Rival');

        $this->actingAsUser($admin)->getJson('/api/v1/settings/alerts')->assertOk()->assertJsonPath('data', self::DEFAULTS);

        $this->patchJson('/api/v1/settings/alerts', ['daily_summary_hour' => 20, 'due_reminders' => 'weekly', 'due_reminder_min' => 250.5])
            ->assertOk()->assertJsonPath('data', array_replace(self::DEFAULTS, ['daily_summary_hour' => 20, 'due_reminders' => 'weekly', 'due_reminder_min' => '250.50']));
        $this->patchJson('/api/v1/settings/alerts', ['daily_summary' => false, 'expiry_alert_days' => 0])->assertOk()
            ->assertJsonPath('data.daily_summary', false)->assertJsonPath('data.expiry_alert_days', 0)->assertJsonPath('data.daily_summary_hour', 20);

        $this->assertSame(array_replace(self::DEFAULTS, ['daily_summary' => false, 'daily_summary_hour' => 20, 'expiry_alert_days' => 0, 'due_reminders' => 'weekly', 'due_reminder_min' => '250.50']),
            app(OrganizationDirectory::class)->alertSettings($org->id));
        $this->assertSame(self::DEFAULTS, app(OrganizationDirectory::class)->alertSettings($rival->id));
        // Other organization settings are kept; the organization page shows the alerts too.
        $this->patchJson('/api/v1/organization', ['settings' => ['receipt_footer' => 'Thanks!']])->assertOk();
        $this->getJson('/api/v1/settings/alerts')->assertJsonPath('data.daily_summary_hour', 20);
        $this->assertTrue(AuditLog::query()->withoutGlobalScopes()->where('organization_id', $org->id)->where('action', 'organization.updated')
            ->get()->contains(fn (AuditLog $log) => ($log->new_values['settings']['alerts']['due_reminders'] ?? null) === 'weekly'
                && ($log->old_values['settings']['alerts'] ?? null) === null));
    }

    public function test_validation(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->patchJson('/api/v1/settings/alerts', [
            'daily_summary' => 'maybe', 'daily_summary_hour' => 24, 'expiry_alert_days' => -1, 'register_open_hours' => 200,
            'due_reminders' => 'daily', 'due_reminder_min' => '1.234', 'due_reminder_weekday' => 0,
        ])->assertUnprocessable()->assertJsonValidationErrors([
            'daily_summary', 'daily_summary_hour', 'expiry_alert_days', 'register_open_hours', 'due_reminders', 'due_reminder_min', 'due_reminder_weekday',
        ], 'error.details');
        $this->patchJson('/api/v1/settings/alerts', ['due_reminder_weekday' => 8])->assertUnprocessable();
        $this->getJson('/api/v1/settings/alerts')->assertJsonPath('data', self::DEFAULTS);
    }

    public function test_permissions(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();

        // A branch manager sees the organization (organization.view) but may not change it.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $this->getJson('/api/v1/settings/alerts')->assertOk();
        $this->patchJson('/api/v1/settings/alerts', ['daily_summary' => false])->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/settings/alerts')->assertForbidden();
        $this->assertTrue(app(OrganizationDirectory::class)->alertSettings($org->id)['daily_summary']);
    }
}
