<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Notifications\OrderCancelledWithRefundEmail;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Tests\Concerns\InteractsWithRegisters;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * E11: staff cancel paid, undelivered web orders with a full refund through the E10b refund
 * path — every refund method, register-session rules, REFUND_REQUIRED, permissions,
 * idempotent replays, the exact restock happening once, the ledger and the e-mail.
 * Shop from BuildsCheckout: Pills 100 batch-tracked (EARLY 2 at 10, LATE 5 at 12), delivery 60.
 */
class PaidOrderCancellationTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithRegisters, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * A guest bank-transfer order of 3 pills (360.00), confirmed as paid by the admin.
     */
    private function paidOrder(string $to = 'confirmed'): string
    {
        $this->clearBrowser();
        $this->addToCart('PILLS', 3);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'bank_transfer'])->json('data.total');
        $number = $this->placeOrder($this->checkoutBody($total, ['payment_method' => 'bank_transfer']))->assertCreated()->json('data.order.number');
        $id = Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');

        $this->staff();
        $this->act($id, 'confirm-payment', ['reference' => 'TXN-1'])->assertOk();
        if ($to !== 'confirmed') {
            $this->act($id, 'process')->assertOk();
        }
        if (in_array($to, ['shipped', 'returned', 'delivered'], true)) {
            $courier = $this->inTenant($this->tenant['organization'], fn () => Courier::query()->firstOrCreate(['name' => 'Pathao'])->id);
            $this->act($id, 'ship', ['courier_id' => $courier])->assertOk();
        }
        if ($to === 'returned') {
            $this->act($id, 'shipment/events', ['status' => 'returned'])->assertOk();
        }
        if ($to === 'delivered') {
            $this->act($id, 'deliver')->assertOk();
        }

        return $id;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function staff(?User $user = null): void
    {
        $this->clearBrowser();
        $this->actingAsUser($user ?? $this->tenant['admin']);
    }

    /**
     * @param  list<string>  $permissions
     */
    private function userWith(array $permissions): User
    {
        $this->staff();
        $role = $this->postJson('/api/v1/roles', ['name' => 'Role '.Str::random(6), 'permissions' => $permissions])->assertCreated()->json('data.id');

        return $this->createUserWithRole($this->tenant['organization'], Role::query()->withoutGlobalScopes()->findOrFail($role), [$this->tenant['store']->branch_id]);
    }

    /**
     * @return array<string, string> batch => quantity
     */
    private function pillLevels(): array
    {
        return StockLevel::query()->withoutGlobalScopes()
            ->leftJoin('batches', 'batches.id', '=', 'stock_levels.batch_id')
            ->where('stock_levels.variant_id', $this->v['PILLS'])
            ->orderBy('batches.batch_number')
            ->pluck('stock_levels.quantity', 'batches.batch_number')
            ->map(fn ($q) => (string) $q)->all();
    }

    private function refunds(): int
    {
        return Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->count();
    }

    public function test_a_paid_order_is_cancelled_with_a_bank_transfer_refund_once_and_restocked_exactly(): void
    {
        $id = $this->paidOrder();
        $this->assertSame(['EARLY' => '0.000', 'LATE' => '4.000'], $this->pillLevels());

        $view = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
        $this->assertSame(['process', 'cancel'], $view['allowed_actions']);
        $this->assertSame('360.00', $view['cancel_refund_amount']);

        $this->act($id, 'cancel', ['reason' => 'Out of stock'])->assertUnprocessable()
            ->assertJsonPath('error.code', 'REFUND_REQUIRED')->assertJsonPath('error.details.refund_amount', '360.00');
        $this->act($id, 'cancel', ['reason' => 'Out of stock', 'refund' => ['method' => 'card']])->assertUnprocessable()->assertJsonValidationErrors('refund.method', 'error.details');
        $this->act($id, 'cancel', ['reason' => 'Out of stock', 'refund' => ['reference' => 'x']])->assertUnprocessable()->assertJsonValidationErrors('refund.method', 'error.details');
        $this->assertSame(0, $this->refunds());

        $key = (string) Str::uuid();
        $body = ['reason' => 'Out of stock', 'refund' => ['method' => 'bank_transfer', 'reference' => 'RF-9']];
        $cancelled = $this->act($id, 'cancel', $body, $key)->assertOk()->json('data');
        $this->assertSame(['cancelled', 'refunded', '360.00', '360.00', 'Out of stock', [], null], [
            $cancelled['status'], $cancelled['payment_status'], $cancelled['paid_total'], $cancelled['refunded_total'], $cancelled['cancel_reason'], $cancelled['allowed_actions'], $cancelled['cancel_refund_amount'],
        ]);
        $refund = collect($cancelled['payments'])->firstWhere('direction', 'out');
        $this->assertSame(['bank_transfer', '360.00', 'RF-9'], [$refund['method'], $refund['amount'], $refund['reference']]);
        $this->assertSame(['confirmed', 'cancelled'], array_slice(array_column($cancelled['history'], 'status'), -2));
        $this->assertSame(['EARLY' => '2.000', 'LATE' => '5.000'], $this->pillLevels());

        $payment = Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->sole();
        $this->assertSame([$id, 'out', '360.00', null], [$payment->source_id, $payment->direction->value, (string) $payment->amount, $payment->cash_register_session_id]);

        // The same request replays; a new one finds the order cancelled. Nothing happens twice.
        $this->act($id, 'cancel', $body, $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->act($id, 'cancel', $body)->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame(1, $this->refunds());
        $this->assertSame(2, StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count());
        $this->assertSame(['EARLY' => '2.000', 'LATE' => '5.000'], $this->pillLevels());

        $audit = AuditLog::query()->withoutGlobalScopes()->where('subject_id', $id)->whereIn('action', ['web_order.cancelled', 'web_order.refunded'])->pluck('action')->all();
        $this->assertEqualsCanonicalizing(['web_order.cancelled', 'web_order.refunded'], $audit);

        Notification::assertSentOnDemand(OrderCancelledWithRefundEmail::class, function (OrderCancelledWithRefundEmail $mail, array $channels, AnonymousNotifiable $notifiable) {
            // Rendering the mail catches payload keys the template reads but the order view lacks.
            $rendered = implode(' ', $mail->toMail($notifiable)->introLines);

            return $mail->refundAmount === '360.00' && $mail->methodLabel !== '' && $notifiable->routes['mail'] === 'rina@example.test'
                && str_contains($rendered, 'We refunded 360.00');
        });
        Notification::assertSentOnDemandTimes(OrderCancelledWithRefundEmail::class, 1);
    }

    public function test_cash_refunds_need_the_users_open_register_session_with_enough_cash(): void
    {
        $id = $this->paidOrder('processing');
        $body = ['reason' => 'Customer asked', 'refund' => ['method' => 'cash']];

        $this->act($id, 'cancel', $body)->assertUnprocessable()->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $session = $this->openSession($this->tenant['admin'], $this->tenant['store']->branch_id, '100.00');
        $this->act($id, 'cancel', $body)->assertUnprocessable()->assertJsonPath('error.code', 'INSUFFICIENT_CASH');

        // Nothing changed after the refusals.
        $order = Order::query()->withoutGlobalScopes()->findOrFail($id);
        $this->assertSame(['processing', 'paid'], [$order->status->value, $order->payment_status->value]);
        $this->assertSame(['EARLY' => '0.000', 'LATE' => '4.000'], $this->pillLevels());
        $this->assertSame(0, $this->refunds());

        // Another refunder with enough cash in their own drawer.
        $refunder = $this->userWith(['web_orders.view', 'web_orders.refund']);
        $session = $this->openSession($refunder, $this->tenant['store']->branch_id, '1000.00');
        $this->staff($refunder);
        $this->act($id, 'cancel', $body)->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.payment_status', 'refunded');
        $payment = Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->sole();
        $this->assertSame(['cash', 'out', '360.00', $session->id], [$payment->method->value, $payment->direction->value, (string) $payment->amount, $payment->cash_register_session_id]);
        $this->assertSame(['EARLY' => '2.000', 'LATE' => '5.000'], $this->pillLevels());
    }

    public function test_mobile_banking_refund_of_a_parcel_returned_to_the_sender_and_delivered_orders_are_refused(): void
    {
        $returned = $this->paidOrder('returned');
        $this->assertContains('cancel', $this->getJson("/api/v1/web-orders/{$returned}")->json('data.allowed_actions'));
        $this->act($returned, 'cancel', ['reason' => 'Refused at the door', 'refund' => ['method' => 'mobile_banking', 'reference' => 'BK-1']])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.refunded_total', '360.00');
        $this->assertSame('mobile_banking', Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->sole()->method->value);

        $delivered = $this->paidOrder('delivered');
        $view = $this->getJson("/api/v1/web-orders/{$delivered}")->json('data');
        $this->assertNotContains('cancel', $view['allowed_actions']);
        $this->assertNull($view['cancel_refund_amount']);
        $this->act($delivered, 'cancel', ['reason' => 'Late', 'refund' => ['method' => 'bank_transfer']])->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame(1, $this->refunds());
    }

    public function test_paid_cancellation_needs_web_orders_refund_and_unpaid_cancellation_web_orders_manage(): void
    {
        $paid = $this->paidOrder();
        $manager = $this->userWith(['web_orders.view', 'web_orders.manage']);
        $refunder = $this->userWith(['web_orders.view', 'web_orders.refund']);
        $viewer = $this->userWith(['web_orders.view']);
        $body = ['reason' => 'Cancel', 'refund' => ['method' => 'bank_transfer']];

        $this->staff($viewer);
        $this->act($paid, 'cancel', $body)->assertForbidden();

        $this->staff($manager);
        $this->assertSame(['process'], $this->getJson("/api/v1/web-orders/{$paid}")->json('data.allowed_actions'));
        $this->act($paid, 'cancel', $body)->assertForbidden();
        $this->act($paid, 'cancel', ['reason' => 'Cancel'])->assertForbidden();

        $this->staff($refunder);
        $this->assertSame(['cancel'], $this->getJson("/api/v1/web-orders/{$paid}")->json('data.allowed_actions'));
        $this->act($paid, 'cancel', ['reason' => 'Cancel'])->assertUnprocessable()->assertJsonPath('error.code', 'REFUND_REQUIRED');
        $this->act($paid, 'cancel', $body)->assertOk()->assertJsonPath('data.payment_status', 'refunded');

        // Unpaid orders keep the E8a rules: web_orders.manage, no refund.
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data.total');
        $number = $this->placeOrder($this->checkoutBody($total))->assertCreated()->json('data.order.number');
        $unpaid = Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');

        $this->staff($refunder);
        $this->act($unpaid, 'cancel', $body)->assertForbidden();
        $this->staff($manager);
        $this->act($unpaid, 'cancel', $body)->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.payment_status', 'unpaid');
        $this->assertSame(1, $this->refunds());
        Notification::assertSentOnDemandTimes(OrderCancelledWithRefundEmail::class, 1);
    }
}
