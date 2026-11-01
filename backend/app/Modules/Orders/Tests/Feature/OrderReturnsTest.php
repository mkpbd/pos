<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Infrastructure\Models\OrderLineStock;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Infrastructure\Models\OrderReturnLineStock;
use App\Modules\Orders\Infrastructure\Notifications\OrderReturnRequestedNotification;
use App\Modules\Orders\Infrastructure\Notifications\OrderReturnStatusEmail;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Tests\Concerns\InteractsWithRegisters;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * E10b: online returns and refunds — customer requests, staff approval, receipt with
 * restock to the original batches, refunds through the ledger, rules, idempotency,
 * permissions and isolation. Shop from BuildsCheckout: Juice 120 + VAT 15% (10 in stock),
 * Pills 100 batch-tracked (EARLY 2 at 10, LATE 5 at 12), delivery inside Dhaka 60.
 */
class OrderReturnsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithRegisters, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * A delivered order of the signed-in shopper; paid (COD recorded) unless $paid is false.
     *
     * @param  array<string, int>  $items
     */
    private function deliveredOrder(array $items, bool $paid = true): string
    {
        $number = $this->customerOrder($items);
        $this->advance($number, 'delivered');
        if ($paid) {
            $admin = (string) $this->tenant['admin']->id;
            $this->inTenant($this->tenant['organization'], fn () => app(OrderWorkflow::class)->recordCodPayment($this->orderModel($number), 'COD-1', $admin));
        }

        return $number;
    }

    /**
     * @return array<string, string> order line ids by SKU
     */
    private function lineIds(string $number): array
    {
        return collect($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines'))->pluck('id', 'sku')->all();
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function requestReturn(string $number, array $body, ?string $key = null, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl("account/orders/{$number}/returns", $host), $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function step(string $returnId, string $action, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/web-order-returns/{$returnId}/{$action}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    private function returnId(string $number): string
    {
        return (string) $this->inTenant($this->tenant['organization'], fn () => OrderReturn::query()->where('number', $number)->value('id'));
    }

    private function stockOf(string $sku): string
    {
        $levels = StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v[$sku])->pluck('quantity')->all();

        return number_format(array_sum(array_map('floatval', $levels)), 3, '.', '');
    }

    public function test_full_return_lifecycle_restocks_original_batches_and_refunds_through_the_ledger(): void
    {
        $this->registerShopper(self::HOST);
        $number = $this->deliveredOrder(['JUICE' => 3, 'PILLS' => 3]);
        $this->assertSame(['7.000', '4.000'], [$this->stockOf('JUICE'), $this->stockOf('PILLS')]);
        $order = $this->orderModel($number);
        $this->assertSame(['774.00', '774.00'], [(string) $order->total, (string) $order->paid_total]);

        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->assertOk()->json('data');
        $this->assertTrue($view['returnable']);
        $this->assertNull($view['return_unavailable_reason']);
        $this->assertSame($order->delivered_at->addDays(7)->toIso8601String(), $view['return_deadline']);
        $this->assertSame(['3', '3'], array_column($view['lines'], 'returnable_quantity'));
        $this->assertSame([], $view['returns']);
        $lines = $this->lineIds($number);

        // The customer asks to return 1 juice and 3 pills (idempotent).
        $key = (string) Str::uuid();
        $body = ['reason_code' => 'damaged', 'note' => ' Box was crushed ', 'lines' => [
            ['order_line_id' => $lines['JUICE'], 'quantity' => 1],
            ['order_line_id' => $lines['PILLS'], 'quantity' => 3],
        ]];
        $created = $this->requestReturn($number, $body, $key)->assertCreated()->json('data');
        $this->assertSame(['RTN-WEB-000001', $number, ['number' => $number], 'requested', 'damaged', 'Box was crushed', '438.00', true], [
            $created['number'], $created['order_number'], $created['order'], $created['status'], $created['reason_code'], $created['note'], $created['refund_amount'], $created['can_cancel'],
        ]);
        $this->assertSame([['JUICE', '1', '138.00'], ['PILLS', '3', '300.00']], array_map(fn ($l) => [$l['sku'], $l['quantity'], $l['amount']], $created['lines']));
        $this->assertSame($lines['JUICE'], $created['lines'][0]['order_line_id']);
        $this->requestReturn($number, $body, $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.number', 'RTN-WEB-000001');
        $this->requestReturn($number, ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 3]]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'QUANTITY_EXCEEDS_RETURNABLE')
            ->assertJsonPath('error.details.lines.0.returnable', '2')->assertJsonPath('error.details.lines.0.requested', '3');

        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data');
        $this->assertSame(['2', '0'], array_column($view['lines'], 'returnable_quantity'));
        $this->assertSame([['RTN-WEB-000001', 'requested']], array_map(fn ($r) => [$r['number'], $r['status']], $view['returns']));
        $this->assertSame(1, $this->browse('GET', $this->storeUrl('account/returns'))->assertOk()->json('meta.pagination.total'));
        Notification::assertSentTo($this->tenant['admin'], OrderReturnRequestedNotification::class, fn ($n) => $n->payload['number'] === 'RTN-WEB-000001');

        // Staff approve 2 pills instead of 3 with the delivery fee refunded.
        $this->staff();
        $id = $created['id'] ?? $this->returnId('RTN-WEB-000001');
        $detail = $this->getJson("/api/v1/web-order-returns/{$id}")->assertOk()->json('data');
        $this->assertSame(['approve', 'reject'], $detail['allowed_actions']);
        $this->assertSame('Rina Akter', $detail['customer_name']);
        $this->step($id, 'approve', ['shipping_refund' => '60.01'])->assertUnprocessable()->assertJsonValidationErrors('shipping_refund', 'error.details');
        $this->step($id, 'approve', ['lines' => [['order_line_id' => $lines['PILLS'], 'quantity' => 4]]])->assertUnprocessable();
        $approveKey = (string) Str::uuid();
        $approved = $this->step($id, 'approve', ['lines' => [['order_line_id' => $lines['PILLS'], 'quantity' => 2]], 'shipping_refund' => '60', 'note' => 'One strip unopened'], $approveKey)->assertOk()->json('data');
        $this->assertSame(['approved', '338.00', '60.00', '398.00', ['receive']], [$approved['status'], $approved['items_amount'], $approved['shipping_refund'], $approved['refund_amount'], $approved['allowed_actions']]);
        $this->assertSame([['1', '1', '138.00'], ['2', '3', '200.00']], array_map(fn ($l) => [$l['quantity'], $l['requested_quantity'], $l['amount']], $approved['lines']));
        $this->step($id, 'approve', ['lines' => [['order_line_id' => $lines['PILLS'], 'quantity' => 2]], 'shipping_refund' => '60', 'note' => 'One strip unopened'], $approveKey)
            ->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->step($id, 'approve')->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->step($id, 'refund', ['method' => 'bank_transfer'])->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');

        // Received: both lines back on the shelf, to the batches they left from, at their cost.
        $received = $this->step($id, 'receive', ['lines' => [['order_line_id' => $lines['JUICE'], 'restock' => true], ['order_line_id' => $lines['PILLS'], 'restock' => true]]])->assertOk()->json('data');
        $this->assertSame([[true, '1'], [true, '2']], array_map(fn ($l) => [$l['restock'], $l['restocked_quantity']], $received['lines']));
        $this->assertSame(['8.000', '6.000'], [$this->stockOf('JUICE'), $this->stockOf('PILLS')]);
        $back = OrderReturnLineStock::query()->withoutGlobalScopes()->get();
        $this->assertSame('3.000', number_format($back->sum(fn ($b) => (float) $b->quantity), 3, '.', ''));
        foreach ($back as $record) {
            $allocation = OrderLineStock::query()->withoutGlobalScopes()->findOrFail($record->order_line_stock_id);
            $this->assertSame([$allocation->batch_id, (string) $allocation->unit_cost], [$record->batch_id, (string) $record->unit_cost]);
            $this->assertLessThanOrEqual((float) $allocation->quantity, (float) $record->quantity);
            $movement = StockMovement::query()->withoutGlobalScopes()->findOrFail($record->movement_id);
            $this->assertSame('online_return', $movement->type->value);
        }
        $pillBatches = $back->filter(fn ($b) => $b->batch_id !== null);
        $this->assertSame(2, (int) $pillBatches->sum(fn ($b) => (float) $b->quantity));

        // Refunded by bank transfer: ledger out, order partially refunded, status unchanged.
        $refundKey = (string) Str::uuid();
        $refunded = $this->step($id, 'refund', ['method' => 'bank_transfer', 'reference' => 'TXN-9'], $refundKey)->assertOk()->json('data');
        $this->assertSame(['refunded', 'bank_transfer', 'TXN-9', 'partially_refunded', '398.00'], [
            $refunded['status'], $refunded['refund_method'], $refunded['refund_reference'], $refunded['order']['payment_status'], $refunded['order']['refunded_total'],
        ]);
        $this->assertSame([['out', 'bank_transfer', '398.00']], array_map(fn ($p) => [$p['direction'], $p['method'], $p['amount']], $refunded['payments']));
        $this->step($id, 'refund', ['method' => 'bank_transfer', 'reference' => 'TXN-9'], $refundKey)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(1, Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->count());
        $this->assertSame(['delivered', 'partially_refunded', '398.00'], [$this->orderModel($number)->status->value, $this->orderModel($number)->payment_status->value, (string) $this->orderModel($number)->refunded_total]);
        Notification::assertSentOnDemandTimes(OrderReturnStatusEmail::class, 2);

        $order = $this->getJson("/api/v1/web-orders/{$this->orderModel($number)->id}")->assertOk()->json('data');
        $this->assertSame([['RTN-WEB-000001', 'refunded', '398.00']], array_map(fn ($r) => [$r['number'], $r['status'], $r['refund_amount']], $order['returns']));
        $this->assertContains('create_return', $order['allowed_actions']);
        $this->assertSame(['in', 'out'], array_column($order['payments'], 'direction'));
        $this->assertSame(['2', '1'], array_column($order['lines'], 'returnable_quantity'));

        // A second, staff-created return takes the rest: exact remainders, juice written off.
        $second = $this->postJson("/api/v1/web-orders/{$order['id']}/returns", ['reason_code' => 'changed_mind', 'lines' => [
            ['order_line_id' => $lines['JUICE'], 'quantity' => 2], ['order_line_id' => $lines['PILLS'], 'quantity' => 1],
        ]], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data');
        $this->assertSame(['requested', 'staff', '376.00'], [$second['status'], $second['requested_by'], $second['refund_amount']]);
        $this->assertSame(['276.00', '100.00'], array_column($second['lines'], 'amount'));
        $this->step($second['id'], 'approve', ['shipping_refund' => '0.01'])->assertUnprocessable()->assertJsonValidationErrors('shipping_refund', 'error.details');
        $this->step($second['id'], 'approve')->assertOk();
        $this->step($second['id'], 'receive', ['lines' => [['order_line_id' => $lines['JUICE'], 'restock' => false]]])->assertOk()
            ->assertJsonPath('data.lines.0.restock', false)->assertJsonPath('data.lines.0.restocked_quantity', '0');
        $this->assertSame(['8.000', '7.000'], [$this->stockOf('JUICE'), $this->stockOf('PILLS')]);
        $done = $this->step($second['id'], 'refund', ['method' => 'mobile_banking'])->assertOk()->json('data');
        $this->assertSame(['refunded', '774.00'], [$done['order']['payment_status'], $done['order']['refunded_total']]);
        $this->assertSame('-774.00', number_format(-Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->get()->sum(fn ($p) => (float) $p->amount), 2, '.', ''));

        // Nothing left: no more returns, from either side.
        $this->assertNotContains('create_return', $this->getJson("/api/v1/web-orders/{$order['id']}")->json('data.allowed_actions'));
        $this->clearBrowser();
        $this->signIn('shopper@example.test');
        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data');
        $this->assertSame([false, 'nothing_left', 'refunded'], [$view['returnable'], $view['return_unavailable_reason'], $view['payment_status']]);
        $this->assertSame(2, $this->browse('GET', $this->storeUrl('account/returns'))->json('meta.pagination.total'));
    }

    public function test_return_rules_window_override_reject_and_customer_cancel(): void
    {
        $this->registerShopper(self::HOST);
        // Not delivered, not paid.
        $open = $this->customerOrder(['JUICE' => 1]);
        $lines = $this->lineIds($open);
        $this->requestReturn($open, ['reason_code' => 'other', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'RETURN_NOT_ALLOWED')->assertJsonPath('error.details.reason', 'not_delivered');
        $unpaid = $this->deliveredOrder(['JUICE' => 1], paid: false);
        $unpaidLines = $this->lineIds($unpaid);
        $this->assertSame([false, 'not_paid', '0'], [
            $this->browse('GET', $this->storeUrl("account/orders/{$unpaid}"))->json('data.returnable'),
            $this->browse('GET', $this->storeUrl("account/orders/{$unpaid}"))->json('data.return_unavailable_reason'),
            $this->browse('GET', $this->storeUrl("account/orders/{$unpaid}"))->json('data.lines.0.returnable_quantity'),
        ]);
        $this->requestReturn($unpaid, ['reason_code' => 'other', 'lines' => [['order_line_id' => $unpaidLines['JUICE'], 'quantity' => 1]]])
            ->assertUnprocessable()->assertJsonPath('error.details.reason', 'not_paid');

        $number = $this->deliveredOrder(['JUICE' => 2]);
        $lines = $this->lineIds($number);
        // Validation: unknown line, decimals of whole units, repeated line, reason.
        $this->requestReturn($number, ['reason_code' => 'other', 'lines' => [['order_line_id' => $unpaidLines['JUICE'], 'quantity' => 1]]])->assertUnprocessable()->assertJsonValidationErrors('lines.0.order_line_id', 'error.details');
        $this->requestReturn($number, ['reason_code' => 'other', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 0.5]]])->assertUnprocessable()->assertJsonValidationErrors('lines.0.quantity', 'error.details');
        $this->requestReturn($number, ['reason_code' => 'other', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1], ['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertUnprocessable();
        $this->requestReturn($number, ['reason_code' => 'bored', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertUnprocessable()->assertJsonValidationErrors('reason_code', 'error.details');
        $this->browse('POST', $this->storeUrl("account/orders/{$number}/returns"), ['reason_code' => 'other', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertStatus(428);

        // The customer cancels a requested return; the quantity is free again.
        $first = $this->requestReturn($number, ['reason_code' => 'changed_mind', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 2]]])->assertCreated()->json('data');
        $cancelKey = (string) Str::uuid();
        $cancel = fn (?string $key = null) => $this->browse('POST', $this->storeUrl("account/returns/{$first['number']}/cancel"), [], ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
        $cancel($cancelKey)->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.can_cancel', false);
        $cancel($cancelKey)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $cancel()->assertUnprocessable()->assertJsonPath('error.code', 'RETURN_NOT_CANCELLABLE')->assertJsonPath('error.details.status', 'cancelled');
        $this->assertSame('2', $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines.0.returnable_quantity'));

        // Staff reject the next one: free again; the customer cannot cancel a rejected return.
        $second = $this->requestReturn($number, ['reason_code' => 'not_as_described', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertCreated()->json('data');
        $this->staff();
        $id = $this->returnId($second['number']);
        $this->step($id, 'reject', [])->assertUnprocessable()->assertJsonValidationErrors('reason', 'error.details');
        $this->step($id, 'reject', ['reason' => 'Opened and used'])->assertOk()->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.allowed_actions', []);
        $this->step($id, 'approve')->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        Notification::assertSentOnDemand(OrderReturnStatusEmail::class, fn (OrderReturnStatusEmail $mail) => $mail->step === 'rejected' && $mail->return['rejection_reason'] === 'Opened and used');
        $this->clearBrowser();
        $this->signIn('shopper@example.test');
        $this->browse('POST', $this->storeUrl("account/returns/{$second['number']}/cancel"), [], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertUnprocessable()->assertJsonPath('error.code', 'RETURN_NOT_CANCELLABLE');
        $list = $this->browse('GET', $this->storeUrl('account/returns'))->assertOk()->json('data');
        $this->assertSame([['RTN-WEB-000002', 'rejected', 'Opened and used'], ['RTN-WEB-000001', 'cancelled', null]], array_map(fn ($r) => [$r['number'], $r['status'], $r['rejection_reason']], $list));

        // After the window: closed for the customer; staff may override with a note.
        $this->travel(8)->days();
        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data');
        $this->assertSame([false, 'window_closed', '0'], [$view['returnable'], $view['return_unavailable_reason'], $view['lines'][0]['returnable_quantity']]);
        $this->requestReturn($number, ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])
            ->assertUnprocessable()->assertJsonPath('error.details.reason', 'window_closed');
        $this->staff();
        $orderId = $this->orderModel($number)->id;
        $this->assertFalse($this->getJson("/api/v1/web-orders/{$orderId}")->json('data.return_window_open'));
        $this->assertContains('create_return', $this->getJson("/api/v1/web-orders/{$orderId}")->json('data.allowed_actions'));
        $staffCreate = fn (array $extra) => $this->postJson("/api/v1/web-orders/{$orderId}/returns", $extra + ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]], ['Idempotency-Key' => (string) Str::uuid()]);
        $staffCreate([])->assertUnprocessable()->assertJsonPath('error.details.reason', 'window_closed');
        $staffCreate(['override_window' => true])->assertUnprocessable()->assertJsonValidationErrors('note', 'error.details');
        $staffCreate(['override_window' => true, 'note' => 'Goodwill'])->assertCreated()->assertJsonPath('data.override_window', true)->assertJsonPath('data.staff_note', 'Goodwill');

        // Returns switched off.
        $this->patchJson('/api/v1/storefront/settings', ['return_window_days' => 61])->assertUnprocessable();
        $this->patchJson('/api/v1/storefront/settings', ['return_window_days' => 0])->assertOk()->assertJsonPath('data.return_window_days', 0);
        $this->travelBack();
        $fresh = $this->customerOrderAfterSignIn(['JUICE' => 1]);
        $view = $this->browse('GET', $this->storeUrl("account/orders/{$fresh}"))->json('data');
        $this->assertSame([false, 'returns_disabled', null], [$view['returnable'], $view['return_unavailable_reason'], $view['return_deadline']]);
    }

    /**
     * @param  array<string, int>  $items
     */
    private function customerOrderAfterSignIn(array $items): string
    {
        $this->clearBrowser();
        $this->signIn('shopper@example.test');

        return $this->deliveredOrder($items);
    }

    public function test_cash_refunds_need_an_open_register_session(): void
    {
        $this->registerShopper(self::HOST);
        $number = $this->deliveredOrder(['JUICE' => 1]);
        $lines = $this->lineIds($number);
        $created = $this->requestReturn($number, ['reason_code' => 'wrong_item', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertCreated()->json('data');
        $this->staff();
        $id = $this->returnId($created['number']);
        $this->step($id, 'approve')->assertOk();
        $this->step($id, 'receive', ['lines' => []])->assertOk()->assertJsonPath('data.lines.0.restock', true);
        $this->step($id, 'refund', ['method' => 'card'])->assertUnprocessable()->assertJsonValidationErrors('method', 'error.details');
        $this->step($id, 'refund', ['method' => 'cash'])->assertUnprocessable()->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');

        $session = $this->openSession($this->tenant['admin'], $this->tenant['store']->branch_id, '1000.00');
        $this->step($id, 'refund', ['method' => 'cash'])->assertOk()->assertJsonPath('data.status', 'refunded')->assertJsonPath('data.order.payment_status', 'partially_refunded');
        $payment = Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order_refund')->sole();
        $this->assertSame(['cash', 'out', '138.00', $session->id], [$payment->method->value, $payment->direction->value, (string) $payment->amount, $payment->cash_register_session_id]);
    }

    public function test_permissions_view_versus_refund(): void
    {
        $this->registerShopper(self::HOST);
        $number = $this->deliveredOrder(['JUICE' => 1]);
        $lines = $this->lineIds($number);
        $created = $this->requestReturn($number, ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertCreated()->json('data');
        $this->staff();
        $id = $this->returnId($created['number']);
        $orderId = $this->orderModel($number)->id;
        $viewerRole = $this->postJson('/api/v1/roles', ['name' => 'Order viewer', 'permissions' => ['web_orders.view']])->assertCreated()->json('data.id');

        $viewer = $this->createUserWithRole($this->tenant['organization'], Role::query()->withoutGlobalScopes()->findOrFail($viewerRole));
        $this->actingAsUser($viewer);
        $this->getJson('/api/v1/web-order-returns')->assertOk()->assertJsonPath('meta.status_counts.requested', 1)->assertJsonPath('data.0.number', 'RTN-WEB-000001');
        $this->getJson("/api/v1/web-order-returns/{$id}")->assertOk()->assertJsonPath('data.allowed_actions', []);
        $this->assertNotContains('create_return', $this->getJson("/api/v1/web-orders/{$orderId}")->json('data.allowed_actions'));
        $this->step($id, 'approve')->assertForbidden();
        $this->postJson("/api/v1/web-orders/{$orderId}/returns", [], ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();

        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/web-order-returns')->assertForbidden();
        $this->getJson("/api/v1/web-order-returns/{$id}")->assertForbidden();

        foreach ([SystemRole::Accountant, SystemRole::OnlineStoreManager] as $role) {
            $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], $role));
            $this->getJson("/api/v1/web-order-returns/{$id}")->assertOk()->assertJsonPath('data.allowed_actions', ['approve', 'reject']);
        }
        $this->step($id, 'approve')->assertOk();

        // List filters and search.
        $this->getJson('/api/v1/web-order-returns?status=requested')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/web-order-returns?search='.$number)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.order.number', $number);
        $this->getJson('/api/v1/web-order-returns?search=nobody')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_customers_and_organizations_never_see_each_others_returns(): void
    {
        $this->registerShopper(self::HOST, 'a@example.test');
        $number = $this->deliveredOrder(['JUICE' => 1]);
        $lines = $this->lineIds($number);
        $created = $this->requestReturn($number, ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertCreated()->json('data');

        // Customer B of the same store.
        $this->clearBrowser();
        $this->registerShopper(self::HOST, 'b@example.test');
        $this->browse('GET', $this->storeUrl('account/returns'))->assertOk()->assertJsonPath('data', []);
        $this->requestReturn($number, ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE'], 'quantity' => 1]]])->assertNotFound();
        $this->browse('POST', $this->storeUrl("account/returns/{$created['number']}/cancel"), [], ['Idempotency-Key' => (string) Str::uuid()])->assertNotFound();

        // Guests.
        $this->clearBrowser();
        $this->browse('GET', $this->storeUrl('account/returns'))->assertUnauthorized();
        $this->requestReturn($number, ['reason_code' => 'damaged', 'lines' => []])->assertUnauthorized();

        // Another organization: its staff and its customers.
        $id = $this->returnId($created['number']);
        $this->openStore('Other Shop', 'other.example.test');
        $this->getJson('/api/v1/web-order-returns')->assertOk()->assertJsonPath('data', []);
        $this->getJson("/api/v1/web-order-returns/{$id}")->assertNotFound();
        $this->postJson("/api/v1/web-order-returns/{$id}/approve", [], ['Idempotency-Key' => (string) Str::uuid()])->assertNotFound();
        $this->asVisitor();
        $this->clearBrowser();
        $this->registerShopper('other.example.test', 'a@example.test');
        $this->browse('GET', $this->storeUrl('account/returns', 'other.example.test'))->assertOk()->assertJsonPath('data', []);
        $this->browse('POST', $this->storeUrl("account/returns/{$created['number']}/cancel", 'other.example.test'), [], ['Idempotency-Key' => (string) Str::uuid()])->assertNotFound();
        $this->assertSame('requested', $this->inTenant($this->tenant['organization'], fn () => OrderReturn::query()->findOrFail($id)->status->value));
    }
}
