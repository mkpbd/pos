<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * R1: the loss-prevention (summary and events), returns (per reason, product, cashier) and
 * dead-stock / stock-aging reports — figures from a built scenario, parameters, branch scope,
 * permission, cost gating and export.
 */
class LossReturnsDeadStockReportsTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    private const PERIOD = ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'];

    private Organization $org;

    private User $admin;

    private User $manager;

    private string $branchId;

    private string $store;

    /** @var array<string, string> */
    private array $numbers = [];

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant();
        $this->branchId = $branch->id;
        $this->store = $this->mainStoreId($this->org);
        $this->manager = $this->createUserWithRole($this->org, SystemRole::BranchManager, [$branch->id]);
    }

    public function test_loss_prevention_per_cashier_and_every_event(): void
    {
        $this->tillScenario();

        $response = $this->report('loss_prevention', self::PERIOD)->assertOk();
        $rows = collect($response->json('data'))->keyBy('cashier_id');
        $figures = fn (array $row) => array_intersect_key($row, array_flip(['cancelled_count', 'cancelled_value', 'discounts', 'overrides_count', 'overrides_value', 'no_sales', 'returns_count', 'returns_value', 'exchanges']));
        $this->assertSame(['cancelled_count' => 0, 'cancelled_value' => '0.00', 'discounts' => '5.00', 'overrides_count' => 1, 'overrides_value' => '40.00',
            'no_sales' => 0, 'returns_count' => 2, 'returns_value' => '180.00', 'exchanges' => 1], $figures($rows[$this->admin->id]));
        $this->assertSame(['cancelled_count' => 1, 'cancelled_value' => '100.00', 'discounts' => '10.00', 'overrides_count' => 0, 'overrides_value' => '0.00',
            'no_sales' => 1, 'returns_count' => 1, 'returns_value' => '90.00', 'exchanges' => 0], $figures($rows[$this->manager->id]));
        $this->assertSame($this->manager->name, $rows[$this->manager->id]['cashier']);
        $response->assertJsonPath('meta.totals', ['cancelled_count' => 1, 'cancelled_value' => '100.00', 'discounts' => '15.00', 'overrides_count' => 1,
            'overrides_value' => '40.00', 'no_sales' => 1, 'returns_count' => 3, 'returns_value' => '270.00', 'exchanges' => 1]);
        $this->assertSame(['cashier', 'cancelled_count', 'cancelled_value', 'discounts', 'overrides_count', 'overrides_value', 'no_sales', 'returns_count', 'returns_value', 'exchanges'],
            array_column($response->json('meta.columns'), 'key'));
        $this->assertSame([], $response->json('meta.omitted_columns'));

        // The cashier filter.
        $only = $this->report('loss_prevention', self::PERIOD + ['cashier_id' => $this->manager->id])->assertOk();
        $this->assertSame([$this->manager->id], array_column($only->json('data'), 'cashier_id'));
        $only->assertJsonPath('meta.totals.discounts', '10.00')->assertJsonPath('meta.totals.returns_value', '90.00');

        // Every event, in time order.
        $events = $this->report('loss_prevention', self::PERIOD + ['show' => 'events'])->assertOk();
        $this->assertSame(['date', 'cashier', 'event', 'document', 'amount', 'reason'], array_column($events->json('meta.columns'), 'key'));
        $events->assertJsonPath('meta.totals', null);
        $admin = $this->admin->name;
        $this->assertSame([
            ['10:00', $admin, 'Discount', $this->numbers['A'], '5.00', null],
            ['10:00', $admin, 'Price override', $this->numbers['A'], '40.00', 'Soap: 100.00 → 80.00 × 2'],
            ['10:30', $this->manager->name, 'Discount', $this->numbers['F'], '10.00', null],
            ['10:40', $this->manager->name, 'Cancelled sale', $this->numbers['B'], '100.00', 'Rang up twice · cancelled by '.$admin],
            ['10:50', $admin, 'Return', $this->numbers['R1'], '100.00', 'Damaged'],
            ['11:00', $admin, 'Return', $this->numbers['R2'], '80.00', 'Changed mind'],
            ['11:20', $admin, 'Exchange', $this->numbers['X'], '50.00', null],
            ['11:30', $this->manager->name, 'No sale', 'S-0001', null, 'Change for customer · approved by '.$admin],
            ['11:40', $this->manager->name, 'Return', $this->numbers['R3'], '90.00', 'Changed mind'],
        ], array_map(fn (array $e) => [substr($e['date'], 11, 5), $e['cashier'], $e['event'], $e['document'], $e['amount'], $e['reason']], $events->json('data')));
        $this->assertStringStartsWith('2026-11-05T10:00:00+06:00', $events->json('data.0.date'));
        $this->assertSame(['discount', 'sale', 'sale_return', 'no_sale', null], [$events->json('data.0.event_type'), $events->json('data.0.document_type'),
            $events->json('data.6.document_type'), $events->json('data.7.event_type'), $events->json('data.7.document_type')]);

        // Another period has nothing.
        $this->report('loss_prevention', ['date_from' => '2026-11-06', 'date_to' => '2026-11-07'])->assertOk()->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.totals.discounts', '0.00');
    }

    public function test_returns_per_reason_product_and_cashier(): void
    {
        $this->tillScenario();

        $byReason = $this->report('returns', self::PERIOD)->assertOk();
        $figures = fn (array $row) => array_intersect_key($row, array_flip(['group', 'returns', 'exchanges', 'quantity', 'value_refunded', 'credited', 'restocked_quantity', 'written_off_quantity', 'top_reason']));
        $this->assertSame([
            ['group' => 'Changed mind', 'returns' => 2, 'exchanges' => 0, 'quantity' => '2.000', 'value_refunded' => '170.00', 'credited' => '0.00', 'restocked_quantity' => '2.000', 'written_off_quantity' => '0.000', 'top_reason' => 'Changed mind'],
            ['group' => 'Damaged', 'returns' => 1, 'exchanges' => 0, 'quantity' => '2.000', 'value_refunded' => '100.00', 'credited' => '50.00', 'restocked_quantity' => '0.000', 'written_off_quantity' => '2.000', 'top_reason' => 'Damaged'],
            ['group' => 'No reason', 'returns' => 1, 'exchanges' => 1, 'quantity' => '1.000', 'value_refunded' => '50.00', 'credited' => '0.00', 'restocked_quantity' => '1.000', 'written_off_quantity' => '0.000', 'top_reason' => 'No reason'],
        ], array_map($figures, $byReason->json('data')));
        $byReason->assertJsonPath('meta.totals', ['returns' => 4, 'exchanges' => 1, 'quantity' => '5.000', 'value_refunded' => '320.00', 'credited' => '50.00',
            'restocked_quantity' => '3.000', 'written_off_quantity' => '2.000', 'top_reason' => 'Changed mind']);
        $this->assertSame('Reason', collect($byReason->json('meta.columns'))->firstWhere('key', 'group')['label']);

        // Per product a return's refunded / credited totals are shared over its lines.
        $byProduct = collect($this->report('returns', self::PERIOD + ['group_by' => 'product'])->assertOk()->json('data'))->keyBy('group');
        $this->assertSame(['group' => 'Soap', 'returns' => 3, 'exchanges' => 0, 'quantity' => '3.000', 'value_refunded' => '236.67', 'credited' => '33.33',
            'restocked_quantity' => '2.000', 'written_off_quantity' => '1.000', 'top_reason' => 'Changed mind'], $figures($byProduct['Soap']));
        $this->assertSame(['group' => 'Oil', 'returns' => 2, 'exchanges' => 1, 'quantity' => '2.000', 'value_refunded' => '83.33', 'credited' => '16.67',
            'restocked_quantity' => '1.000', 'written_off_quantity' => '1.000', 'top_reason' => 'Damaged'], $figures($byProduct['Oil']));

        $byCashier = collect($this->report('returns', self::PERIOD + ['group_by' => 'cashier'])->assertOk()->json('data'))->keyBy('group_id');
        $this->assertSame([3, 1, '230.00', '50.00', 'Changed mind'], [$byCashier[$this->admin->id]['returns'], $byCashier[$this->admin->id]['exchanges'],
            $byCashier[$this->admin->id]['value_refunded'], $byCashier[$this->admin->id]['credited'], $byCashier[$this->admin->id]['top_reason']]);
        $this->assertSame([1, '90.00', $this->manager->name], [$byCashier[$this->manager->id]['returns'], $byCashier[$this->manager->id]['value_refunded'], $byCashier[$this->manager->id]['group']]);

        $this->report('returns', self::PERIOD + ['group_by' => 'store'])->assertStatus(422);
        $this->report('returns', ['date_from' => '2026-11-06', 'date_to' => '2026-11-07'])->assertOk()->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.totals.returns', 0)->assertJsonPath('meta.totals.top_reason', null);
    }

    public function test_branch_scope_permission_and_export_of_the_till_reports(): void
    {
        $this->tillScenario();
        $ctg = $this->createBranch($this->org, 'CTG');
        $ctgStore = $this->inTenant($this->org, fn () => Store::query()->where('branch_id', $ctg->id)->value('id'));
        $ctgManager = $this->createUserWithRole($this->org, SystemRole::BranchManager, [$ctg->id]);
        $this->actingAsUser($this->admin);
        $tea = $this->sellable($this->org, 'Tea', '50.00');
        $this->stockUp($ctgStore, $tea, '5');
        $this->actingAsUser($ctgManager);
        $this->travelTo($this->dhaka('2026-11-05 12:00'));
        $this->checkout($this->cart($ctgStore, [[$tea, '1']], [['cash', '43']], ['invoice_discount' => ['type' => 'amount', 'value' => '7.00']]))->assertCreated();

        $this->actingAsUser($this->admin);
        $this->report('loss_prevention', self::PERIOD)->assertJsonPath('meta.totals.discounts', '22.00');
        $this->report('loss_prevention', self::PERIOD + ['branch_id' => $ctg->id])->assertJsonPath('meta.totals.discounts', '7.00')
            ->assertJsonPath('meta.totals.returns_count', 0)->assertJsonPath('data.0.cashier_id', $ctgManager->id);

        // A manager of the main branch never sees CTG.
        $this->actingAsUser($this->manager);
        $this->report('loss_prevention', self::PERIOD)->assertOk()->assertJsonPath('meta.totals.discounts', '15.00');
        $this->report('loss_prevention', self::PERIOD + ['branch_id' => $ctg->id])->assertStatus(422);
        $this->report('returns', self::PERIOD + ['branch_id' => $ctg->id])->assertStatus(422);
        $this->actingAsUser($ctgManager);
        $this->report('returns', self::PERIOD)->assertOk()->assertJsonCount(0, 'data');

        // Another organization sees nothing of this one.
        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->report('loss_prevention', self::PERIOD)->assertOk()->assertJsonCount(0, 'data');
        $this->report('returns', self::PERIOD)->assertOk()->assertJsonCount(0, 'data');

        // A cashier may not run reports.
        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::Cashier, [$this->branchId]));
        foreach (['loss_prevention', 'returns', 'dead_stock'] as $key) {
            $this->report($key, self::PERIOD)->assertForbidden();
        }

        // Export (X1): the run's columns, a totals row for the summary, none for events.
        $this->actingAsUser($this->admin);
        $query = http_build_query(self::PERIOD + ['branch_id' => $this->branchId]);
        $summary = $this->csvRows($this->get("/api/v1/reports/loss_prevention?{$query}&export=csv")->assertOk());
        $this->assertSame(['Cashier', 'Cancelled sales', 'Cancelled value', 'Discounts given', 'Price overrides', 'Given away by overrides', 'No-sale openings', 'Returns', 'Refunded', 'Exchanges'], $summary[0]);
        $this->assertCount(1 + 2 + 1, $summary);
        $this->assertSame(['Total', '1', '100.00', '15.00', '1', '40.00', '1', '3', '270.00', '1'], $summary[3]);
        $events = $this->csvRows($this->get("/api/v1/reports/loss_prevention?{$query}&show=events&export=csv")->assertOk());
        $this->assertSame(['Date', 'Cashier', 'Type', 'Document', 'Amount', 'Reason'], $events[0]);
        $this->assertCount(1 + 9, $events);
        $returns = $this->csvRows($this->get("/api/v1/reports/returns?{$query}&group_by=product&export=csv")->assertOk());
        $this->assertSame(['Product', 'Returns', 'Exchanges', 'Quantity', 'Refunded', 'Credited to account', 'Restocked', 'Written off', 'Top reason'], $returns[0]);
        $this->assertSame(['Total', '4', '1', '5.000', '320.00', '50.00', '3.000', '2.000', 'Changed mind'], $returns[3]);
    }

    public function test_dead_stock_and_aging_by_last_receipt(): void
    {
        $this->actingAsUser($this->admin);
        $drinks = $this->inTenant($this->org, fn () => Category::query()->create(['name' => 'Drinks'])->id);
        $soap = $this->sellable($this->org, 'Soap', '100.00');
        $oil = $this->sellable($this->org, 'Oil', '50.00');
        $rice = $this->sellable($this->org, 'Rice', '30.00');
        $lamp = $this->sellable($this->org, 'Lamp', '500.00');
        $tea = $this->stockedVariant($this->org, 'Tea', ['category_id' => $drinks]);
        $ctg = $this->createBranch($this->org, 'CTG');
        $ctgStore = $this->inTenant($this->org, fn () => Store::query()->where('branch_id', $ctg->id)->value('id'));
        $ctgManager = $this->createUserWithRole($this->org, SystemRole::BranchManager, [$ctg->id]);

        $this->travelTo($this->dhaka('2026-01-10 09:00'));
        $this->stockUp($this->store, $lamp, '1', '300.00');
        $this->travelTo($this->dhaka('2026-07-01 09:00'));
        $this->stockUp($this->store, $soap, '10', '40.00');
        $this->stockUp($this->store, $oil, '10', '20.00');
        $this->stockUp($this->store, $rice, '5', '10.00');
        $this->stockUp($ctgStore, $oil, '10', '20.00');
        $this->travelTo($this->dhaka('2026-08-15 12:00'));
        $this->checkout($this->cart($this->store, [[$oil, '2']], [['cash', '100']]))->assertCreated();
        $this->webOrder($this->org, $this->store, [['variant' => $rice, 'quantity' => '1', 'unit_price' => '30', 'unit_cost' => '10']],
            ['status' => 'confirmed', 'placed_at' => $this->dhaka('2026-10-01 12:00')]);
        $this->travelTo($this->dhaka('2026-11-05 12:00'));
        $this->checkout($this->cart($this->store, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        $this->travelTo($this->dhaka('2026-11-20 12:00'));
        $this->stockUp($this->store, $tea, '4', '5.00');
        // Cancelled web orders are not sales.
        $this->webOrder($this->org, $this->store, [['variant' => $tea, 'quantity' => '1', 'unit_price' => '15', 'unit_cost' => '5']],
            ['status' => 'cancelled', 'placed_at' => $this->dhaka('2026-11-25 12:00')]);
        // Oil sold at CTG keeps CTG's oil alive, not the main branch's.
        $this->actingAsUser($ctgManager);
        $this->travelTo($this->dhaka('2026-11-28 12:00'));
        $this->checkout($this->cart($ctgStore, [[$oil, '1']], [['cash', '50']]))->assertCreated();
        $this->travelTo($this->dhaka('2026-11-30 10:00'));

        $this->actingAsUser($this->admin);
        $main = ['branch_id' => $this->branchId];
        $response = $this->report('dead_stock', $main)->assertOk();
        $this->assertSame([
            ['Lamp', '1.000', '300.00', null, null, '2026-01-10'],
            ['Oil', '8.000', '160.00', '2026-08-15', 107, '2026-07-01'],
            ['Tea', '4.000', '20.00', null, null, '2026-11-20'],
        ], array_map(fn (array $r) => [$r['product'], $r['on_hand'], $r['value'], $r['last_sold_on'], $r['days_since_sold'], $r['last_received_on']], $response->json('data')));
        $response->assertJsonPath('meta.totals', ['on_hand' => '13.000', 'value' => '480.00', 'items' => 3]);
        $this->assertSame([
            ['key' => 'days_0_30', 'label' => '0–30 days', 'items' => 1, 'quantity' => '4.000', 'value' => '20.00'],
            ['key' => 'days_31_60', 'label' => '31–60 days', 'items' => 0, 'quantity' => '0.000', 'value' => '0.00'],
            ['key' => 'days_61_90', 'label' => '61–90 days', 'items' => 0, 'quantity' => '0.000', 'value' => '0.00'],
            ['key' => 'days_91_180', 'label' => '91–180 days', 'items' => 1, 'quantity' => '8.000', 'value' => '160.00'],
            ['key' => 'days_over_180', 'label' => 'Over 180 days', 'items' => 1, 'quantity' => '1.000', 'value' => '300.00'],
        ], $response->json('meta.aging'));
        $this->assertSame(90, $response->json('meta.params.days'));

        // Parameters: days, category, store; branch scope.
        $this->assertSame(['Lamp', 'Oil', 'Rice', 'Tea'], array_column($this->report('dead_stock', $main + ['days' => 30, 'sort' => 'product'])->json('data'), 'product'));
        $this->assertSame(['Tea'], array_column($this->report('dead_stock', $main + ['category_id' => $drinks])->json('data'), 'product'));
        $this->assertSame(['Lamp', 'Oil', 'Tea'], array_column($this->report('dead_stock', ['store_id' => $this->store, 'sort' => 'product'])->json('data'), 'product'));
        $this->assertSame([], $this->report('dead_stock', ['branch_id' => $ctg->id])->json('data'), 'CTG oil sold two days ago');
        $this->assertSame(['Oil'], array_column($this->report('dead_stock', ['branch_id' => $ctg->id, 'days' => 1])->json('data'), 'product'));
        $this->report('dead_stock', ['days' => 0])->assertStatus(422);
        $this->actingAsUser($ctgManager);
        $this->report('dead_stock', ['store_id' => $this->store])->assertStatus(422);
        $this->assertSame([], $this->report('dead_stock')->json('data'));

        // Without products.view_cost: no value anywhere; sorted by product instead.
        $this->actingAsUser($this->admin);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Report reader', 'permissions' => ['reports.view']])->assertCreated()->json('data.id');
        $this->actingAsUser($this->createUserWithRole($this->org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$this->branchId]));
        $reader = $this->report('dead_stock')->assertOk()->assertJsonPath('meta.omitted_columns', ['value'])->assertJsonPath('meta.sort', 'product');
        $this->assertArrayNotHasKey('value', $reader->json('data.0'));
        $this->assertArrayNotHasKey('value', $reader->json('meta.totals'));
        $this->assertArrayNotHasKey('value', $reader->json('meta.aging.0'));
        $rows = $this->csvRows($this->get('/api/v1/reports/dead_stock?export=csv')->assertOk());
        $this->assertSame(['Product', 'SKU', 'On hand', 'Last sold', 'Days since sold', 'Last received'], $rows[0]);
        $this->assertCount(1 + 3 + 1, $rows);
    }

    /**
     * Nov 5 2026 (Dhaka) at the main branch. Admin: sale A (soap ×2 overridden 100 → 80, oil
     * with 5 off), credit sale C (soap + oil, 100 of 150 paid), return R1 of C (damaged, written
     * off: 50 credited, 100 refunded), return R2 of a soap of A (changed mind, 80), sale D (oil)
     * exchanged (X) for another oil, admin cancels the manager's sale B. Manager: sale B (soap,
     * cancelled), sale F (soap, 10 off the invoice) returned in full (R3, changed mind, 90), a
     * no-sale opening approved by the admin.
     */
    private function tillScenario(): void
    {
        $soap = $this->sellable($this->org, 'Soap', '100.00', ['cost' => '40.00']);
        $oil = $this->sellable($this->org, 'Oil', '50.00', ['cost' => '20.00']);
        $rina = $this->customer($this->org, 'Rina', '1000');
        $this->actingAsUser($this->admin);
        $damaged = $this->postJson('/api/v1/return-reasons', ['name' => 'Damaged', 'restock_by_default' => false])->assertCreated()->json('data.id');
        $changed = $this->postJson('/api/v1/return-reasons', ['name' => 'Changed mind'])->assertCreated()->json('data.id');
        $this->travelTo($this->dhaka('2026-11-04 09:00'));
        $this->stockUp($this->store, $soap, '20', '40.00');
        $this->stockUp($this->store, $oil, '20', '20.00');

        $this->travelTo($this->dhaka('2026-11-05 10:00'));
        $a = $this->sale($this->cart($this->store, [[$soap, '2', ['unit_price' => '80']], [$oil, '1', ['discount' => ['type' => 'amount', 'value' => '5']]]], [['cash', '205']]), 'A');
        $this->travelTo($this->dhaka('2026-11-05 10:10'));
        $c = $this->sale($this->cart($this->store, [[$soap, '1'], [$oil, '1']], [['cash', '100']], ['customer_id' => $rina->id]), 'C');

        $this->actingAsUser($this->manager);
        $this->travelTo($this->dhaka('2026-11-05 10:20'));
        $b = $this->sale($this->cart($this->store, [[$soap, '1']], [['cash', '100']]), 'B');
        $this->travelTo($this->dhaka('2026-11-05 10:30'));
        $f = $this->sale($this->cart($this->store, [[$soap, '1']], [['cash', '90']], ['invoice_discount' => ['type' => 'amount', 'value' => '10.00']]), 'F');

        $this->actingAsUser($this->admin);
        $this->travelTo($this->dhaka('2026-11-05 10:40'));
        $this->postJson("/api/v1/sales/{$b['id']}/cancel", ['reason' => 'Rang up twice'])->assertOk();
        $this->travelTo($this->dhaka('2026-11-05 10:50'));
        $this->numbers['R1'] = $this->tillReturn($c, [[0, '1', false], [1, '1', false]], [['cash', '100']], $damaged)->json('data.number');
        $this->travelTo($this->dhaka('2026-11-05 11:00'));
        $this->numbers['R2'] = $this->tillReturn($a, [[0, '1', true]], [['cash', '80']], $changed)->json('data.number');
        $this->travelTo($this->dhaka('2026-11-05 11:10'));
        $d = $this->sale($this->cart($this->store, [[$oil, '1']], [['cash', '50']]), 'D');
        $this->travelTo($this->dhaka('2026-11-05 11:20'));
        $this->openSession($this->admin, $this->branchId);
        $this->numbers['X'] = $this->postJson('/api/v1/pos/exchanges', $this->cart($this->store, [[$oil, '1']]) + [
            'return' => ['sale_id' => $d['id'], 'lines' => [['sale_line_id' => $d['lines'][0]['id'], 'quantity' => '1']]],
            'refunds' => [],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data.return.number');

        $this->travelTo($this->dhaka('2026-11-05 11:30'));
        DB::table('pos_drawer_openings')->insert([
            'id' => (string) Str::uuid(), 'organization_id' => $this->org->id, 'branch_id' => $this->branchId, 'store_id' => $this->store,
            'register_session_number' => 'S-0001', 'user_id' => $this->manager->id, 'approved_by' => $this->admin->id,
            'reason' => 'Change for customer', 'opened_at' => now(),
        ]);
        $this->actingAsUser($this->manager);
        $this->travelTo($this->dhaka('2026-11-05 11:40'));
        $this->numbers['R3'] = $this->tillReturn($f, [[0, '1', true]], [['cash', '90']], $changed)->json('data.number');
        $this->actingAsUser($this->admin);
    }

    /**
     * @param  array<string, mixed>  $cart
     * @return array<string, mixed>
     */
    private function sale(array $cart, string $name): array
    {
        $sale = $this->checkout($cart)->assertCreated()->json('data');
        $this->numbers[$name] = $sale['number'];

        return $sale;
    }

    /**
     * A till return completed at once (the user approves it with an open session).
     *
     * @param  array<string, mixed>  $sale
     * @param  list<array{0: int, 1: string, 2: bool}>  $lines  [line position, quantity, restock]
     * @param  list<array{0: string, 1: string}>  $refunds
     */
    private function tillReturn(array $sale, array $lines, array $refunds, string $reasonId): TestResponse
    {
        return $this->postJson('/api/v1/returns', [
            'sale_id' => $sale['id'],
            'return_reason_id' => $reasonId,
            'lines' => array_map(fn (array $l) => ['sale_line_id' => $sale['lines'][$l[0]]['id'], 'quantity' => $l[1], 'restock' => $l[2]], $lines),
            'refunds' => array_map(fn (array $r) => ['method' => $r[0], 'amount' => $r[1]], $refunds),
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.status', 'completed');
    }
}
