<?php

namespace App\Modules\Pos\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Pos\Application\Services\TerminalCookie;
use App\Modules\Pos\Tests\Concerns\InteractsWithTills;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * POS1a §1: till devices — set up (cookie), list, revoke, and who can sign in at a till.
 */
class TillTerminalTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, InteractsWithTills, RefreshDatabase;

    public function test_a_manager_sets_up_this_device_as_a_till(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $this->actingAsUser($manager);

        $response = $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/pos/terminals', ['store_id' => $store, 'name' => ' Front till '])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Front till')
            ->assertJsonPath('data.store.id', $store)
            ->assertJsonPath('data.created_by.id', $manager->id)
            ->assertJsonPath('data.revoked_at', null)
            ->assertJsonPath('data.is_this_device', true);

        $cookie = $response->getCookie(TerminalCookie::NAME, decrypt: false);
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
        $this->assertGreaterThan(now()->addDays(399)->getTimestamp(), $cookie->getExpiresTime());
        $token = $response->getCookie(TerminalCookie::NAME, decrypt: true)->getValue();
        $this->assertGreaterThanOrEqual(40, strlen($token));
        // The cookie value is encrypted on the wire; only the token's hash is stored.
        $this->assertNotSame($token, $cookie->getValue());
        $this->assertSame(hash('sha256', $token), DB::table('pos_terminals')->value('token_hash'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'pos.terminal_created', 'user_id' => $manager->id]);
        $this->assertStringNotContainsString($token, AuditLog::query()->withoutGlobalScopes()->get()->toJson());

        $this->onTill($token)->getJson('/api/v1/pos/terminals')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.is_this_device', true)
            ->assertJsonPath('data.0.store.name', 'Main Store');
        $this->onTill(Str::random(64))
            ->getJson('/api/v1/pos/terminals')->assertOk()->assertJsonPath('data.0.is_this_device', false);
    }

    public function test_setting_up_a_device_again_replaces_its_till(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $first = $this->tillToken($org, $admin, $store, 'Old name');
        $this->actingAsUser($admin);

        $second = $this->onTill($first)->postJson('/api/v1/pos/terminals', ['store_id' => $store, 'name' => 'New name'])
            ->assertCreated()->getCookie(TerminalCookie::NAME, decrypt: true)->getValue();
        $this->assertNotSame($first, $second);

        $list = $this->onTill($second)->getJson('/api/v1/pos/terminals')->assertOk()->json('data');
        $this->assertSame(['New name', 'Old name'], array_column($list, 'name'));
        $this->assertNull($list[0]['revoked_at']);
        $this->assertNotNull($list[1]['revoked_at']);
        $this->assertSame([true, false], array_column($list, 'is_this_device'));
        $this->onTill($first)->getJson('/api/v1/pos/terminal')->assertNotFound();
        $this->onTill($second)->getJson('/api/v1/pos/terminal')->assertOk()->assertJsonPath('data.name', 'New name');
    }

    public function test_tills_are_managed_with_the_permission_within_the_organization_and_branches(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $otherAdmin, 'organization' => $other] = $this->provisionTenant('Other Shop');
        $store = $this->mainStoreId($org);
        $otherStore = $this->mainStoreId($other);
        $second = $this->createBranch($org, 'B2');
        $secondStore = $this->inTenant($org, fn () => Store::query()->where('branch_id', $second->id)->firstOrFail()->id);

        // Cashiers sell but do not set up tills.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/pos/terminals')->assertForbidden();
        $this->postJson('/api/v1/pos/terminals', ['store_id' => $store, 'name' => 'Till'])->assertForbidden();

        $this->actingAsUser($admin);
        $this->postJson('/api/v1/pos/terminals', ['store_id' => $otherStore, 'name' => 'Till'])
            ->assertStatus(422)->assertJsonValidationErrors('store_id', 'error.details');
        $this->postJson('/api/v1/pos/terminals', ['store_id' => $store, 'name' => str_repeat('x', 61)])
            ->assertStatus(422)->assertJsonValidationErrors('name', 'error.details');
        $mainTill = $this->postJson('/api/v1/pos/terminals', ['store_id' => $store, 'name' => 'Main till'])->assertCreated()->json('data.id');
        $branchTwoTill = $this->postJson('/api/v1/pos/terminals', ['store_id' => $secondStore, 'name' => 'B2 till'])->assertCreated()->json('data.id');
        $this->getJson('/api/v1/pos/terminals')->assertOk()->assertJsonCount(2, 'data');

        // A manager of the first branch sees and revokes only its tills.
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/pos/terminals')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mainTill);
        $this->postJson('/api/v1/pos/terminals', ['store_id' => $secondStore, 'name' => 'Nope'])->assertStatus(422);
        $this->deleteJson("/api/v1/pos/terminals/{$branchTwoTill}")->assertNotFound();
        $this->deleteJson('/api/v1/pos/terminals/not-a-uuid')->assertNotFound();
        $this->deleteJson("/api/v1/pos/terminals/{$mainTill}")->assertNoContent();
        $this->deleteJson("/api/v1/pos/terminals/{$mainTill}")->assertNoContent();
        $this->getJson('/api/v1/pos/terminals')->assertOk()->assertJsonPath('data.0.revoked_at', fn ($v) => $v !== null);
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'pos.terminal_revoked')->where('subject_id', $mainTill)->count());

        // Another organization sees none of them.
        $this->actingAsUser($otherAdmin);
        $this->getJson('/api/v1/pos/terminals')->assertOk()->assertJsonCount(0, 'data');
        $this->deleteJson("/api/v1/pos/terminals/{$branchTwoTill}")->assertNotFound();
        $this->assertNull(DB::table('pos_terminals')->where('id', $branchTwoTill)->value('revoked_at'));
    }

    public function test_the_till_lists_who_can_sign_in_there(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Shop');
        $store = $this->mainStoreId($org);
        $token = $this->tillToken($org, $admin, $store, 'Front till');
        $second = $this->createBranch($org, 'B2');

        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $cashier->forceFill(['name' => 'Bina'])->saveQuietly();
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $manager->forceFill(['name' => 'Arif'])->saveQuietly();
        $owner = $this->setPin($admin);
        $owner->forceFill(['name' => 'Zara'])->saveQuietly();
        $pinLocked = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $pinLocked->forceFill(['name' => 'Chandni', 'pin_locked_until' => now()->addMinutes(5)])->saveQuietly();
        // Left out: no PIN, no pos.sell, another branch, inactive, locked account, another organization.
        $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->setPin($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));
        $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$second->id]));
        $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]))->forceFill(['status' => UserStatus::Inactive])->saveQuietly();
        $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]))->forceFill(['locked_until' => now()->addMinutes(5)])->saveQuietly();
        $this->setPin($this->createUserWithRole($other, SystemRole::Cashier, [$otherBranch->id]));

        $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertOk()
            ->assertJsonPath('data.name', 'Front till')
            ->assertJsonPath('data.store', ['id' => $store, 'name' => 'Main Store', 'branch_id' => $branch->id])
            ->assertJsonPath('data.users', [
                ['id' => $manager->id, 'name' => 'Arif'],
                ['id' => $cashier->id, 'name' => 'Bina'],
                ['id' => $pinLocked->id, 'name' => 'Chandni'],
                ['id' => $owner->id, 'name' => 'Zara'],
            ]);
        $this->assertNotNull(DB::table('pos_terminals')->value('last_used_at'));

        $this->withoutTill()->getJson('/api/v1/pos/terminal')
            ->assertNotFound()->assertJsonPath('error.code', 'TERMINAL_NOT_FOUND');
        DB::table('pos_terminals')->update(['revoked_at' => now()]);
        $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertNotFound()->assertJsonPath('error.code', 'TERMINAL_NOT_FOUND');
    }

    public function test_the_till_screen_touches_last_used_at_most_once_a_minute_and_is_throttled(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $token = $this->tillToken($org, $admin, $this->mainStoreId($org));

        $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertOk();
        $first = DB::table('pos_terminals')->value('last_used_at');
        $this->travel(30)->seconds();
        $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertOk();
        $this->assertSame($first, DB::table('pos_terminals')->value('last_used_at'));
        $this->travel(31)->seconds();
        $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertOk();
        $this->assertNotSame($first, DB::table('pos_terminals')->value('last_used_at'));

        $this->travel(2)->minutes();
        foreach (range(1, 60) as $i) {
            $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertOk();
        }
        $this->onTill($token)->getJson('/api/v1/pos/terminal')->assertStatus(429);
    }
}
