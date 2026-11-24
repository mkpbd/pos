<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1c §3: the advance delivery charge of cash-on-delivery orders — settings, amounts, which
 * orders owe it, and the partly paid order through shipping, COD collection, remittance and
 * cancellation with a refund.
 */
class CodAdvanceTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private string $courier;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->staff();
        $this->putJson('/api/v1/payment-gateways/bkash_manual', ['is_enabled' => true, 'settings' => ['account_number' => '01700000001']])->assertOk();
        $this->courier = $this->postJson('/api/v1/shipping/couriers', ['name' => 'Pathao'])->assertCreated()->json('data.id');
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function settings(array $settings): void
    {
        $this->staff();
        $this->patchJson('/api/v1/storefront/settings', $settings)->assertOk();
    }

    /**
     * The checkout preview of a cart (`$sku` × `$quantity`) delivered inside Dhaka or outside.
     *
     * @param  array<string, mixed>  $extra
     */
    private function preview(string $sku = 'RICE', int $quantity = 1, bool $outside = false, array $extra = []): TestResponse
    {
        $this->clearBrowser();
        $this->addToCart($sku, $quantity);

        return $this->previewCheckout($extra + [
            'address' => ['district_id' => $outside ? $this->otherDistrict : self::DHAKA],
            'shipping_method_id' => $this->methods[$outside ? 'outside' : 'inside'],
            'payment_method' => 'cod',
        ])->assertOk();
    }

    /**
     * A guest's COD order of one Rice to Dhaka (120.50: 60.50 + 60 delivery), contact and delivery phone `$phone`.
     */
    private function shopOrder(string $phone = '01712345678'): TestResponse
    {
        $this->clearBrowser();
        $this->addToCart('RICE', 1);

        return $this->placeOrder($this->checkoutBody('120.50', [
            'contact' => ['name' => 'Rina Akter', 'email' => null, 'phone' => $phone],
            'address' => ['phone' => $phone] + $this->inlineAddress(),
        ]))->assertCreated();
    }

    private function idOf(TestResponse $placed): string
    {
        return (string) Order::query()->withoutGlobalScopes()->where('number', $placed->json('data.order.number'))->value('id');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = []): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => (string) Str::uuid()]);
    }

    /**
     * Places an order owing the advance, reports and confirms the advance: a partly paid confirmed order.
     */
    private function advancePaidOrder(string $trxId = 'ADV12345'): string
    {
        $placed = $this->shopOrder();
        $this->browse('POST', $this->storeUrl("orders/{$placed->json('data.order.number')}/payment-claims"), [
            'token' => $placed->json('data.access_token'), 'method' => 'bkash_manual', 'sender_phone' => '01912345678', 'transaction_id' => $trxId,
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $id = $this->idOf($placed);
        $this->staff();
        $claim = $this->getJson("/api/v1/web-orders/{$id}")->json('data.payment_claims.0.id');
        $this->act($id, "payment-claims/{$claim}/confirm")->assertOk();

        return $id;
    }

    public function test_advance_settings_are_validated_saved_and_audited(): void
    {
        $this->getJson('/api/v1/storefront/settings')->assertOk()
            ->assertJsonPath('data.cod_advance', 'off')->assertJsonPath('data.cod_advance_amount', 'delivery')
            ->assertJsonPath('data.cod_advance_fixed', null)->assertJsonPath('data.cod_advance_hold_hours', 24)->assertJsonPath('data.cod_advance_ready', true);

        $this->patchJson('/api/v1/storefront/settings', ['cod_advance' => 'sometimes'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['cod_advance']]]);
        $this->patchJson('/api/v1/storefront/settings', ['cod_advance_hold_hours' => 0])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['cod_advance_hold_hours']]]);
        $this->patchJson('/api/v1/storefront/settings', ['cod_advance_amount' => 'fixed'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['cod_advance_fixed']]]);
        $this->patchJson('/api/v1/storefront/settings', ['cod_advance_amount' => 'fixed', 'cod_advance_fixed' => '0'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['cod_advance_fixed']]]);

        $this->patchJson('/api/v1/storefront/settings', ['cod_advance' => 'risky', 'cod_advance_amount' => 'fixed', 'cod_advance_fixed' => '50', 'cod_advance_hold_hours' => 12])->assertOk()
            ->assertJsonPath('data.cod_advance', 'risky')->assertJsonPath('data.cod_advance_fixed', '50.00')->assertJsonPath('data.cod_advance_hold_hours', 12);
        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'storefront.settings_updated')->get()->first(fn (AuditLog $a) => ($a->new_values['cod_advance'] ?? null) === 'risky');
        $this->assertSame(['off', 'delivery'], [$audit->old_values['cod_advance'], $audit->old_values['cod_advance_amount']]);
        $this->assertSame(['fixed', '50.00', 12], [$audit->new_values['cod_advance_amount'], $audit->new_values['cod_advance_fixed'], $audit->new_values['cod_advance_hold_hours']]);

        // Without a Send Money method the advance cannot be paid: not ready.
        $this->putJson('/api/v1/payment-gateways/bkash_manual', ['is_enabled' => false])->assertOk();
        $this->getJson('/api/v1/storefront/settings')->assertJsonPath('data.cod_advance_ready', false);
    }

    public function test_the_advance_amount(): void
    {
        $this->settings(['cod_advance' => 'all']);
        // Delivery charge (+ COD fee): 60 inside Dhaka, 120 + 20 outside; none with free delivery or another payment method.
        $advance = $this->preview()->assertJsonPath('data.cod_advance.amount', '60.00')->json('data.cod_advance');
        $this->assertSame([['code' => 'bkash_manual', 'display_name' => 'bKash (Send Money)', 'account_number' => '01700000001', 'account_type' => 'personal', 'instructions' => null]], $advance['methods']);
        $this->preview('RICE', 1, true)->assertJsonPath('data.cod_advance.amount', '140.00');
        $this->preview('SHIRT', 5)->assertJsonPath('data.shipping_total', '0.00')->assertJsonPath('data.cod_advance', null);
        $this->preview('RICE', 1, false, ['payment_method' => 'bank_transfer'])->assertJsonPath('data.cod_advance', null);

        // Fixed: the amount, at most the order total.
        $this->settings(['cod_advance_amount' => 'fixed', 'cod_advance_fixed' => '100']);
        $this->preview()->assertJsonPath('data.cod_advance.amount', '100.00');
        $this->settings(['cod_advance_fixed' => '500']);
        $this->preview()->assertJsonPath('data.total', '120.50')->assertJsonPath('data.cod_advance.amount', '120.50');
        $this->settings(['cod_advance' => 'off']);
        $this->preview()->assertJsonPath('data.cod_advance', null);
    }

    public function test_risky_numbers_only_and_fail_open_when_not_ready(): void
    {
        // A number with a delivered order is trusted; a new number is risky (the COD check's rule).
        $trusted = $this->idOf($this->shopOrder('01811111111'));
        DB::table('orders')->where('id', $trusted)->update(['status' => 'delivered', 'shipped_at' => now(), 'delivered_at' => now()]);
        $this->settings(['cod_advance' => 'risky', 'cod_review_new_numbers' => true]);

        $this->preview()->assertJsonPath('data.cod_advance', null);
        $this->preview('RICE', 1, false, ['contact' => ['phone' => '01811111111']])->assertJsonPath('data.cod_advance', null);
        $this->preview('RICE', 1, false, ['contact' => ['phone' => '+880 1922-222222']])->assertJsonPath('data.cod_advance.amount', '60.00');
        $this->shopOrder('01811111111')->assertJsonPath('data.order.status', 'confirmed')->assertJsonPath('data.order.payment_due', null);
        $this->shopOrder('01922222222')->assertJsonPath('data.order.status', 'pending_payment')->assertJsonPath('data.order.payment_due.purpose', 'advance');

        // The advance replaces the confirmation call.
        $this->settings(['cod_advance' => 'all', 'cod_review' => 'all']);
        $this->shopOrder('01933333333')->assertJsonPath('data.order.status', 'pending_payment');

        // No Send Money method on: applied as off.
        $this->staff();
        $this->putJson('/api/v1/payment-gateways/bkash_manual', ['is_enabled' => false])->assertOk();
        $this->preview()->assertJsonPath('data.cod_advance', null);
        $this->shopOrder('01944444444')->assertJsonPath('data.order.status', 'pending_confirmation');
    }

    public function test_an_order_owing_the_advance_waits_for_it_and_expires(): void
    {
        $this->settings(['cod_advance' => 'all', 'cod_advance_hold_hours' => 12]);
        $this->staff();
        $this->putJson('/api/v1/payment-gateways/nagad_manual', ['is_enabled' => true, 'settings' => ['account_number' => '01800000002', 'account_type' => 'merchant']])->assertOk();
        $this->travelTo(now()->startOfMinute());

        $placed = $this->shopOrder();
        $order = $placed->json('data.order');
        $this->assertSame(['pending_payment', now()->addHours(12)->toIso8601String()], [$order['status'], $order['expires_at']]);
        $this->assertSame(['60.00', 'advance', ['bkash_manual', 'nagad_manual']], [$order['payment_due']['amount'], $order['payment_due']['purpose'], array_column($order['payment_due']['methods'], 'code')]);
        $id = $this->idOf($placed);
        $this->staff();
        $detail = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
        $this->assertSame(['60.00', 'Order placed — waiting for the advance delivery charge'], [$detail['advance_amount'], $detail['history'][0]['note']]);
        // Not a bank transfer: no "confirm payment" with a reference for the advance.
        $this->assertNotContains('confirm_payment', $detail['allowed_actions']);

        $this->travel(13)->hours();
        $this->artisan('orders:expire-pending')->expectsOutputToContain('Cancelled 1 expired order(s).');
        $this->assertSame('cancelled', Order::query()->withoutGlobalScopes()->findOrFail($id)->status->value);
    }

    public function test_a_partly_paid_order_is_shipped_with_the_rest_to_collect(): void
    {
        $this->settings(['cod_advance' => 'all']);
        $id = $this->advancePaidOrder();

        $order = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
        $this->assertSame(['confirmed', 'partially_paid', 'Partly paid', '60.00', null], [$order['status'], $order['payment_status'], $order['payment_status_label'], $order['paid_total'], $order['payment_due']]);
        $this->assertSame('Advance delivery charge received (bKash TrxID ADV12345)', $order['history'][1]['note']);
        // Paid in part: no edits, no "record COD payment" yet, cancelling needs a refund.
        $this->assertSame(['process', 'cancel'], $order['allowed_actions']);
        $this->assertSame('60.00', $order['cancel_refund_amount']);

        $this->act($id, 'process')->assertOk();
        $shipped = $this->act($id, 'ship', ['courier_id' => $this->courier])->assertOk()->json('data');
        $this->assertSame('60.50', $shipped['shipment']['cod_amount']);
        $this->assertContains('record_cod_payment', $shipped['allowed_actions']);
        $this->act($id, 'deliver')->assertOk();
        $this->getJson('/api/v1/web-orders?cod_unremitted=1')->assertJsonPath('meta.pagination.total', 1);

        $paid = $this->act($id, 'record-cod-payment', ['reference' => 'rider'])->assertOk()->json('data');
        $this->assertSame(['paid', '120.50'], [$paid['payment_status'], $paid['paid_total']]);
        $this->assertSame([['mobile_banking', '60.00'], ['cash_on_delivery', '60.50']], array_map(fn ($p) => [$p['method'], $p['amount']], $paid['payments']));
        $this->assertSame('60.50', AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.cod_payment_recorded')->sole()->new_values['amount']);
        $this->act($id, 'record-cod-payment')->assertStatus(422)->assertJsonPath('error.code', 'ORDER_ALREADY_PAID');
    }

    public function test_the_courier_remits_only_the_rest(): void
    {
        $this->settings(['cod_advance' => 'all']);
        $id = $this->advancePaidOrder();
        $this->act($id, 'process')->assertOk();
        $this->act($id, 'ship', ['courier_id' => $this->courier])->assertOk();
        $this->act($id, 'deliver')->assertOk();

        $remittance = $this->postJson('/api/v1/cod-remittances', [
            'courier_id' => $this->courier, 'received_at' => now('Asia/Dhaka')->toDateString(), 'method' => 'cash', 'fee_amount' => '10', 'order_ids' => [$id],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data');
        $this->assertSame(['60.50', '50.50'], [$remittance['gross_amount'], $remittance['net_amount']]);
        $this->assertSame(['paid', '120.50'], [Order::query()->withoutGlobalScopes()->findOrFail($id)->payment_status->value, (string) Order::query()->withoutGlobalScopes()->findOrFail($id)->paid_total]);
        $this->assertSame(['60.00', '60.50'], Payment::query()->withoutGlobalScopes()->where('source_id', $id)->orderBy('amount')->pluck('amount')->map(fn ($a) => (string) $a)->all());
    }

    public function test_cancelling_a_partly_paid_order_refunds_the_advance(): void
    {
        $this->settings(['cod_advance' => 'all']);
        $id = $this->advancePaidOrder();

        $this->act($id, 'cancel', ['reason' => 'Customer changed mind'])->assertStatus(422)->assertJsonPath('error.code', 'REFUND_REQUIRED')
            ->assertJsonPath('error.details.refund_amount', '60.00');
        $cancelled = $this->act($id, 'cancel', ['reason' => 'Customer changed mind', 'refund' => ['method' => 'mobile_banking', 'reference' => 'bKash back']])->assertOk()->json('data');
        $this->assertSame(['cancelled', 'refunded', '60.00'], [$cancelled['status'], $cancelled['payment_status'], $cancelled['refunded_total']]);
        $this->assertSame(['in', 'out'], array_column($cancelled['payments'], 'direction'));
    }

    public function test_staff_orders_never_owe_an_advance(): void
    {
        $this->settings(['cod_advance' => 'all']);
        $entered = $this->postJson('/api/v1/web-orders', [
            'contact' => ['name' => 'Karim Uddin', 'phone' => '01812345678'],
            'lines' => [['variant_id' => $this->v['RICE'], 'quantity' => '1']],
            'address' => ['recipient_name' => 'Karim Uddin', 'phone' => '01812345678', 'division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA, 'area' => 'Mirpur', 'address_line' => 'House 9'],
            'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod', 'channel' => 'phone', 'expected_total' => '120.50',
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data');
        $this->assertSame(['confirmed', '0.00', null], [$entered['status'], $entered['advance_amount'], $entered['payment_due']]);
    }
}
