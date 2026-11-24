<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Actions\CancelOwnOrder;
use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1b: cash-on-delivery fraud controls — orders held for a confirmation call
 * (`pending_confirmation`, the store's `cod_review`), staff confirmation (one and bulk),
 * blocked numbers (COD refused, `cod_available` in the preview) and the delivery history of a
 * mobile number (detail, list risk, report endpoint), per organization.
 */
class CodControlsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const PHONE = '01811111111';

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * A guest's cart order of one Rice (untracked stock) to Dhaka, contact and delivery phone `$phone`.
     *
     * @param  array<string, mixed>  $overrides  checkout body
     */
    private function shopOrder(string $phone, string $payment = 'cod', array $overrides = [], string $host = self::HOST): TestResponse
    {
        $this->clearBrowser();
        $this->asVisitor();
        $this->addToCart('RICE', 1, $host);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => $payment], $host)->json('data.total');

        return $this->placeOrder($this->checkoutBody($total, $overrides + [
            'payment_method' => $payment,
            'contact' => ['name' => 'Rina Akter', 'email' => null, 'phone' => $phone],
            'address' => ['phone' => $phone] + $this->inlineAddress(),
        ]), null, $host);
    }

    private function orderId(TestResponse $placed): string
    {
        return (string) Order::query()->withoutGlobalScopes()
            ->where('organization_id', $this->tenant['organization']->id)
            ->where('number', $placed->assertCreated()->json('data.order.number'))->value('id');
    }

    /**
     * Sets an order's outcome directly (delivered, returned by the courier then cancelled, cancelled).
     */
    private function outcome(string $orderId, string $outcome): void
    {
        $orders = DB::table('orders')->where('id', $orderId);
        if ($outcome === 'delivered') {
            $orders->update(['status' => 'delivered', 'delivered_at' => now(), 'shipped_at' => now()]);

            return;
        }
        if ($outcome === 'returned') {
            $order = $orders->first();
            DB::table('shipments')->insert([
                'id' => (string) Str::uuid7(), 'organization_id' => $order->organization_id, 'order_id' => $orderId, 'courier_name' => 'Pathao',
                'status' => 'returned', 'cod_amount' => $order->total, 'shipped_at' => now(), 'returned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $orders->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancel_reason' => 'Refused']);
    }

    /**
     * The workflow steps among the allowed actions (without §1–§2's `edit`).
     *
     * @param  list<string>  $actions
     * @return list<string>
     */
    private static function workflowActions(array $actions): array
    {
        return array_values(array_diff($actions, ['edit']));
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function settings(array $settings): void
    {
        $this->staff();
        $this->patchJson('/api/v1/storefront/settings', $settings)->assertOk();
    }

    public function test_cod_review_settings_are_validated_saved_and_audited(): void
    {
        $this->staff();
        $this->getJson('/api/v1/storefront/settings')->assertOk()
            ->assertJsonPath('data.cod_review', 'off')->assertJsonPath('data.cod_review_min_success_rate', 70)->assertJsonPath('data.cod_review_new_numbers', false);

        $this->patchJson('/api/v1/storefront/settings', ['cod_review' => 'sometimes'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['cod_review']]]);
        $this->patchJson('/api/v1/storefront/settings', ['cod_review_min_success_rate' => 101])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['cod_review_min_success_rate']]]);

        $this->patchJson('/api/v1/storefront/settings', ['cod_review' => 'risky', 'cod_review_min_success_rate' => 60, 'cod_review_new_numbers' => true])->assertOk()
            ->assertJsonPath('data.cod_review', 'risky')->assertJsonPath('data.cod_review_min_success_rate', 60)->assertJsonPath('data.cod_review_new_numbers', true);
        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'storefront.settings_updated')->get()->first(fn (AuditLog $a) => ($a->new_values['cod_review'] ?? null) === 'risky');
        $this->assertSame('off', $audit->old_values['cod_review']);
        $this->assertEquals(['cod_review' => 'risky', 'cod_review_min_success_rate' => 60, 'cod_review_new_numbers' => true], array_intersect_key($audit->new_values, array_flip(['cod_review', 'cod_review_min_success_rate', 'cod_review_new_numbers'])));
    }

    public function test_all_cod_orders_wait_for_a_call_and_staff_confirm_them(): void
    {
        Event::fake([OrderStatusChanged::class]);
        $this->settings(['cod_review' => 'all']);

        $placed = $this->shopOrder(self::PHONE)->assertCreated()->assertJsonPath('data.order.status', 'pending_confirmation')
            ->assertJsonPath('data.order.status_label', 'Awaiting confirmation');
        $held = $this->orderId($placed);
        // Bank transfer orders are not held: they wait for the payment as before.
        $bank = $this->orderId($this->shopOrder(self::PHONE, 'bank_transfer')->assertJsonPath('data.order.status', 'pending_payment'));

        $order = Order::query()->withoutGlobalScopes()->findOrFail($held);
        $this->assertNull($order->confirmed_at);
        $this->assertNull($order->expires_at);
        $this->assertTrue(CancelOwnOrder::allowed($order));

        $this->staff();
        $detail = $this->getJson("/api/v1/web-orders/{$held}")->assertOk()->json('data');
        $this->assertSame(['confirm', 'cancel'], self::workflowActions($detail['allowed_actions']));
        $this->assertSame([['pending_confirmation', 'Order placed — awaiting confirmation']], array_map(fn ($h) => [$h['status'], $h['note']], $detail['history']));
        $this->getJson('/api/v1/web-orders?status=pending_confirmation')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('meta.status_counts.pending_confirmation', 1);

        // Only confirm or cancel: no processing first; the bank transfer is not "confirmed" this way.
        $this->act($held, 'process')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->act($bank, 'confirm')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->act($held, 'confirm', ['note' => str_repeat('x', 201)])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');

        $key = (string) Str::uuid();
        $confirmed = $this->act($held, 'confirm', ['note' => 'Spoke with Rina'], $key)->assertOk()->json('data');
        $this->assertSame(['confirmed', ['process', 'cancel']], [$confirmed['status'], self::workflowActions($confirmed['allowed_actions'])]);
        $this->assertNotNull($confirmed['confirmed_at']);
        $this->assertSame(['pending_confirmation', 'confirmed', 'Spoke with Rina', $this->tenant['admin']->id], [
            $confirmed['history'][1]['from_status'], $confirmed['history'][1]['status'], $confirmed['history'][1]['note'], $confirmed['history'][1]['actor']['id'],
        ]);
        $this->act($held, 'confirm', ['note' => 'Spoke with Rina'], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->act($held, 'confirm')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');

        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.confirmed')->count());
        Event::assertDispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => $e->orderId === $held && $e->from === 'pending_confirmation' && $e->to === 'confirmed');
    }

    public function test_held_orders_are_cancellable_and_never_expire(): void
    {
        $this->settings(['cod_review' => 'all']);
        $held = $this->orderId($this->shopOrder(self::PHONE));

        $this->travel(200)->hours();
        $this->artisan('orders:expire-pending')->expectsOutputToContain('Cancelled 0 expired order(s).');
        $this->assertSame('pending_confirmation', Order::query()->withoutGlobalScopes()->findOrFail($held)->status->value);

        $this->staff();
        $this->act($held, 'cancel', ['reason' => 'Customer did not answer'])->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    public function test_bulk_confirm_moves_each_held_order_on_its_own(): void
    {
        $this->settings(['cod_review' => 'all']);
        $a = $this->orderId($this->shopOrder(self::PHONE));
        $b = $this->orderId($this->shopOrder('01922222222'));
        $this->settings(['cod_review' => 'off']);
        $plain = $this->orderId($this->shopOrder('01933333333')->assertJsonPath('data.order.status', 'confirmed'));
        $unknown = (string) Str::uuid();

        $this->staff();
        $this->postJson('/api/v1/web-orders/bulk/confirm', ['ids' => []], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422);
        $result = $this->postJson('/api/v1/web-orders/bulk/confirm', ['ids' => [$a, $plain, $unknown, $b]], ['Idempotency-Key' => (string) Str::uuid()])->assertOk()->json('data');
        $this->assertSame([2, 2], [$result['succeeded'], $result['failed']]);
        $this->assertSame([true, false, false, true], array_column($result['results'], 'ok'));
        $this->assertSame(['INVALID_STATUS_TRANSITION', 'NOT_FOUND'], [$result['results'][1]['error_code'], $result['results'][2]['error_code']]);
        $this->assertSame(['confirmed', 'confirmed'], Order::query()->withoutGlobalScopes()->whereIn('id', [$a, $b])->pluck('status')->map->value->all());
        $this->assertSame(2, AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.confirmed')->count());
    }

    public function test_risky_mode_holds_numbers_with_a_low_success_rate_or_without_deliveries(): void
    {
        // History: 01811111111 delivered 1, returned 1 (50 %); 01944444444 delivered 4, returned 1 (80 %).
        foreach (['delivered', 'returned'] as $outcome) {
            $this->outcome($this->orderId($this->shopOrder(self::PHONE)), $outcome);
        }
        foreach (['delivered', 'delivered', 'delivered', 'delivered', 'returned'] as $outcome) {
            $this->outcome($this->orderId($this->shopOrder('01944444444')), $outcome);
        }

        $this->settings(['cod_review' => 'risky', 'cod_review_min_success_rate' => 70]);
        $this->shopOrder(self::PHONE)->assertJsonPath('data.order.status', 'pending_confirmation');
        $this->shopOrder('01944444444')->assertJsonPath('data.order.status', 'confirmed');
        // A new number is not held unless the store says so.
        $this->shopOrder('01755555555')->assertJsonPath('data.order.status', 'confirmed');

        $this->settings(['cod_review_new_numbers' => true]);
        $this->shopOrder('01766666666')->assertJsonPath('data.order.status', 'pending_confirmation');
        $this->shopOrder('01944444444')->assertJsonPath('data.order.status', 'confirmed');

        $this->settings(['cod_review_min_success_rate' => 90]);
        $this->shopOrder('01944444444')->assertJsonPath('data.order.status', 'pending_confirmation');
        // Off: nothing is held.
        $this->settings(['cod_review' => 'off']);
        $this->shopOrder(self::PHONE)->assertJsonPath('data.order.status', 'confirmed');
    }

    public function test_blocked_numbers_cannot_order_with_cash_on_delivery(): void
    {
        $this->staff();
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '12345'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['phone']]]);
        $row = $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '+880 1811-111111', 'reason' => ' Refused 3 parcels '])->assertCreated()->json('data');
        $this->assertSame(['01811111111', 'Refused 3 parcels', $this->tenant['admin']->id, $this->tenant['admin']->name], [$row['phone'], $row['reason'], $row['created_by']['id'], $row['created_by']['name']]);
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '01811111111'])->assertStatus(422)->assertJsonPath('error.details.phone.0', 'This number is already blocked.');
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '01922222222'])->assertCreated();

        $list = $this->getJson('/api/v1/web-orders/blocked-phones')->assertOk();
        $this->assertSame(['01922222222', '01811111111'], array_column($list->json('data'), 'phone'));
        $this->assertSame(2, $list->json('meta.pagination.total'));
        $this->getJson('/api/v1/web-orders/blocked-phones?search=+880181')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.phone', '01811111111');
        $this->getJson('/api/v1/web-orders/blocked-phones?search=parcels')->assertJsonPath('meta.pagination.total', 1);

        // The previews: COD unusable for a blocked contact or delivery phone (outside Dhaka: COD fee 20).
        $this->clearBrowser();
        $this->asVisitor();
        $this->addToCart('RICE', 1);
        $base = ['address' => ['district_id' => $this->otherDistrict], 'shipping_method_id' => $this->methods['outside'], 'payment_method' => 'cod'];
        $this->previewCheckout($base + ['contact' => ['phone' => '01733333333']])->assertOk()
            ->assertJsonPath('data.cod_available', true)->assertJsonPath('data.payment_method', 'cod')->assertJsonPath('data.cod_fee', '20.00')->assertJsonPath('data.total', '200.50');
        $this->previewCheckout($base + ['contact' => ['phone' => '+8801811111111']])->assertOk()
            ->assertJsonPath('data.cod_available', false)->assertJsonPath('data.payment_method', null)->assertJsonPath('data.cod_fee', '0.00')->assertJsonPath('data.total', '180.50');
        $this->previewCheckout(['address' => ['district_id' => $this->otherDistrict, 'phone' => '01922222222'], 'contact' => ['phone' => '01733333333']] + $base)
            ->assertJsonPath('data.cod_available', false);
        $this->previewCheckout(['payment_method' => 'bank_transfer', 'contact' => ['phone' => '01811111111']] + $base)
            ->assertJsonPath('data.cod_available', false)->assertJsonPath('data.payment_method', 'bank_transfer');

        // Placement: refused for the contact phone and for the delivery phone; bank transfer is fine.
        $this->shopOrder('01811111111')->assertStatus(422)->assertJsonPath('error.code', 'COD_NOT_AVAILABLE')
            ->assertJsonPath('error.message', 'Cash on delivery is not available for this order. Please choose another payment method.');
        $this->shopOrder('01733333333', 'cod', ['address' => ['phone' => '01922222222'] + $this->inlineAddress()])->assertStatus(422)->assertJsonPath('error.code', 'COD_NOT_AVAILABLE');
        $this->shopOrder('01811111111', 'bank_transfer')->assertCreated();
        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());

        // Unblocked: cash on delivery again.
        $this->staff();
        $this->deleteJson("/api/v1/web-orders/blocked-phones/{$row['id']}")->assertNoContent();
        $this->deleteJson("/api/v1/web-orders/blocked-phones/{$row['id']}")->assertNotFound();
        $this->shopOrder('01811111111')->assertCreated();

        $this->assertSame(['blocked_phone.added', 'blocked_phone.added', 'blocked_phone.removed'],
            AuditLog::query()->withoutGlobalScopes()->where('action', 'like', 'blocked_phone.%')->orderBy('created_at')->orderBy('id')->pluck('action')->all());
    }

    public function test_phone_report_counts_outcomes_and_the_success_rate(): void
    {
        $orders = [];
        foreach (['delivered', 'delivered', 'delivered', 'returned', 'cancelled', null] as $outcome) {
            $orders[] = $id = $this->orderId($this->shopOrder(self::PHONE));
            if ($outcome !== null) {
                $this->outcome($id, $outcome);
            }
        }
        $this->orderId($this->shopOrder('01922222222'));

        $this->staff();
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => self::PHONE, 'reason' => 'Fake orders'])->assertCreated();
        $report = $this->getJson('/api/v1/web-orders/phone-report?phone=+880 1811-111111')->assertOk()->json('data');
        $lastOrderAt = $report['last_order_at'];
        unset($report['last_order_at']);
        $this->assertSame([
            'phone' => self::PHONE, 'orders' => 6, 'delivered' => 3, 'returned' => 1, 'cancelled' => 1, 'in_progress' => 1,
            'success_rate' => 75, 'blocked' => true, 'block_reason' => 'Fake orders',
        ], $report);
        $this->assertNotNull($lastOrderAt);

        $this->assertSame([
            'phone' => '01700000000', 'orders' => 0, 'delivered' => 0, 'returned' => 0, 'cancelled' => 0, 'in_progress' => 0,
            'success_rate' => null, 'last_order_at' => null, 'blocked' => false, 'block_reason' => null,
        ], $this->getJson('/api/v1/web-orders/phone-report?phone=01700000000')->assertOk()->json('data'));
        $this->getJson('/api/v1/web-orders/phone-report?phone=01922222222')->assertJsonPath('data.orders', 1)->assertJsonPath('data.success_rate', null);
        $this->getJson('/api/v1/web-orders/phone-report?phone=12345')->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['phone']]]);
        $this->getJson('/api/v1/web-orders/phone-report')->assertStatus(422);

        // The order detail carries the same report for its contact phone.
        $detail = $this->getJson("/api/v1/web-orders/{$orders[5]}")->assertOk()->json('data.phone_report');
        $this->assertSame([6, 75, true], [$detail['orders'], $detail['success_rate'], $detail['blocked']]);
    }

    public function test_list_rows_carry_the_phone_risk_from_grouped_queries(): void
    {
        foreach (['delivered', 'returned'] as $outcome) {
            $this->outcome($this->orderId($this->shopOrder(self::PHONE)), $outcome);
        }
        $this->orderId($this->shopOrder(self::PHONE));
        foreach (range(1, 4) as $i) {
            $this->orderId($this->shopOrder('0192222222'.$i));
        }
        $this->staff();
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '01922222221'])->assertCreated();

        DB::enableQueryLog();
        $rows = $this->getJson('/api/v1/web-orders')->assertOk()->json('data');
        $queries = array_column(DB::getQueryLog(), 'query');
        DB::disableQueryLog();

        $this->assertCount(7, $rows);
        $this->assertCount(1, array_filter($queries, fn (string $q) => str_contains($q, '"blocked_phones"')), 'One blocked-numbers query for the page.');
        $this->assertCount(1, array_filter($queries, fn (string $q) => str_contains($q, '"shipments" as "s"')), 'One grouped history query for the page.');

        $risk = collect($rows)->mapWithKeys(fn (array $r) => [$r['number'] => [$r['contact_phone'], $r['risk']]])->all();
        $this->assertSame([self::PHONE, ['success_rate' => 50, 'blocked' => false]], $risk['WEB-000003']);
        $this->assertSame(['01922222221', ['success_rate' => null, 'blocked' => true]], $risk['WEB-000004']);
        $this->assertSame(['01922222222', ['success_rate' => null, 'blocked' => false]], $risk['WEB-000005']);
    }

    public function test_reports_blocks_and_holds_are_per_organization(): void
    {
        $ours = $this->tenant;
        $oursV = $this->v;
        $oursMethods = $this->methods;

        // Another organization: a delivered order and a returned one for the same number, and a block.
        $this->buildShop('Other Shop', 'other.example.test');
        foreach (['returned', 'returned'] as $outcome) {
            $this->outcome($this->orderId($this->shopOrder(self::PHONE, 'cod', [], 'other.example.test')), $outcome);
        }
        $this->staff();
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => self::PHONE])->assertCreated();
        $theirBlock = $this->getJson('/api/v1/web-orders/blocked-phones')->json('data.0.id');
        $this->getJson('/api/v1/web-orders/phone-report?phone='.self::PHONE)->assertJsonPath('data.returned', 2)->assertJsonPath('data.blocked', true);

        $this->tenant = $ours;
        $this->v = $oursV;
        $this->methods = $oursMethods;
        $this->staff();
        $this->getJson('/api/v1/web-orders/phone-report?phone='.self::PHONE)->assertOk()
            ->assertJsonPath('data.orders', 0)->assertJsonPath('data.success_rate', null)->assertJsonPath('data.blocked', false);
        $this->getJson('/api/v1/web-orders/blocked-phones')->assertJsonPath('meta.pagination.total', 0);
        $this->deleteJson("/api/v1/web-orders/blocked-phones/{$theirBlock}")->assertNotFound();

        // Their block and their returns do not touch our checkout or review.
        $this->patchJson('/api/v1/storefront/settings', ['cod_review' => 'risky', 'cod_review_min_success_rate' => 70])->assertOk();
        $placed = $this->shopOrder(self::PHONE)->assertCreated()->assertJsonPath('data.order.status', 'confirmed');
        $this->staff();
        $this->getJson('/api/v1/web-orders/'.$this->orderId($placed))->assertJsonPath('data.phone_report.orders', 1)->assertJsonPath('data.phone_report.blocked', false);
    }

    public function test_permissions(): void
    {
        $this->settings(['cod_review' => 'all']);
        $held = $this->orderId($this->shopOrder(self::PHONE));
        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->clearBrowser();

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/web-orders/blocked-phones')->assertForbidden();
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '01922222222'])->assertForbidden();
        $this->getJson('/api/v1/web-orders/phone-report?phone='.self::PHONE)->assertForbidden();
        $this->act($held, 'confirm')->assertForbidden();
        $this->postJson('/api/v1/web-orders/bulk/confirm', ['ids' => [$held]], ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();

        $this->actingAsUser($manager);
        $this->postJson('/api/v1/web-orders/blocked-phones', ['phone' => '01922222222'])->assertCreated();
        $this->getJson('/api/v1/web-orders/phone-report?phone='.self::PHONE)->assertOk();
        // Confirming needs an Idempotency-Key.
        $this->postJson("/api/v1/web-orders/{$held}/confirm")->assertStatus(428);
        $this->act($held, 'confirm')->assertOk()->assertJsonPath('data.status', 'confirmed');
    }
}
