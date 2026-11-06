<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Phase 7: the report catalog by permission, cost-sensitive columns, parameter validation
 * (RANGE_TOO_LARGE), branch and tenant isolation and organization-timezone day boundaries.
 */
class ReportAccessTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, RefreshDatabase;

    public function test_the_catalog_lists_the_reports_each_role_may_run(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $keys = fn (User $user) => array_column($this->actingAsUser($user)->getJson('/api/v1/reports')->assertOk()->json('data'), 'key');

        $all = $keys($admin);
        $this->assertCount(18, $all);
        $this->assertSame(['sales_daily', 'sales_monthly', 'sales_by_product', 'sales_by_category', 'sales_by_branch', 'sales_by_cashier', 'profit_and_loss',
            'inventory_valuation', 'stock_movements', 'low_stock', 'expiry', 'purchases', 'sales_by_customer', 'customer_dues', 'supplier_dues', 'payment_collections', 'tax', 'expenses'], $all);
        $this->assertSame($all, $keys($this->createUserWithRole($org, SystemRole::Accountant, [$branch->id])));
        $this->assertSame($all, $keys($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id])));
        $this->assertSame(array_values(array_diff($all, ['profit_and_loss', 'tax'])), $keys($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id])));

        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier)->getJson('/api/v1/reports')->assertForbidden();
        $this->getJson('/api/v1/reports/sales_daily?date_from=2026-11-01&date_to=2026-11-01')->assertForbidden();
        $this->getJson('/api/v1/dashboard')->assertOk();

        $this->actingAsUser($admin);
        $definition = collect($this->getJson('/api/v1/reports')->json('data'))->firstWhere('key', 'sales_by_product');
        $this->assertSame('sales', $definition['group']);
        $this->assertSame('reports.view', $definition['permission']);
        $this->assertSame('-net_sales', $definition['default_sort']);
        $this->assertTrue(collect($definition['columns'])->firstWhere('key', 'cost')['cost_sensitive']);
        $this->assertSame(['name' => 'date_from', 'label' => 'From', 'type' => 'date', 'required' => true], $definition['params'][0]);
        $this->assertSame('category', collect($definition['params'])->firstWhere('name', 'category_id')['entity']);
        $this->assertSame([], $definition['omitted_columns']);
        $this->getJson('/api/v1/reports')->assertJsonPath('meta.groups.0', ['key' => 'sales', 'label' => 'Sales']);
    }

    public function test_cashier_filter_options_are_the_users_of_the_viewers_branches(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $other = $this->createBranch($org, 'CTG');
        $here = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $there = $this->createUserWithRole($org, SystemRole::Cashier, [$other->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        ['admin' => $stranger] = $this->provisionTenant('Other Shop');

        $options = fn (User $user) => collect(collect($this->actingAsUser($user)->getJson('/api/v1/reports')->assertOk()->json('data'))
            ->firstWhere('key', 'sales_by_cashier')['params'])->firstWhere('name', 'cashier_id')['options'];

        $mine = array_column($options($accountant), 'value');
        $this->assertContains($here->id, $mine);
        $this->assertContains($accountant->id, $mine);
        $this->assertNotContains($there->id, $mine);
        $this->assertNotContains($stranger->id, $mine);
        $this->assertSame(['value' => $here->id, 'label' => $here->name], collect($options($accountant))->firstWhere('value', $here->id));
        $this->assertContains($there->id, array_column($options($admin), 'value'));
    }

    public function test_cost_columns_are_omitted_without_products_view_cost_and_financial_reports_need_reports_financial(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5', '40.00');
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Report reader', 'permissions' => ['reports.view']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$branch->id]);
        $today = now()->setTimezone('Asia/Dhaka')->toDateString();

        $this->actingAsUser($reader);
        $definition = collect($this->getJson('/api/v1/reports')->assertOk()->json('data'))->firstWhere('key', 'sales_daily');
        $this->assertSame(['cost', 'gross_profit', 'margin'], $definition['omitted_columns']);
        $response = $this->report('sales_daily', ['date_from' => $today, 'date_to' => $today])->assertOk();
        $this->assertArrayNotHasKey('cost', $response->json('data.0'));
        $this->assertArrayNotHasKey('gross_profit', $response->json('meta.totals'));
        $this->assertSame('100.00', $response->json('data.0.net_sales'));
        $this->assertSame(['cost', 'gross_profit', 'margin'], $response->json('meta.omitted_columns'));
        $this->assertNotContains('margin', array_column($response->json('meta.columns'), 'key'));
        $this->report('sales_daily', ['date_from' => $today, 'date_to' => $today, 'sort' => '-margin'])->assertStatus(422)->assertJsonValidationErrorFor('sort', 'error.details');
        $this->report('inventory_valuation')->assertOk()->assertJsonMissingPath('data.0.value')->assertJsonPath('data.0.quantity', '4.000');
        $this->report('profit_and_loss', ['date_from' => $today, 'date_to' => $today])->assertForbidden();
        $this->report('tax', ['date_from' => $today, 'date_to' => $today])->assertForbidden();
        $this->getJson('/api/v1/dashboard')->assertForbidden();

        $this->actingAsUser($admin);
        $this->report('sales_daily', ['date_from' => $today, 'date_to' => $today])->assertJsonPath('data.0.cost', '40.00')->assertJsonPath('meta.omitted_columns', []);
    }

    public function test_statements_ignore_sorting_and_return_every_line(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $plain = $this->report('profit_and_loss', ['date_from' => '2026-11-01', 'date_to' => '2026-11-30'])->assertOk();
        $sorted = $this->report('profit_and_loss', ['date_from' => '2026-11-01', 'date_to' => '2026-11-30', 'sort' => '-amount', 'per_page' => 2])->assertOk();

        $this->assertSame('gross_sales', $plain->json('data.0.key'));
        $this->assertSame('net_profit', $plain->json('data.'.(count($plain->json('data')) - 1).'.key'));
        $this->assertSame(array_column($plain->json('data'), 'key'), array_column($sorted->json('data'), 'key'));
        $plain->assertJsonPath('meta.sort', null)->assertJsonPath('meta.pagination.last_page', 1);
    }

    public function test_parameters_are_validated(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['branch' => $foreignBranch] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/reports/no_such_report')->assertNotFound();
        $this->report('sales_daily')->assertStatus(422)->assertJsonValidationErrorFor('date_from', 'error.details')->assertJsonValidationErrorFor('date_to', 'error.details');
        $this->report('sales_daily', ['date_from' => '2026-11-05', 'date_to' => '2026-11-01'])->assertStatus(422)->assertJsonValidationErrorFor('date_to', 'error.details');
        $this->report('sales_daily', ['date_from' => '05/11/2026', 'date_to' => '2026-11-06'])->assertStatus(422)->assertJsonValidationErrorFor('date_from', 'error.details');
        $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-02', 'channel' => 'web'])->assertStatus(422)->assertJsonValidationErrorFor('channel', 'error.details');
        $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-02', 'sort' => 'nope'])->assertStatus(422);
        $this->report('expiry', ['days' => 4000])->assertStatus(422)->assertJsonValidationErrorFor('days', 'error.details');
        $this->report('expiry', ['include_expired' => 0])->assertOk()->assertJsonPath('meta.params.include_expired', false);
        $this->report('sales_by_product', ['date_from' => '2026-11-01', 'date_to' => '2026-11-02', 'product_id' => 'not-a-uuid'])->assertStatus(422);
        $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-02', 'branch_id' => $foreignBranch->id])->assertStatus(422)
            ->assertJsonPath('error.details.branch_id.0', 'The selected branch does not exist.');

        // 366 days for daily rows, five years otherwise.
        $this->report('sales_daily', ['date_from' => '2025-11-06', 'date_to' => '2026-11-07'])->assertStatus(422)
            ->assertJsonPath('error.code', 'RANGE_TOO_LARGE')->assertJsonPath('error.details.max_days', 366)->assertJsonPath('error.details.days', 367);
        $this->report('sales_daily', ['date_from' => '2025-11-07', 'date_to' => '2026-11-07'])->assertOk()->assertJsonPath('meta.pagination.total', 366);
        $this->report('sales_monthly', ['date_from' => '2022-01-01', 'date_to' => '2026-11-07'])->assertOk()->assertJsonPath('meta.pagination.total', 59);
        $this->report('sales_monthly', ['date_from' => '2021-01-01', 'date_to' => '2026-11-07'])->assertStatus(422)->assertJsonPath('error.code', 'RANGE_TOO_LARGE');
        $this->report('expenses', ['date_from' => '2025-01-01', 'date_to' => '2026-11-07', 'group_by' => 'day'])->assertStatus(422);
        $this->report('payment_collections', ['date_from' => '2025-01-01', 'date_to' => '2026-11-07', 'group_by' => 'day'])->assertStatus(422)->assertJsonPath('error.code', 'RANGE_TOO_LARGE');
        $this->report('payment_collections', ['date_from' => '2025-01-01', 'date_to' => '2026-11-07', 'group_by' => 'method'])->assertOk();
    }

    public function test_days_follow_the_organization_timezone(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10');

        // 23:59 on 6 Nov and 00:30 on 7 Nov in Dhaka (17:59 and 18:30 UTC on 6 Nov).
        $this->travelTo($this->dhaka('2026-11-06 23:59'));
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        $this->travelTo($this->dhaka('2026-11-07 00:30'));
        $this->checkout($this->cart($store, [[$soap, '2']], [['cash', '200']]))->assertCreated();

        $rows = $this->rowsBy('sales_daily', ['date_from' => '2026-11-06', 'date_to' => '2026-11-07'], 'date');
        $this->assertSame('100.00', $rows['2026-11-06']['net_sales']);
        $this->assertSame('200.00', $rows['2026-11-07']['net_sales']);
        $this->report('sales_daily', ['date_from' => '2026-11-07', 'date_to' => '2026-11-07'])->assertJsonPath('meta.totals.net_sales', '200.00');
        $this->report('sales_monthly', ['date_from' => '2026-11-01', 'date_to' => '2026-11-06'])->assertJsonPath('meta.totals.net_sales', '100.00');
    }

    public function test_branch_limited_users_and_other_tenants_never_see_other_branches(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $ctg = $this->createBranch($org, 'CTG');
        $soap = $this->sellable($org, 'Soap', '100.00');
        $mainStore = $this->mainStoreId($org);
        $ctgStore = $this->inTenant($org, fn () => Store::query()->where('branch_id', $ctg->id)->value('id'));
        $this->actingAsUser($admin);
        $this->stockUp($mainStore, $soap, '10');
        $this->stockUp($ctgStore, $soap, '10');
        $this->checkout($this->cart($mainStore, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        // A user has one open register session at a time: the CTG sale is rung up by CTG staff.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager, [$ctg->id]));
        $this->checkout($this->cart($ctgStore, [[$soap, '3']], [['cash', '300']]))->assertCreated();
        $this->webOrder($org, $ctgStore, [['variant' => $soap, 'quantity' => '1', 'unit_price' => '100', 'unit_cost' => '10']]);
        // Another organization's sale never shows.
        ['admin' => $otherAdmin, 'organization' => $other] = $this->provisionTenant('Other Shop');
        $otherSoap = $this->sellable($other, 'Soap', '999.00');
        $otherStore = $this->mainStoreId($other);
        $this->actingAsUser($otherAdmin);
        $this->stockUp($otherStore, $otherSoap, '10');
        $this->checkout($this->cart($otherStore, [[$otherSoap, '1']], [['cash', '999']]))->assertCreated();
        $today = now()->setTimezone('Asia/Dhaka')->toDateString();
        $period = ['date_from' => $today, 'date_to' => $today];

        $this->actingAsUser($admin);
        $all = $this->rowsBy('sales_by_branch', $period, 'branch');
        $this->assertSame(['100.00', '400.00'], [$all[$main->name]['net_sales'], $all[$ctg->name]['net_sales']]);
        $this->report('sales_daily', $period)->assertJsonPath('meta.totals.net_sales', '500.00');
        $this->report('sales_daily', $period + ['branch_id' => $ctg->id])->assertJsonPath('meta.totals.net_sales', '400.00');
        $this->report('sales_by_product', $period + ['store_id' => $ctgStore])->assertJsonPath('meta.totals.quantity', '4.000');

        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$main->id]);
        $this->actingAsUser($manager);
        $this->assertSame([$main->name], array_keys($this->rowsBy('sales_by_branch', $period, 'branch')));
        $this->report('sales_daily', $period)->assertJsonPath('meta.totals.net_sales', '100.00');
        $this->report('sales_daily', $period + ['branch_id' => $ctg->id])->assertStatus(422)->assertJsonPath('error.details.branch_id.0', 'You do not have access to this branch.');
        $this->report('stock_movements', $period + ['store_id' => $ctgStore])->assertStatus(422)->assertJsonValidationErrorFor('store_id', 'error.details');
        $this->report('inventory_valuation')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.quantity', '9.000');
        $this->report('payment_collections', $period)->assertJsonPath('meta.totals.collected', '100.00');
        $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('data.kpis.total_sales.value', '100.00')->assertJsonPath('data.sales_by_branch', null);

        $this->actingAsUser($otherAdmin);
        $this->report('sales_daily', $period)->assertJsonPath('meta.totals.net_sales', '999.00');
        $this->report('sales_daily', $period + ['branch_id' => $main->id])->assertStatus(422);
    }

    public function test_every_registered_report_runs_on_an_empty_organization(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        foreach (array_keys(app(ReportRegistry::class)->all()) as $key) {
            $this->report($key, ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'])->assertOk()->assertJsonPath('meta.report', $key);
        }
    }
}
