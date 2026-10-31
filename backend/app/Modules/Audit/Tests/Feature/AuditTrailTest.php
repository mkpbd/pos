<?php

namespace App\Modules\Audit\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

class AuditTrailTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_admin_reads_own_organization_trail_with_filters(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Alpha');
        $this->provisionTenant('Beta');
        $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($admin);

        $all = $this->getJson('/api/v1/audit-logs')->assertOk()->json('data');
        $this->assertNotEmpty($all);
        $this->assertSame([$org->id], array_values(array_unique(AuditLog::query()->withoutGlobalScopes()->whereIn('id', array_column($all, 'id'))->pluck('organization_id')->all())));

        $users = $this->getJson('/api/v1/audit-logs?action=user.*')->assertOk()->json('data.*.action');
        $this->assertSame(['user.created', 'user.created'], $users);

        $this->getJson('/api/v1/audit-logs?action=branch.created')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/audit-logs?action=DROP TABLE')->assertStatus(422);
    }

    public function test_secrets_are_never_written_to_the_trail(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($admin)->patchJson("/api/v1/users/{$cashier->id}", ['password' => 'temporary9'])->assertOk();

        $entry = AuditLog::query()->withoutGlobalScopes()->where('action', 'user.updated')->sole();
        $this->assertSame(['password_changed' => true], $entry->context);
        $this->assertStringNotContainsString('temporary9', json_encode($entry->toArray()));
    }

    public function test_entries_are_immutable(): void
    {
        $this->provisionTenant();
        $entry = AuditLog::query()->withoutGlobalScopes()->firstOrFail();

        $this->expectException(LogicException::class);
        $entry->update(['action' => 'tampered']);
    }

    public function test_requires_audit_permission(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant);

        $this->actingAsUser($cashier)->getJson('/api/v1/audit-logs')->assertForbidden();
        $this->actingAsUser($accountant)->getJson('/api/v1/audit-logs')->assertOk();
        $this->actingAsUser($accountant)->getJson('/api/v1/login-activities')->assertOk();
    }
}
