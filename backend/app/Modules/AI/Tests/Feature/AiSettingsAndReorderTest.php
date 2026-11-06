<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Infrastructure\Models\AiRequest;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * AI settings (organization switch, budget override, audit), monthly usage by feature, and the
 * reorder explanation over SC1 suggestions.
 */
class AiSettingsAndReorderTest extends TestCase
{
    use BuildsReportData, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    public function test_settings_are_audited_and_never_expose_the_key(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        config(['ai.enabled' => true, 'ai.provider' => 'anthropic', 'ai.api_key' => 'sk-ant-secret-key', 'ai.monthly_token_budget' => 2000000]);
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/ai/settings')->assertOk()
            ->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.app_enabled', true)
            ->assertJsonPath('data.provider_configured', true)
            ->assertJsonPath('data.effective_enabled', true)
            ->assertJsonPath('data.provider', 'anthropic')
            ->assertJsonPath('data.model', 'claude-sonnet-5-5')
            ->assertJsonPath('data.monthly_token_budget', null)
            ->assertJsonPath('data.effective_monthly_token_budget', 2000000)
            ->assertJsonPath('data.data_sharing_level', 'aggregates')
            ->assertDontSee('sk-ant-secret-key');

        $this->patchJson('/api/v1/ai/settings', ['enabled' => false, 'monthly_token_budget' => 50000])->assertOk()
            ->assertJsonPath('data.enabled', false)
            ->assertJsonPath('data.effective_enabled', false)
            ->assertJsonPath('data.monthly_token_budget', 50000)
            ->assertJsonPath('data.effective_monthly_token_budget', 50000)
            ->assertDontSee('sk-ant-secret-key');
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.ai_enabled', false);
        $this->postJson('/api/v1/ai/ask', ['question' => 'Sales?'])->assertStatus(503);

        $audit = DB::table('audit_logs')->where('action', 'ai.settings_updated')->sole();
        $this->assertStringContainsString('50000', (string) $audit->new_values);
        $this->assertSame($org->id, $audit->organization_id);

        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => null])->assertOk()->assertJsonPath('data.effective_monthly_token_budget', 2000000);
        $this->patchJson('/api/v1/ai/settings', ['data_sharing_level' => 'everything'])->assertStatus(422);
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => -1])->assertStatus(422);

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager));
        $this->patchJson('/api/v1/ai/settings', ['enabled' => true])->assertForbidden();
    }

    public function test_usage_by_month_and_feature_in_the_organizations_timezone(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['organization' => $other] = $this->provisionTenant('Other Shop');
        $this->travelTo($this->dhaka('2026-11-07 10:00'));
        $log = fn (string $orgId, string $feature, string $status, int $in, int $out, string $local) => AiRequest::query()->withoutGlobalScopes()->create([
            'organization_id' => $orgId, 'feature' => $feature, 'status' => $status, 'input_tokens' => $in, 'output_tokens' => $out, 'created_at' => $this->dhaka($local),
        ]);
        $log($org->id, 'ask', 'ok', 1000, 200, '2026-11-01 00:30');           // 31 Oct 18:30 UTC: November in Dhaka
        $log($org->id, 'ask', 'failed', 0, 0, '2026-11-05 10:00');
        $log($org->id, 'insights', 'ok', 500, 100, '2026-11-06 10:00');
        $log($org->id, 'ask', 'ok', 9999, 9999, '2026-10-31 23:30');          // October
        $log($other->id, 'ask', 'ok', 7777, 7777, '2026-11-03 10:00');        // another organization
        config(['ai.monthly_token_budget' => 10000]);

        $this->actingAsUser($admin)->getJson('/api/v1/ai/usage')->assertOk()
            ->assertJsonPath('data.month', '2026-11')
            ->assertJsonPath('data.used_tokens', 1800)
            ->assertJsonPath('data.input_tokens', 1500)
            ->assertJsonPath('data.output_tokens', 300)
            ->assertJsonPath('data.budget', 10000)
            ->assertJsonPath('data.budget_source', 'default')
            ->assertJsonPath('data.remaining_tokens', 8200)
            ->assertJsonPath('data.used_pct', '18.00')
            ->assertJsonPath('data.requests', 3)
            ->assertJsonPath('data.failed_requests', 1)
            ->assertJsonPath('data.by_feature', [
                ['feature' => 'ask', 'requests' => 2, 'failed' => 1, 'input_tokens' => 1000, 'output_tokens' => 200, 'tokens' => 1200],
                ['feature' => 'insights', 'requests' => 1, 'failed' => 0, 'input_tokens' => 500, 'output_tokens' => 100, 'tokens' => 600],
            ]);
        $this->getJson('/api/v1/ai/usage?month=2026-10')->assertOk()->assertJsonPath('data.used_tokens', 19998);
        $this->getJson('/api/v1/ai/usage?month=October')->assertStatus(422);
    }

    public function test_reorder_suggestions_are_explained_with_their_deterministic_figures(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '10.00', ['cost' => '5.00']);
        $store = $this->mainStoreId($org);
        $this->travelTo($this->dhaka('2026-11-07 10:00'));
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '12', '5.00');
        $this->checkout($this->cart($store, [[$rice, '10']], [['cash', '100']]))->assertCreated();
        $fake = $this->fakeAi()->answer('1. **Rice** — 6 days of cover, 7 days lead time: buy now.');

        $this->postJson('/api/v1/ai/explain-reorder', ['store_id' => $store])->assertOk()
            ->assertJsonPath('data.narrative', '1. **Rice** — 6 days of cover, 7 days lead time: buy now.')
            ->assertJsonPath('data.status', 'ok')
            ->assertJsonPath('data.store.id', $store)
            ->assertJsonPath('data.items_total', 1)
            ->assertJsonPath('data.to_purchase', 1)
            ->assertJsonPath('data.usage', ['input_tokens' => 100, 'output_tokens' => 20]);
        $facts = json_decode(substr($fake->requests[0]['conversation']->messages[0]->text(), strlen("Facts (JSON):\n")), true);
        $this->assertSame('Rice', $facts['items'][0]['product']);
        $this->assertSame('5.0000', $facts['items'][0]['unit_cost']); // the admin may see cost
        $this->assertSame('explain_reorder', AiRequest::query()->withoutGlobalScopes()->value('feature'));

        // A cashier lacks ai.ask; another organization's store is rejected before any model call.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->postJson('/api/v1/ai/explain-reorder', ['store_id' => $store])->assertForbidden();
        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger)->postJson('/api/v1/ai/explain-reorder', ['store_id' => $store])->assertStatus(422);
        $this->assertSame(1, $fake->callCount());
    }
}
