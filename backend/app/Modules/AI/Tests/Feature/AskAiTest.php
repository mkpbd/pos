<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Application\Assistants\AskAssistant;
use App\Modules\AI\Infrastructure\Models\AiRequest;
use App\Modules\AI\Infrastructure\Models\AiSetting;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Ask AI: the tool round trip over registry reports, the response shape, usage logging, tool
 * scope escape attempts (other branch / organization, unknown tool, extra parameters, cost
 * columns), the round limit, budget, disabled AI and permissions.
 */
class AskAiTest extends TestCase
{
    use BuildsReportData, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const TODAY = '2026-11-07';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo($this->dhaka(self::TODAY.' 10:00'));
    }

    public function test_a_question_is_answered_from_a_registry_report_and_logged_without_its_text(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10', '40.00');
        $this->checkout($this->cart($store, [[$soap, '2']], [['cash', '200']]))->assertCreated();

        $fake = $this->fakeAi()
            ->callTools([['sales_daily', ['date_from' => self::TODAY, 'date_to' => self::TODAY]]], 150, 30)
            ->answer('Net sales today were **200.00** (Main branch).', 400, 25);

        $response = $this->postJson('/api/v1/ai/ask', ['question' => 'How much did we sell today?'])->assertOk();

        $response->assertJsonPath('data.answer', 'Net sales today were **200.00** (Main branch).')
            ->assertJsonPath('data.report.key', 'sales_daily')
            ->assertJsonPath('data.report.title', 'Daily sales')
            ->assertJsonPath('data.report.rows.0.net_sales', '200.00')
            ->assertJsonPath('data.report.rows.0.cost', '80.00')
            ->assertJsonPath('data.report.totals.net_sales', '200.00')
            ->assertJsonPath('data.report.total_rows', 1)
            ->assertJsonPath('data.report.link', '/reports/sales_daily?date_from=2026-11-07&date_to=2026-11-07&channel=all')
            ->assertJsonPath('data.tools_used', [['name' => 'sales_daily', 'params' => ['date_from' => self::TODAY, 'date_to' => self::TODAY], 'ok' => true]])
            ->assertJsonPath('data.usage', ['input_tokens' => 550, 'output_tokens' => 55, 'rounds' => 2])
            ->assertJsonPath('data.refused', false);
        $this->assertSame('date', $response->json('data.report.columns.0.type'));

        // The model got every report the admin may run plus the assistant tools, and the result rows.
        $tools = $this->toolNamesSent($fake);
        $this->assertCount(count(ReportRegistry::REPORTS) + 5, $tools);
        foreach (['sales_daily', 'profit_and_loss', 'sales_by_customer', 'dashboard_kpis', 'reorder_suggestions', 'sales_anomalies', 'slow_movers', 'shortage_risk'] as $name) {
            $this->assertContains($name, $tools);
        }
        $system = $fake->requests[0]['conversation']->system;
        $this->assertStringContainsString('Today is 2026-11-07', $system);
        $this->assertStringContainsString($branch->id, $system);
        $this->assertStringContainsString('Never invent', $system);
        $result = $this->toolResultsSent($fake, 1)[0];
        $this->assertFalse($result['error']);
        $this->assertSame('200.00', $result['data']['totals']['net_sales']);
        $this->assertSame('80.00', $result['data']['rows'][0]['cost']);
        $this->assertTrue($fake->requests[1]['options']->allowTools);

        $log = AiRequest::query()->withoutGlobalScopes()->sole();
        $this->assertSame(['ask', 'ok', 'sales_daily', 550, 55, 'fake-model', (string) $admin->id],
            [$log->feature, $log->status, $log->intent, $log->input_tokens, $log->output_tokens, $log->model, $log->user_id]);
        $this->assertSame([['tool' => 'sales_daily', 'params' => ['date_from' => self::TODAY, 'date_to' => self::TODAY], 'ok' => true]], $log->params);
        $this->assertStringNotContainsString('How much', json_encode($log->toArray()));
        $this->assertStringNotContainsString('200.00', json_encode($log->toArray()));
    }

    public function test_tool_calls_cannot_escape_the_users_scope_or_see_cost(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        ['branch' => $foreign] = $this->provisionTenant('Other Shop');
        $ctg = $this->createBranch($org, 'CTG');
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $tea = $this->sellable($org, 'Secret Tea', '50.00', ['cost' => '20.00']);
        $store = $this->mainStoreId($org);
        $this->webOrder($org, $store, [['variant' => $soap, 'quantity' => '1', 'unit_price' => '100', 'unit_cost' => '40']], ['delivered_at' => $this->dhaka(self::TODAY.' 08:00')]);
        $this->webOrder($org, $store, [['variant' => $tea, 'quantity' => '1', 'unit_price' => '50', 'unit_cost' => '20']], ['delivered_at' => $this->dhaka(self::TODAY.' 08:00'), 'branch_id' => $ctg->id]);
        $this->actingAsUser($admin);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'AI reader', 'permissions' => ['ai.ask', 'reports.view']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$main->id]);
        $period = ['date_from' => self::TODAY, 'date_to' => self::TODAY];

        $fake = $this->fakeAi()->callTools([
            ['sales_daily', $period + ['branch_id' => $ctg->id]],             // a branch of the organization the user may not access
            ['sales_daily', $period + ['branch_id' => $foreign->id]],         // another organization's branch
            ['profit_and_loss', $period],                                      // a report this user may not run
            ['sales_daily', $period + ['organization_id' => $foreign->organization_id]], // an undeclared parameter
            ['sales_by_product', $period],                                     // allowed: own branch, no cost
            ['drop_all_tables', []],                                           // not a tool at all
        ])->answer('Done.');

        $this->actingAsUser($reader)->postJson('/api/v1/ai/ask', ['question' => 'Sales by product today?'])->assertOk()
            ->assertJsonPath('data.report.key', 'sales_by_product')
            ->assertJsonPath('data.report.omitted_columns', ['cost', 'gross_profit', 'margin'])
            ->assertJsonCount(1, 'data.report.rows')
            ->assertJsonPath('data.report.rows.0.product', 'Soap')
            ->assertJsonPath('data.tools_used.4', ['name' => 'sales_by_product', 'params' => $period, 'ok' => true]);

        $tools = $this->toolNamesSent($fake);
        $this->assertNotContains('profit_and_loss', $tools);
        $this->assertNotContains('tax', $tools);
        $this->assertNotContains('dashboard_kpis', $tools);
        $this->assertNotContains('reorder_suggestions', $tools);
        $this->assertNotContains('shortage_risk', $tools);
        $definition = collect($fake->requests[0]['tools'])->firstWhere('name', 'sales_by_product');
        $this->assertStringNotContainsString('gross_profit', $definition->description);
        $this->assertStringContainsString('not available to this user', $definition->description);
        $this->assertNotContains('-margin', $definition->inputSchema['properties']['sort']['enum']);
        $this->assertArrayNotHasKey('product_id', $definition->inputSchema['properties']); // ids the model cannot know are not offered
        $this->assertFalse($definition->inputSchema['additionalProperties']);

        $results = $this->toolResultsSent($fake, 1);
        $this->assertSame([true, true, true, true, false, true], array_column($results, 'error'));
        $this->assertSame(['You do not have access to this branch.'], $results[0]['data']['details']['branch_id']);
        $this->assertSame(['The selected branch does not exist.'], $results[1]['data']['details']['branch_id']);
        $this->assertStringContainsString('Unknown tool', $results[2]['data']['error']);
        $this->assertStringContainsString('Unknown parameter(s): organization_id', $results[3]['data']['details']['arguments'][0]);
        $this->assertStringContainsString('Unknown tool', $results[5]['data']['error']);
        $allowed = $results[4];
        $figures = json_encode([$allowed['data']['rows'], $allowed['data']['totals'], $allowed['data']['columns']]);
        foreach (['"cost"', '"gross_profit"', '"margin"'] as $hidden) {
            $this->assertStringNotContainsString($hidden, $figures);
        }
        $this->assertStringNotContainsString('Secret Tea', $allowed['raw']);
        $this->assertSame(['cost', 'gross_profit', 'margin'], $allowed['data']['omitted_columns']);
        $this->assertSame('100.00', $allowed['data']['totals']['net_sales']);

        $log = AiRequest::query()->withoutGlobalScopes()->sole();
        $this->assertSame([false, false, false, false, true, false], array_column($log->params, 'ok'));
    }

    public function test_customer_names_and_contacts_never_reach_the_model(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $customer = $this->customer($org, 'Rahim Uddin', '10000');
        DB::table('customers')->where('id', $customer->id)->update(['phone' => '01711111678']);
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10');
        $this->checkout($this->cart($store, [[$soap, '3']], [['cash', '100']], ['customer_id' => $customer->id]))->assertCreated();

        $fake = $this->fakeAi()->callTools([['customer_dues', []], ['sales_by_customer', ['date_from' => self::TODAY, 'date_to' => self::TODAY]]])->answer('Customer #1 owes 200.00.');

        $response = $this->postJson('/api/v1/ai/ask', ['question' => 'Who bought today?'])->assertOk();

        foreach ($this->toolResultsSent($fake, 1) as $result) {
            $this->assertFalse($result['error'], $result['raw']);
            $this->assertStringNotContainsString('Rahim', $result['raw']);
            $this->assertStringNotContainsString('01711111678', $result['raw']);
            $this->assertStringNotContainsString($customer->id, $result['raw']);
            $this->assertSame('Customer #1', $result['data']['rows'][0]['customer']);
        }
        // The user still sees the real table.
        $response->assertJsonPath('data.report.key', 'sales_by_customer')
            ->assertJsonPath('data.report.rows.0.customer', 'Rahim Uddin')
            ->assertJsonPath('data.report.rows.0.orders', 1)
            ->assertJsonPath('data.report.rows.0.net_sales', '300.00')
            ->assertJsonPath('data.report.rows.0.last_purchase_on', self::TODAY);
    }

    public function test_the_loop_stops_after_the_round_limit_and_asks_for_a_final_answer(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        config(['ai.max_tool_rounds' => 2]);
        $fake = $this->fakeAi()
            ->callTools([['dashboard_kpis', []]])
            ->callTools([['dashboard_kpis', []]])
            ->answer('Final answer.');

        $this->actingAsUser($admin)->postJson('/api/v1/ai/ask', ['question' => 'How are we doing?'])->assertOk()
            ->assertJsonPath('data.answer', 'Final answer.')
            ->assertJsonPath('data.report', null)
            ->assertJsonPath('data.usage.rounds', 3)
            ->assertJsonCount(2, 'data.tools_used');

        $this->assertSame(3, $fake->callCount());
        $this->assertTrue($fake->requests[1]['options']->allowTools);
        $this->assertFalse($fake->requests[2]['options']->allowTools);
        $this->assertNotEmpty($fake->requests[2]['tools']); // tools stay declared (earlier turns reference them)
    }

    public function test_history_unsupported_questions_refusals_and_provider_failures(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $fake = $this->fakeAi()->answer('I can answer questions about sales, stock and finances.')->refuse()->fail();

        $this->postJson('/api/v1/ai/ask', ['question' => 'And yesterday?', 'history' => [
            ['role' => 'user', 'content' => 'Sales today?'],
            ['role' => 'assistant', 'content' => 'Today: 200.00.'],
        ]])->assertOk()->assertJsonPath('data.report', null)->assertJsonPath('data.tools_used', []);
        $messages = $fake->requests[0]['conversation']->messages;
        $this->assertSame(['user', 'assistant', 'user'], array_map(fn ($m) => $m->role, $messages));
        $this->assertSame('And yesterday?', $messages[2]->text());

        $this->postJson('/api/v1/ai/ask', ['question' => 'Something harmful'])->assertOk()
            ->assertJsonPath('data.answer', AskAssistant::REFUSAL_ANSWER)->assertJsonPath('data.refused', true);

        $this->postJson('/api/v1/ai/ask', ['question' => 'Sales?'])->assertStatus(503)->assertJsonPath('error.code', 'AI_UNAVAILABLE');
        $this->assertSame(['failed', 'ok', 'refused'], AiRequest::query()->withoutGlobalScopes()->pluck('status')->sort()->values()->all());
        $this->assertSame('provider_error', AiRequest::query()->withoutGlobalScopes()->where('status', 'failed')->value('error_code'));

        // Shape validation.
        $this->postJson('/api/v1/ai/ask', ['question' => ''])->assertStatus(422);
        $this->postJson('/api/v1/ai/ask', ['question' => 'Hi', 'history' => [['role' => 'assistant', 'content' => 'x']]])->assertStatus(422);
        $this->postJson('/api/v1/ai/ask', ['question' => 'Hi', 'history' => array_fill(0, 8, ['role' => 'user', 'content' => 'x'])])->assertStatus(422);
        $this->postJson('/api/v1/ai/ask', ['question' => str_repeat('a', 1001)])->assertStatus(422);
    }

    public function test_budget_exceeded_is_429_and_logged(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $fake = $this->fakeAi();
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => 1000])->assertOk();
        AiRequest::query()->withoutGlobalScopes()->create([
            'organization_id' => $org->id, 'feature' => 'ask', 'status' => 'ok', 'input_tokens' => 900, 'output_tokens' => 100, 'created_at' => now(),
        ]);

        $this->postJson('/api/v1/ai/ask', ['question' => 'Sales today?'])->assertStatus(429)
            ->assertJsonPath('error.code', 'AI_BUDGET_EXCEEDED')
            ->assertJsonPath('error.details.budget', 1000)
            ->assertJsonPath('error.details.used', 1000);
        $this->assertSame(0, $fake->callCount());
        $this->assertSame('AI_BUDGET_EXCEEDED', AiRequest::query()->withoutGlobalScopes()->where('status', 'failed')->value('error_code'));

        // Last month's usage does not count; 0 = unlimited.
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => 0])->assertOk();
        $this->postJson('/api/v1/ai/ask', ['question' => 'Sales today?'])->assertOk();
    }

    public function test_disabled_ai_is_503_for_the_assistant_while_everything_else_works(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10');

        // Application switch off (the default).
        $this->postJson('/api/v1/ai/ask', ['question' => 'Sales today?'])->assertStatus(503)->assertJsonPath('error.code', 'AI_UNAVAILABLE');
        $this->postJson('/api/v1/ai/explain-reorder', ['store_id' => $store])->assertStatus(503)->assertJsonPath('error.code', 'AI_UNAVAILABLE');
        $this->getJson('/api/v1/ai/insights')->assertOk()->assertJsonPath('data.narrative', null)->assertJsonPath('data.narrative_status', 'disabled');
        $this->getJson('/api/v1/ai/customer-insights')->assertOk()->assertJsonPath('data.narrative', null);
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.ai_enabled', false);
        // Non-AI endpoints are unaffected.
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        $this->report('sales_daily', ['date_from' => self::TODAY, 'date_to' => self::TODAY])->assertOk()->assertJsonPath('meta.totals.net_sales', '100.00');
        $this->getJson('/api/v1/dashboard')->assertOk();

        // Application on, organization off.
        $fake = $this->fakeAi();
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.ai_enabled', true);
        AiSetting::query()->withoutGlobalScopes()->create(['organization_id' => $org->id, 'enabled' => false]);
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.ai_enabled', false);
        $this->postJson('/api/v1/ai/ask', ['question' => 'Sales today?'])->assertStatus(503);
        $this->getJson('/api/v1/ai/insights?branch_id='.$branch->id)->assertOk()->assertJsonPath('data.narrative_status', 'disabled')
            ->assertJsonPath('data.facts.kpis.net_sales.value', '0.00');
        $this->assertSame(0, $fake->callCount());
        $this->assertSame(0, AiRequest::query()->withoutGlobalScopes()->count());
    }

    public function test_permissions_by_role(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->fakeAi();
        $ask = fn () => $this->postJson('/api/v1/ai/ask', ['question' => 'Sales today?']);
        $role = fn (SystemRole $r) => $this->actingAsUser($this->createUserWithRole($org, $r, [$branch->id]));

        $role(SystemRole::Cashier);
        $ask()->assertForbidden();
        $this->getJson('/api/v1/ai/insights')->assertForbidden();
        $this->getJson('/api/v1/ai/settings')->assertForbidden();

        $role(SystemRole::BranchManager);
        $ask()->assertOk();
        $this->getJson('/api/v1/ai/insights')->assertOk();
        $this->getJson('/api/v1/ai/customer-insights')->assertOk();
        $this->getJson('/api/v1/ai/settings')->assertForbidden();
        $this->getJson('/api/v1/ai/usage')->assertForbidden();

        $role(SystemRole::Accountant);
        $ask()->assertOk();
        $this->getJson('/api/v1/ai/insights')->assertOk();
        $this->getJson('/api/v1/ai/settings')->assertForbidden();

        $role(SystemRole::InventoryManager);
        $ask()->assertOk();
        $this->getJson('/api/v1/ai/insights')->assertForbidden();

        $role(SystemRole::OnlineStoreManager);
        $ask()->assertForbidden();

        $this->actingAsUser($admin);
        $ask()->assertOk();
        $this->getJson('/api/v1/ai/settings')->assertOk();
        $this->getJson('/api/v1/ai/usage')->assertOk();
    }
}
