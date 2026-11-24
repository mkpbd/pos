<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderEdit;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1b §2: changing an order before it ships. Shop from BuildsCheckout: Shirt 450 (5 in
 * stock), Juice 120 + VAT 15% (10), Pills 100 (batches EARLY 2 at cost 10, LATE 5 at cost 12),
 * delivery inside Dhaka 60 (free from 2000), outside Dhaka 120 + COD fee 20.
 */
class EditOrderTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.coupon_rate_limit' => 1000]);
        $this->buildShop();
        $this->staff();
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, string|int>  $items  sku => quantity
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function body(array $items, string $expectedTotal, array $overrides = []): array
    {
        return $overrides + [
            'contact' => ['name' => 'Karim Uddin', 'phone' => '01812345678', 'email' => 'karim@example.test'],
            'lines' => array_map(fn (string $sku, $q) => ['variant_id' => $this->v[$sku], 'quantity' => (string) $q], array_keys($items), array_values($items)),
            'address' => ['recipient_name' => 'Karim Uddin', 'phone' => '01812345678', 'division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA, 'area' => 'Mirpur', 'address_line' => 'House 9, Road 4', 'postcode' => '1216'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'channel' => 'phone',
            'expected_total' => $expectedTotal,
        ];
    }

    /**
     * @param  array<string, string|int>  $items
     * @param  array<string, mixed>  $overrides
     */
    private function enter(array $items, string $total, array $overrides = []): string
    {
        return $this->postJson('/api/v1/web-orders', $this->body($items, $total, $overrides), ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function edit(string $id, array $body, ?string $key = null): TestResponse
    {
        return $this->putJson("/api/v1/web-orders/{$id}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $id, string $action, array $body = []): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$id}/{$action}", $body, ['Idempotency-Key' => (string) Str::uuid()]);
    }

    public function test_lines_go_up_down_in_and_out_with_exact_stock_and_batches(): void
    {
        $id = $this->enter(['PILLS' => 3, 'SHIRT' => 2], '1260.00');
        $this->assertSame(['EARLY' => '0.000', 'LATE' => '4.000'], $this->pillLevels());
        $this->assertSame('3.000', $this->level('SHIRT'));

        // The order's own stock counts as available in the quote.
        $quote = $this->postJson('/api/v1/web-orders/quote', ['order_id' => $id, 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '5']]])->assertOk()->json('data');
        $this->assertSame(['5.000', []], [$quote['lines'][0]['available'], $quote['issues']]);

        // Pills 3 → 4, shirt removed, juice added (120 + 18 VAT); 400 + 138 + 60 = 598.
        $edited = $this->edit($id, $this->body(['PILLS' => 4, 'JUICE' => 1], '598.00', ['reason' => 'Customer called back']))->assertOk()->json('data');
        $this->assertSame(['598.00', 2, 'confirmed'], [$edited['total'], $edited['revision'], $edited['status']]);
        $this->assertSame([$this->v['PILLS'], $this->v['JUICE']], array_column($edited['lines'], 'variant_id'));
        // Shirt back, pills returned to their batches and taken again FEFO, juice taken.
        $this->assertSame('5.000', $this->level('SHIRT'));
        $this->assertSame('9.000', $this->level('JUICE'));
        $this->assertSame(['EARLY' => '0.000', 'LATE' => '3.000'], $this->pillLevels());
        $this->assertSame([['EARLY', '2.000', '10.0000'], ['LATE', '2.000', '12.0000']], $this->allocations($id, 'PILLS'));
        $order = Order::query()->withoutGlobalScopes()->findOrFail($id);
        // Cost: pills 2 × 10 + 2 × 12, juice at its average cost (the opening stock's 0 in BuildsCheckout? read from the line).
        $juiceCost = (string) OrderLine::query()->withoutGlobalScopes()->where('order_id', $id)->where('variant_id', $this->v['JUICE'])->value('cost_total');
        $this->assertSame(number_format(44 + (float) $juiceCost, 2, '.', ''), (string) $order->cost_total);

        $movements = StockMovement::query()->withoutGlobalScopes()->where('reference_type', 'online_order_edit')->where('reference_id', $id)->get();
        $this->assertSame(['online_order' => 3, 'online_order_cancel' => 3], $movements->countBy(fn ($m) => $m->type->value)->sortKeys()->all());

        $change = $edited['edits'][0];
        $this->assertSame([2, 'Customer called back', '1260.00', '598.00', false, false, null, null, $this->tenant['admin']->id], [
            $change['revision'], $change['reason'], $change['total_before'], $change['total_after'], $change['contact_changed'], $change['address_changed'],
            $change['shipping_before'], $change['shipping_after'], $change['actor']['id'],
        ]);
        $this->assertEqualsCanonicalizing([
            ['name' => 'Pills', 'before' => '3.000', 'after' => '4.000'],
            ['name' => 'Shirt', 'before' => '2.000', 'after' => null],
            ['name' => 'Juice', 'before' => null, 'after' => '1.000'],
        ], $change['lines']);
        $last = end($edited['history']);
        $this->assertSame(['confirmed', 'confirmed', 'Order changed (revision 2)', 'staff'], [$last['from_status'], $last['status'], $last['note'], $last['actor_type']]);
        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.edited')->sole();
        $this->assertSame(['1260.00', '598.00'], [$audit->old_values['total'], $audit->new_values['total']]);

        // Down again: pills 4 → 1.
        $this->edit($id, $this->body(['PILLS' => 1, 'JUICE' => 1], '298.00'))->assertOk()->assertJsonPath('data.revision', 3)->assertJsonCount(2, 'data.edits');
        $this->assertSame(['EARLY' => '1.000', 'LATE' => '5.000'], $this->pillLevels());
        $this->assertSame([['EARLY', '1.000', '10.0000']], $this->allocations($id, 'PILLS'));
        $this->assertSame(2, OrderEdit::query()->withoutGlobalScopes()->where('order_id', $id)->count());

        // The shopper's status history has no edit steps.
        $this->assertSame(['confirmed'], array_column(app(OrderPresenter::class)->storefront($order->fresh())['history'], 'status'));
    }

    public function test_an_edit_without_line_changes_keeps_the_stock_and_can_use_what_the_order_holds(): void
    {
        $id = $this->enter(['SHIRT' => 5], '2250.00');
        $this->assertSame('0.000', $this->level('SHIRT'));
        $before = StockMovement::query()->withoutGlobalScopes()->count();

        // Outside Dhaka: 120 delivery + 20 COD fee; a new contact and address.
        $edited = $this->edit($id, $this->body(['SHIRT' => 5], '2390.00', [
            'contact' => ['name' => 'Karim U.', 'phone' => '01912345678'],
            'address' => ['recipient_name' => 'Karim U.', 'phone' => '01912345678', 'division_id' => $this->otherDivision, 'district_id' => $this->otherDistrict, 'address_line' => 'Shop 3, Main Road'],
            'shipping_method_id' => $this->methods['outside'],
            'notes' => 'Leave with the guard',
        ]))->assertOk()->json('data');

        $this->assertSame(['2390.00', '120.00', '20.00', 'Courier delivery', $this->methods['outside'], 'Leave with the guard'], [$edited['total'], $edited['shipping_total'], $edited['cod_fee'], $edited['shipping_method_name'], $edited['shipping_method_id'], $edited['notes']]);
        $this->assertSame(['Karim U.', '01912345678', null], [$edited['contact']['name'], $edited['contact']['phone'], $edited['contact']['email']]);
        $this->assertSame([$this->otherDistrict, null], [$edited['shipping_address']['district_id'], $edited['shipping_address']['area']]);
        $this->assertSame([[], true, true, 'Home delivery', 'Courier delivery'], [
            $edited['edits'][0]['lines'], $edited['edits'][0]['contact_changed'], $edited['edits'][0]['address_changed'], $edited['edits'][0]['shipping_before'], $edited['edits'][0]['shipping_after'],
        ]);
        $this->assertSame($before, StockMovement::query()->withoutGlobalScopes()->count());
        $this->assertSame('0.000', $this->level('SHIRT'));
        // A payment method in the body is ignored.
        $this->edit($id, $this->body(['SHIRT' => 5], '2250.00', ['payment_method' => 'bank_transfer']))->assertOk()->assertJsonPath('data.payment_method', 'cod');
    }

    public function test_promotions_are_released_and_recorded_again(): void
    {
        $org = $this->tenant['organization'];
        // Once per customer by coupon, and an automatic offer for the first order only.
        $this->makePromotion($org, ['name' => 'Once', 'type' => 'fixed', 'value' => '50', 'trigger' => 'coupon', 'usage_limit_per_customer' => 1, 'coupon_code' => 'ONCE50']);
        $this->makePromotion($org, ['name' => 'Launch', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productOf($this->v['SHIRT'])], 'usage_limit' => 1]);

        // 450 − 45 − 50 + 60.
        $id = $this->enter(['SHIRT' => 1], '415.00', ['coupon_code' => 'ONCE50']);
        $this->assertSame(2, $this->activeRedemptions($id));

        // Its own uses do not count against the limits: 900 − 90 − 50 + 60.
        $this->postJson('/api/v1/web-orders/quote', ['order_id' => $id, 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '2']], 'coupon_code' => 'ONCE50', 'contact' => ['phone' => '01812345678', 'email' => 'karim@example.test'], 'address' => ['district_id' => self::DHAKA]])
            ->assertOk()->assertJsonPath('data.total', '820.00');
        $edited = $this->edit($id, $this->body(['SHIRT' => 2], '820.00', ['coupon_code' => 'ONCE50']))->assertOk()->json('data');
        $this->assertSame(['140.00', 'ONCE50'], [$edited['discount_total'], $edited['coupon_code']]);
        $this->assertEqualsCanonicalizing(['90.00', '50.00'], array_column($edited['promotions'], 'amount'));
        $this->assertSame(2, $this->activeRedemptions($id));
        $this->assertSame(2, PromotionRedemption::query()->withoutGlobalScopes()->where('order_id', $id)->whereNotNull('released_at')->count());
        $this->assertSame(1, (int) Coupon::query()->withoutGlobalScopes()->where('code', 'ONCE50')->value('used_count'));

        // Dropping the coupon gives it back; an unchanged edit keeps the redemptions.
        $this->edit($id, $this->body(['SHIRT' => 2], '870.00', ['coupon_code' => null]))->assertOk()->assertJsonPath('data.coupon_code', null);
        $this->assertSame(1, $this->activeRedemptions($id));
        $this->assertSame(0, (int) Coupon::query()->withoutGlobalScopes()->where('code', 'ONCE50')->value('used_count'));
        $this->edit($id, $this->body(['SHIRT' => 2], '870.00', ['notes' => 'Gift wrap']))->assertOk();
        $this->assertSame(1, $this->activeRedemptions($id));
        // 2 at placement, 2 after the first edit, 1 after dropping the coupon; none for the unchanged edit.
        $this->assertSame(5, PromotionRedemption::query()->withoutGlobalScopes()->where('order_id', $id)->count());

        // The promotion snapshot stays append-only outside an edit.
        foreach ([fn () => DB::table('order_promotions')->where('order_id', $id)->update(['amount' => '1.00']), fn () => DB::table('order_promotions')->where('order_id', $id)->delete()] as $change) {
            try {
                DB::transaction($change);
                $this->fail('order_promotions must stay append-only.');
            } catch (QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
    }

    public function test_a_changed_total_is_refused_and_nothing_changes(): void
    {
        $id = $this->enter(['SHIRT' => 1], '510.00');
        $refused = $this->edit($id, $this->body(['SHIRT' => 2], '960.01'))->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED');
        $this->assertSame('960.00', $refused->json('error.details.preview.total'));
        // The order's own shirt counts as available.
        $this->assertSame(['5.000', 'cod'], [$refused->json('error.details.preview.lines.0.available'), $refused->json('error.details.preview.payment_method')]);
        $this->assertNotEmpty($refused->json('error.details.preview.payment_methods'));
        $this->edit($id, $this->body(['SHIRT' => 6], '2760.00'))->assertUnprocessable()->assertJsonPath('error.code', 'ITEMS_UNAVAILABLE');
        $this->edit($id, $this->body(['SHIRT' => 1], '630.00', ['shipping_method_id' => $this->methods['outside']]))->assertUnprocessable()->assertJsonPath('error.code', 'SHIPPING_UNAVAILABLE');

        $order = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
        $this->assertSame([1, '510.00', []], [$order['revision'], $order['total'], $order['edits']]);
        $this->assertSame('4.000', $this->level('SHIRT'));
    }

    public function test_only_unpaid_orders_that_have_not_shipped_can_be_changed(): void
    {
        $body = fn () => $this->body(['SHIRT' => 1], '510.00');

        // Shipped (and delivered).
        $shipped = $this->enter(['SHIRT' => 1], '510.00');
        $courier = $this->postJson('/api/v1/shipping/couriers', ['name' => 'Pathao'])->assertCreated()->json('data.id');
        $this->act($shipped, 'process')->assertOk()->assertJsonPath('data.allowed_actions', ['ship', 'cancel', 'edit']);
        $this->edit($shipped, $body())->assertOk();
        $this->act($shipped, 'ship', ['courier_id' => $courier])->assertOk()->assertJsonMissingPath('data.allowed_actions.3');
        $this->assertNotContains('edit', $this->getJson("/api/v1/web-orders/{$shipped}")->json('data.allowed_actions'));
        $this->edit($shipped, $body())->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_NOT_EDITABLE')->assertJsonPath('error.details.reason', 'shipped');
        $this->act($shipped, 'deliver')->assertOk();
        $this->edit($shipped, $body())->assertUnprocessable()->assertJsonPath('error.details.reason', 'shipped');

        // Paid.
        $paid = $this->enter(['SHIRT' => 1], '510.00', ['payment_method' => 'bank_transfer']);
        $this->assertContains('edit', $this->getJson("/api/v1/web-orders/{$paid}")->json('data.allowed_actions'));
        $this->act($paid, 'confirm-payment', ['reference' => 'TX-1'])->assertOk();
        $this->assertNotContains('edit', $this->getJson("/api/v1/web-orders/{$paid}")->json('data.allowed_actions'));
        $this->edit($paid, $body())->assertUnprocessable()->assertJsonPath('error.details.reason', 'paid');

        // Cancelled.
        $cancelled = $this->enter(['SHIRT' => 1], '510.00');
        $this->act($cancelled, 'cancel', ['reason' => 'Changed mind'])->assertOk();
        $this->edit($cancelled, $body())->assertUnprocessable()->assertJsonPath('error.details.reason', 'status');
    }

    public function test_the_snapshots_stay_append_only_outside_an_edit(): void
    {
        $id = $this->enter(['PILLS' => 1], '160.00');
        $this->edit($id, $this->body(['PILLS' => 2], '260.00'))->assertOk();

        $refused = function (callable $change): void {
            try {
                DB::transaction($change);
                $this->fail('The order snapshot must stay append-only.');
            } catch (QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        };
        $lineId = OrderLine::query()->withoutGlobalScopes()->where('order_id', $id)->value('id');
        foreach (['order_lines' => ['id', $lineId], 'order_line_stock' => ['order_line_id', $lineId], 'order_edits' => ['order_id', $id], 'order_status_history' => ['order_id', $id]] as $table => [$column, $value]) {
            $refused(fn () => DB::table($table)->where($column, $value)->update(['organization_id' => $this->tenant['organization']->id]));
            $refused(fn () => DB::table($table)->where($column, $value)->delete());
        }
        // Even inside an edit's setting, updates are refused.
        $refused(function () use ($lineId) {
            DB::statement("SELECT set_config('pos.order_edit', 'on', true)");
            DB::table('order_lines')->where('id', $lineId)->update(['quantity' => '9']);
        });
    }

    public function test_edits_are_idempotent_isolated_and_need_the_permission(): void
    {
        $id = $this->enter(['SHIRT' => 1], '510.00');
        $key = (string) Str::uuid();
        $this->edit($id, $this->body(['SHIRT' => 2], '960.00'), $key)->assertOk()->assertJsonPath('data.revision', 2);
        $this->edit($id, $this->body(['SHIRT' => 2], '960.00'), $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.revision', 2);
        $this->assertSame(1, OrderEdit::query()->withoutGlobalScopes()->where('order_id', $id)->count());
        $this->assertSame('3.000', $this->level('SHIRT'));

        $accountant = $this->createUserWithRole($this->tenant['organization'], SystemRole::Accountant);
        $this->actingAsUser($accountant);
        $this->edit($id, $this->body(['SHIRT' => 1], '510.00'))->assertForbidden();
        $this->assertNotContains('edit', $this->getJson("/api/v1/web-orders/{$id}")->json('data.allowed_actions'));

        // Another organization's staff cannot see or change it.
        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $this->edit($id, $this->body(['SHIRT' => 1], '510.00'))->assertNotFound();
        $this->postJson('/api/v1/web-orders/quote', ['order_id' => $id, 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']]])->assertNotFound();
        $this->assertSame(2, Order::query()->withoutGlobalScopes()->findOrFail($id)->revision);
    }

    private function activeRedemptions(string $orderId): int
    {
        return PromotionRedemption::query()->withoutGlobalScopes()->where('order_id', $orderId)->whereNull('released_at')->count();
    }

    private function level(string $sku): string
    {
        return (string) DB::table('stock_levels')->where('variant_id', $this->v[$sku])->where('store_id', $this->tenant['store']->id)->value('quantity');
    }

    /**
     * @return array<string, string>
     */
    private function pillLevels(): array
    {
        return DB::table('stock_levels')->leftJoin('batches', 'batches.id', '=', 'stock_levels.batch_id')
            ->where('stock_levels.variant_id', $this->v['PILLS'])->orderBy('batches.batch_number')
            ->pluck('stock_levels.quantity', 'batches.batch_number')->map(fn ($q) => (string) $q)->all();
    }

    /**
     * @return list<array{0: string, 1: string, 2: string}> batch number, quantity, unit cost of the order's line of $sku
     */
    private function allocations(string $orderId, string $sku): array
    {
        return DB::table('order_line_stock as s')->join('order_lines as l', 'l.id', '=', 's.order_line_id')
            ->leftJoin('batches as b', 'b.id', '=', 's.batch_id')
            ->where('l.order_id', $orderId)->where('l.variant_id', $this->v[$sku])->orderBy('b.batch_number')
            ->get(['b.batch_number', 's.quantity', 's.unit_cost'])
            ->map(fn ($r) => [(string) $r->batch_number, (string) $r->quantity, (string) $r->unit_cost])->all();
    }
}
