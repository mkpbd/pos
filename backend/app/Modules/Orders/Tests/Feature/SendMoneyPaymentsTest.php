<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderPaymentClaim;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Payments\Infrastructure\Models\Payment;
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
 * BD1c §1–§2: bKash / Nagad / Rocket "Send Money" payment methods and the shopper's payment
 * claims (sender number + TrxID) that staff confirm or reject.
 */
class SendMoneyPaymentsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const SHOP_BKASH = '01700000001';

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->staff();
        $this->putJson('/api/v1/payment-gateways/bkash_manual', [
            'is_enabled' => true, 'instructions' => 'Send Money, then type your TrxID.', 'settings' => ['account_number' => '+880 1700-000001'],
        ])->assertOk();
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * A guest's cart order of one Rice to Dhaka (120.50).
     *
     * @param  array<string, mixed>  $overrides  checkout body
     */
    private function shopOrder(string $payment = 'bkash_manual', array $overrides = [], string $host = self::HOST): TestResponse
    {
        $this->clearBrowser();
        $this->asVisitor();
        $this->addToCart('RICE', 1, $host);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => $payment], $host)->json('data.total');

        return $this->placeOrder($this->checkoutBody((string) $total, $overrides + ['payment_method' => $payment]), null, $host)->assertCreated();
    }

    private function idOf(string $number): string
    {
        return (string) Order::query()->withoutGlobalScopes()->where('organization_id', $this->tenant['organization']->id)->where('number', $number)->value('id');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function claim(string $number, array $body, ?string $key = null, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl("orders/{$number}/payment-claims", $host), $body + [
            'method' => 'bkash_manual', 'sender_phone' => '01912345678', 'transaction_id' => 'ABC123XYZ',
        ], ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function review(string $orderId, string $claimId, string $action, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$orderId}/payment-claims/{$claimId}/{$action}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    public function test_send_money_methods_are_configured_like_the_other_methods(): void
    {
        $methods = collect($this->getJson('/api/v1/payment-gateways')->assertOk()->json('data'))->keyBy('code');
        $this->assertSame(['display_name' => 'Nagad (Send Money)', 'is_enabled' => false, 'settings' => ['account_number' => null, 'account_type' => 'personal', 'hold_hours' => 24]],
            array_intersect_key($methods['nagad_manual'], array_flip(['display_name', 'is_enabled', 'settings'])));
        $this->assertSame('Rocket (Send Money)', $methods['rocket_manual']['display_name']);
        $this->assertSame(self::SHOP_BKASH, $methods['bkash_manual']['settings']['account_number']);

        $put = fn (array $body) => $this->putJson('/api/v1/payment-gateways/nagad_manual', $body);
        $put(['is_enabled' => true])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['settings.account_number']]]);
        $put(['settings' => ['account_number' => '12345']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['settings.account_number']]]);
        $put(['settings' => ['account_type' => 'boss']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['settings.account_type']]]);
        $put(['settings' => ['hold_hours' => 169]])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['settings.hold_hours']]]);
        $saved = $put([
            'is_enabled' => true, 'display_name' => 'Nagad', 'settings' => ['account_number' => '+880 1811-000002', 'account_type' => 'agent', 'hold_hours' => 6],
            'translations' => ['bn' => ['display_name' => 'নগদ']],
        ])->assertOk()->json('data');
        $this->assertSame([true, ['account_number' => '01811000002', 'account_type' => 'agent', 'hold_hours' => 6]], [$saved['is_enabled'], $saved['settings']]);
        // Switched on, the number cannot be cleared.
        $put(['settings' => ['account_number' => '']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['settings.account_number']]]);
        $this->assertTrue(AuditLog::query()->withoutGlobalScopes()->where('action', 'payment_gateway.updated')->get()
            ->contains(fn (AuditLog $a) => ($a->new_values['settings']['account_number'] ?? null) === '01811000002'));

        // Shoppers see the receiving number of the Send Money methods.
        $this->clearBrowser();
        $this->addToCart('RICE', 1);
        $options = collect($this->browse('GET', $this->storeUrl('checkout/options'))->assertOk()->json('data.payment_methods'))->keyBy('code');
        $this->assertSame(['cod', 'bank_transfer', 'bkash_manual', 'nagad_manual'], $options->keys()->all());
        $this->assertSame(['code' => 'bkash_manual', 'display_name' => 'bKash (Send Money)', 'account_number' => self::SHOP_BKASH, 'account_type' => 'personal', 'instructions' => 'Send Money, then type your TrxID.', 'instructions_preview' => null], $options['bkash_manual']);
        $this->assertArrayNotHasKey('account_number', $options['cod']);
        $this->browse('GET', $this->storeUrl('checkout/options?lang=bn'))->assertJsonPath('data.payment_methods.3.display_name', 'নগদ');
    }

    public function test_a_send_money_order_waits_for_the_payment_and_shows_what_is_due(): void
    {
        $this->travelTo(now()->startOfMinute());
        $placed = $this->shopOrder()->assertJsonPath('data.order.status', 'pending_payment')->assertJsonPath('data.order.payment_method', 'bkash_manual');
        $order = $placed->json('data.order');
        $this->assertSame(now()->addHours(24)->toIso8601String(), $order['expires_at']);
        $this->assertSame([
            'amount' => '120.50', 'currency' => $order['currency'], 'purpose' => 'full', 'expires_at' => $order['expires_at'],
            'methods' => [['code' => 'bkash_manual', 'display_name' => 'bKash (Send Money)', 'account_number' => self::SHOP_BKASH, 'account_type' => 'personal', 'instructions' => 'Send Money, then type your TrxID.']],
            'claim' => null,
        ], $order['payment_due']);

        $token = $placed->json('data.access_token');
        $this->browse('GET', $this->storeUrl("orders/{$order['number']}?token={$token}"))->assertOk()->assertJsonPath('data.payment_due.amount', '120.50');
        $this->browse('GET', $this->storeUrl("orders/track?number={$order['number']}&phone=01712345678"))->assertOk()->assertJsonPath('data.payment_due.purpose', 'full');

        // A method without its receiving number cannot be used; COD orders owe nothing by Send Money.
        $this->shopOrder('cod')->assertJsonPath('data.order.payment_due', null);
        $this->clearBrowser();
        $this->addToCart('RICE', 1);
        $this->placeOrder($this->checkoutBody('120.50', ['payment_method' => 'rocket_manual']))->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_METHOD_UNAVAILABLE');

        // Staff may enter Send Money orders too.
        $this->staff();
        $this->postJson('/api/v1/web-orders', [
            'contact' => ['name' => 'Karim Uddin', 'phone' => '01812345678'],
            'lines' => [['variant_id' => $this->v['RICE'], 'quantity' => '1']],
            'address' => ['recipient_name' => 'Karim Uddin', 'phone' => '01812345678', 'division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA, 'area' => 'Mirpur', 'address_line' => 'House 9'],
            'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'bkash_manual', 'channel' => 'phone', 'expected_total' => '120.50',
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.status', 'pending_payment')->assertJsonPath('data.payment_due.purpose', 'full');
    }

    public function test_the_claim_lifecycle(): void
    {
        Event::fake([OrderStatusChanged::class]);
        $placed = $this->shopOrder();
        $number = $placed->json('data.order.number');
        $token = $placed->json('data.access_token');
        $id = $this->idOf($number);
        $expires = $placed->json('data.order.expires_at');

        // Validation: the method must be offered for this payment, the TrxID letters and digits.
        $this->claim($number, ['token' => $token, 'method' => 'nagad_manual'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['method']]]);
        $this->claim($number, ['token' => $token, 'method' => 'cod'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['method']]]);
        $this->claim($number, ['token' => $token, 'transaction_id' => 'AB-12'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['transaction_id']]]);
        $this->claim($number, ['token' => $token, 'sender_phone' => '12345'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['sender_phone']]]);

        $key = (string) Str::uuid();
        $view = $this->claim($number, ['token' => $token, 'transaction_id' => ' 9ab c12def ', 'sender_phone' => '+880 1912-345678'], $key)
            ->assertCreated()->assertHeader('Cache-Control', 'no-store, private')->json('data');
        $this->assertSame('pending_payment', $view['status']);
        $this->assertSame(['bkash_manual', '9ABC12DEF', '01912345678', 'submitted', null], [
            $view['payment_due']['claim']['method'], $view['payment_due']['claim']['transaction_id'], $view['payment_due']['claim']['sender_phone'],
            $view['payment_due']['claim']['status'], $view['payment_due']['claim']['reject_reason'],
        ]);
        $this->claim($number, ['token' => $token, 'transaction_id' => ' 9ab c12def ', 'sender_phone' => '+880 1912-345678'], $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(1, OrderPaymentClaim::query()->withoutGlobalScopes()->count());
        // One claim at a time; a TrxID is used once (another order cannot reuse it).
        $this->claim($number, ['token' => $token, 'transaction_id' => 'OTHER1234'])->assertStatus(409)->assertJsonPath('error.code', 'PAYMENT_CLAIM_PENDING');
        $other = $this->shopOrder();
        $this->claim($other->json('data.order.number'), ['token' => $other->json('data.access_token'), 'transaction_id' => '9abc12def'])
            ->assertStatus(422)->assertJsonPath('error.code', 'TRANSACTION_ID_USED');

        // Staff see it on the board and the order.
        $this->staff();
        $board = $this->getJson('/api/v1/web-orders?payment_check=1')->assertOk();
        $this->assertSame([[$number, 'submitted']], array_map(fn ($r) => [$r['number'], $r['payment_claim_status']], $board->json('data')));
        $this->assertSame(1, $board->json('meta.status_counts.payment_check'));
        $this->assertNull(collect($this->getJson('/api/v1/web-orders')->json('data'))->firstWhere('number', $other->json('data.order.number'))['payment_claim_status']);
        $detail = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
        $this->assertContains('confirm_payment_claim', $detail['allowed_actions']);
        $this->assertSame('0.00', $detail['advance_amount']);
        $this->assertSame('120.50', $detail['payment_due']['amount']);
        $claim = $detail['payment_claims'][0];
        $this->assertSame(['bkash_manual', 'full', '120.50', '01912345678', '9ABC12DEF', 'submitted', null, null], [
            $claim['method'], $claim['purpose'], $claim['amount'], $claim['sender_phone'], $claim['transaction_id'], $claim['status'], $claim['reviewed_by'], $claim['reviewed_at'],
        ]);

        // Reject: a reason is needed; the order keeps waiting with the same expiry.
        $this->review($id, $claim['id'], 'reject')->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reason']]]);
        $rejected = $this->review($id, $claim['id'], 'reject', ['reason' => 'No such payment in our bKash'])->assertOk()->json('data');
        $this->assertSame(['pending_payment', $expires, 'rejected', 'No such payment in our bKash', $this->tenant['admin']->id], [
            $rejected['status'], $rejected['expires_at'], $rejected['payment_claims'][0]['status'], $rejected['payment_claims'][0]['reject_reason'], $rejected['payment_claims'][0]['reviewed_by']['id'],
        ]);
        $this->assertNotContains('confirm_payment_claim', $rejected['allowed_actions']);
        $this->review($id, $claim['id'], 'confirm')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.payment_claim_rejected')->count());

        // The shopper sees the reason and may try again — a rejected TrxID can be sent again.
        $this->clearBrowser();
        $this->browse('GET', $this->storeUrl("orders/{$number}?token={$token}"))->assertJsonPath('data.payment_due.claim.status', 'rejected')
            ->assertJsonPath('data.payment_due.claim.reject_reason', 'No such payment in our bKash');
        $this->claim($number, ['token' => $token, 'transaction_id' => '9ABC12DEF'])->assertCreated()->assertJsonPath('data.payment_due.claim.status', 'submitted');

        // Confirm: paid, confirmed, ledger entry (mobile banking, no drawer), history, audit, event.
        $this->staff();
        $second = $this->getJson("/api/v1/web-orders/{$id}")->json('data.payment_claims.0.id');
        $confirmKey = (string) Str::uuid();
        $confirmed = $this->review($id, $second, 'confirm', [], $confirmKey)->assertOk()->json('data');
        $this->assertSame(['confirmed', 'paid', 'Paid', '120.50', null, null], [
            $confirmed['status'], $confirmed['payment_status'], $confirmed['payment_status_label'], $confirmed['paid_total'], $confirmed['expires_at'], $confirmed['payment_due'],
        ]);
        $this->assertNotNull($confirmed['confirmed_at']);
        $this->assertSame(['confirmed', 'rejected'], array_column($confirmed['payment_claims'], 'status'));
        $this->assertSame(['mobile_banking', '120.50', 'bKash TrxID 9ABC12DEF from 01912345678'], [$confirmed['payments'][0]['method'], $confirmed['payments'][0]['amount'], $confirmed['payments'][0]['reference']]);
        $this->assertSame('Payment confirmed (bKash TrxID 9ABC12DEF)', $confirmed['history'][1]['note']);
        $this->assertNotContains('confirm_payment_claim', $confirmed['allowed_actions']);
        $this->review($id, $second, 'confirm', [], $confirmKey)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->review($id, $second, 'confirm')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');

        $ledger = Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order')->where('source_id', $id)->get();
        $this->assertCount(1, $ledger);
        $this->assertNull($ledger[0]->cash_register_session_id);
        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.payment_claim_confirmed')->sole();
        $this->assertSame(['pending_payment', 'unpaid'], [$audit->old_values['status'], $audit->old_values['payment_status']]);
        $this->assertSame(['confirmed', 'paid', '120.50'], [$audit->new_values['status'], $audit->new_values['payment_status'], $audit->new_values['amount']]);
        Event::assertDispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => $e->orderId === $id && $e->from === 'pending_payment' && $e->to === 'confirmed');

        // Nothing is due any more.
        $this->clearBrowser();
        $this->claim($number, ['token' => $token, 'transaction_id' => 'LATE12345'])->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_NOT_DUE');
        // A confirmed TrxID stays used.
        $this->claim($other->json('data.order.number'), ['token' => $other->json('data.access_token'), 'transaction_id' => '9ABC12DEF'])->assertStatus(422)->assertJsonPath('error.code', 'TRANSACTION_ID_USED');
    }

    public function test_who_may_report_a_payment(): void
    {
        $placed = $this->shopOrder();
        $number = $placed->json('data.order.number');

        // No token, a wrong token or a wrong phone: the same 404; another store does not know the order.
        $this->claim($number, [])->assertNotFound()->assertJsonPath('error.code', 'ORDER_NOT_FOUND');
        $this->claim($number, ['token' => 'wrong-token'])->assertNotFound()->assertJsonPath('error.code', 'ORDER_NOT_FOUND');
        $this->claim($number, ['phone' => '01899999999'])->assertNotFound()->assertJsonPath('error.code', 'ORDER_NOT_FOUND');
        $this->claim('WEB-999999', ['token' => $placed->json('data.access_token')])->assertNotFound()->assertJsonPath('error.code', 'ORDER_NOT_FOUND');
        $this->openStore('Other Shop', 'other.example.test');
        $this->asVisitor();
        $this->claim($number, ['token' => $placed->json('data.access_token')], null, 'other.example.test')->assertNotFound();
        // An Idempotency-Key is required.
        $this->browse('POST', $this->storeUrl("orders/{$number}/payment-claims"), ['method' => 'bkash_manual', 'sender_phone' => '01912345678', 'transaction_id' => 'ABC123'])->assertStatus(428);

        // From the track page, with the order's mobile number: the track view comes back (no name or address).
        $tracked = $this->claim($number, ['phone' => '+880 1712-345678', 'transaction_id' => 'TRACK1234'])->assertCreated()->json('data');
        $this->assertArrayNotHasKey('contact', $tracked);
        $this->assertSame('submitted', $tracked['payment_due']['claim']['status']);

        // The signed-in owner needs no token.
        $this->clearBrowser();
        $this->registerShopper(self::HOST);
        $this->addToCart('RICE', 1);
        $mine = $this->placeOrder($this->checkoutBody('120.50', ['payment_method' => 'bkash_manual']))->assertCreated()->json('data.order.number');
        $this->claim($mine, ['transaction_id' => 'OWNER1234'])->assertCreated()->assertJsonPath('data.number', $mine)->assertJsonPath('data.contact.phone', '01712345678');
        $this->browse('GET', $this->storeUrl("account/orders/{$mine}"))->assertOk()->assertJsonPath('data.payment_due.claim.transaction_id', 'OWNER1234');
        // …but not someone else's order.
        $this->claim($number, ['transaction_id' => 'OWNER5678'])->assertNotFound();
    }

    public function test_a_waiting_claim_holds_the_order_until_staff_decide(): void
    {
        $placed = $this->shopOrder();
        $number = $placed->json('data.order.number');
        $token = $placed->json('data.access_token');
        $unclaimed = $this->idOf($this->shopOrder()->json('data.order.number'));
        $this->claim($number, ['token' => $token])->assertCreated();
        $id = $this->idOf($number);

        $this->travel(25)->hours();
        $this->artisan('orders:expire-pending')->expectsOutputToContain('Cancelled 1 expired order(s).');
        $this->assertSame('cancelled', Order::query()->withoutGlobalScopes()->findOrFail($unclaimed)->status->value);
        $this->assertSame('pending_payment', Order::query()->withoutGlobalScopes()->findOrFail($id)->status->value);
        // The shopper still sees the claim being checked.
        $this->clearBrowser();
        $this->browse('GET', $this->storeUrl("orders/{$number}?token={$token}"))->assertJsonPath('data.payment_due.claim.status', 'submitted');
        // An expired order without a claim takes none.
        $this->claim($this->shopOrder()->json('data.order.number'), [])->assertNotFound();

        // Staff may still confirm the claim sent in time; a rejection lets the job cancel the order.
        $this->staff();
        $claimId = $this->getJson("/api/v1/web-orders/{$id}")->json('data.payment_claims.0.id');
        $this->review($id, $claimId, 'reject', ['reason' => 'Not received'])->assertOk()->assertJsonPath('data.payment_due', null);
        $this->clearBrowser();
        $this->claim($number, ['token' => $token, 'transaction_id' => 'LATE12345'])->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_NOT_DUE');
        $this->artisan('orders:expire-pending')->expectsOutputToContain('Cancelled 1 expired order(s).');
        $this->assertSame('cancelled', Order::query()->withoutGlobalScopes()->findOrFail($id)->status->value);
    }

    public function test_a_claim_on_a_cancelled_order_can_only_be_rejected(): void
    {
        $placed = $this->shopOrder();
        $number = $placed->json('data.order.number');
        $this->claim($number, ['token' => $placed->json('data.access_token')])->assertCreated();
        $id = $this->idOf($number);
        $this->staff();
        $this->postJson("/api/v1/web-orders/{$id}/cancel", ['reason' => 'Out of rice'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $claimId = $this->getJson("/api/v1/web-orders/{$id}")->json('data.payment_claims.0.id');
        $this->review($id, $claimId, 'confirm')->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_NOT_DUE');
        $this->review($id, $claimId, 'reject', ['reason' => 'Order cancelled; money sent back'])->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    public function test_staff_may_confirm_a_send_money_order_with_a_reference(): void
    {
        $id = $this->idOf($this->shopOrder()->json('data.order.number'));
        $this->staff();
        $this->assertContains('confirm_payment', $this->getJson("/api/v1/web-orders/{$id}")->json('data.allowed_actions'));
        $paid = $this->postJson("/api/v1/web-orders/{$id}/confirm-payment", ['reference' => 'TRX-77'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk()->json('data');
        $this->assertSame(['confirmed', 'paid', 'mobile_banking', '120.50', 'TRX-77'], [$paid['status'], $paid['payment_status'], $paid['payments'][0]['method'], $paid['payments'][0]['amount'], $paid['payments'][0]['reference']]);
    }

    public function test_a_waiting_claim_is_decided_on_its_own_not_by_a_reference(): void
    {
        $placed = $this->shopOrder();
        $number = $placed->json('data.order.number');
        $this->claim($number, ['token' => $placed->json('data.access_token')])->assertCreated();
        $id = $this->idOf($number);
        $this->staff();
        $actions = $this->getJson("/api/v1/web-orders/{$id}")->json('data.allowed_actions');
        $this->assertContains('confirm_payment_claim', $actions);
        $this->assertNotContains('confirm_payment', $actions);
        $this->postJson("/api/v1/web-orders/{$id}/confirm-payment", ['reference' => 'TRX-78'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertStatus(409)->assertJsonPath('error.code', 'PAYMENT_CLAIM_PENDING');
        $this->assertSame('pending_payment', $this->getJson("/api/v1/web-orders/{$id}")->json('data.status'));
    }

    public function test_claims_are_isolated_and_need_the_permission(): void
    {
        $placed = $this->shopOrder();
        $number = $placed->json('data.order.number');
        $this->claim($number, ['token' => $placed->json('data.access_token')])->assertCreated();
        $id = $this->idOf($number);
        $claimId = (string) OrderPaymentClaim::query()->withoutGlobalScopes()->value('id');

        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->clearBrowser();
        $this->actingAsUser($cashier);
        $this->review($id, $claimId, 'confirm')->assertForbidden();
        $this->review($id, $claimId, 'reject', ['reason' => 'x'])->assertForbidden();
        $this->actingAsUser($manager);
        $this->postJson("/api/v1/web-orders/{$id}/payment-claims/{$claimId}/confirm")->assertStatus(428);
        $this->review($id, (string) Str::uuid(), 'confirm')->assertNotFound();

        // Another organization sees neither the order nor the claim; the TrxID is free there.
        $other = $this->openStore('Other Shop', 'other.example.test');
        $this->review($id, $claimId, 'confirm')->assertNotFound();
        $this->getJson('/api/v1/web-orders?payment_check=1')->assertOk()->assertJsonPath('meta.status_counts.payment_check', 0);
        $this->inTenant($other['organization'], fn () => $this->assertSame(0, OrderPaymentClaim::query()->count()));

        $this->actingAsUser($manager);
        $this->review($id, $claimId, 'confirm')->assertOk()->assertJsonPath('data.payment_status', 'paid');
        $this->assertSame(1, DB::table('order_payment_claims')->where('status', 'confirmed')->count());
    }
}
