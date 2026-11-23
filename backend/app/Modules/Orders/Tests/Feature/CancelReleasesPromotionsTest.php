<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Q1: every way a web order is cancelled gives its promotions back — the redemptions are
 * released in the cancelling transaction (usage limits and once-per-customer coupons count
 * again), once, and the cancel's audit record lists them. Shop from BuildsCheckout: Shirt 450,
 * delivery inside Dhaka 60.
 */
class CancelReleasesPromotionsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private Promotion $once;

    private Promotion $launch;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.coupon_rate_limit' => 1000]);
        $this->buildShop();
        $org = $this->tenant['organization'];
        // WELCOME-style: once per customer, by coupon.
        $this->once = $this->makePromotion($org, ['name' => 'Once', 'type' => 'fixed', 'value' => '50', 'trigger' => 'coupon', 'usage_limit_per_customer' => 1, 'coupon_code' => 'ONCE50']);
        // An automatic offer for the first order only (overall usage limit).
        $this->launch = $this->makePromotion($org, ['name' => 'Launch', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productOf($this->v['SHIRT'])], 'usage_limit' => 1]);
    }

    public function test_a_staff_cancel_gives_the_coupon_and_the_limited_offer_back(): void
    {
        $id = $this->orderWithCoupon();
        $this->assertSame(1, $this->couponUses());
        $this->assertSame(2, $this->activeRedemptions());

        $this->staff();
        $this->act($id, 'cancel', ['reason' => 'Customer changed mind'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertReleased($id, 2);

        // The same shopper (same e-mail) may use the once-per-customer coupon again, and the
        // first-order offer is available again.
        $again = $this->orderWithCoupon();
        $this->assertNotSame($id, $again);
        $this->assertSame(1, $this->couponUses());
        $this->assertSame(2, $this->activeRedemptions());

        // Staff see the released use on the promotion.
        $this->staff();
        $rows = $this->getJson("/api/v1/promotions/{$this->once->id}/redemptions")->assertOk()->json('data');
        $this->assertCount(2, $rows);
        $this->assertSame(1, collect($rows)->whereNotNull('released_at')->count());
        $this->getJson("/api/v1/promotions/{$this->once->id}")->assertOk()->assertJsonPath('data.redemption_count', 1);
    }

    public function test_a_signed_in_customer_cancelling_their_unpaid_order_can_use_the_coupon_again(): void
    {
        $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('ONCE50')->assertOk();
        $number = $this->place('cod')['number'];
        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('ONCE50')->assertStatus(422)->assertJsonPath('error.details.reason', 'customer_limit_reached');

        $this->browse('POST', $this->storeUrl("account/orders/{$number}/cancel"), ['reason' => 'Mistake'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertReleased($this->idOf($number), 2, 'customer');
        $this->applyCoupon('ONCE50')->assertOk()->assertJsonPath('data.coupon.applied', true);
    }

    public function test_an_expired_unpaid_order_gives_its_promotions_back(): void
    {
        $id = $this->orderWithCoupon('bank_transfer');

        $this->travel(49)->hours();
        $this->artisan('orders:expire-pending')->assertSuccessful();
        $this->assertSame('cancelled', Order::query()->withoutGlobalScopes()->whereKey($id)->value('status')->value);
        $this->assertReleased($id, 2, 'system');
    }

    public function test_a_paid_order_cancelled_with_a_refund_gives_its_promotions_back(): void
    {
        $id = $this->orderWithCoupon('bank_transfer');
        $this->staff();
        $this->act($id, 'confirm-payment', ['reference' => 'TXN-1'])->assertOk();

        $this->act($id, 'cancel', ['reason' => 'Out of stock', 'refund' => ['method' => 'bank_transfer', 'reference' => 'RF-1']])->assertOk()
            ->assertJsonPath('data.payment_status', 'refunded');
        $this->assertReleased($id, 2);
    }

    public function test_a_parcel_returned_to_the_sender_and_cancelled_gives_its_promotions_back(): void
    {
        $id = $this->orderWithCoupon();
        $this->staff();
        $this->act($id, 'process')->assertOk();
        $courier = $this->inTenant($this->tenant['organization'], fn () => Courier::query()->firstOrCreate(['name' => 'Pathao'])->id);
        $this->act($id, 'ship', ['courier_id' => $courier])->assertOk();
        $this->act($id, 'shipment/events', ['status' => 'returned'])->assertOk();

        $this->act($id, 'cancel', ['reason' => 'Refused at the door'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertReleased($id, 2);
    }

    public function test_releasing_is_idempotent_and_the_rows_stay_otherwise_append_only(): void
    {
        $id = $this->orderWithCoupon();
        $this->staff();
        $key = (string) Str::uuid();
        $this->act($id, 'cancel', ['reason' => 'Twice'], $key)->assertOk();
        $this->act($id, 'cancel', ['reason' => 'Twice'], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->act($id, 'cancel', ['reason' => 'Twice'])->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertReleased($id, 2);

        $this->inTenant($this->tenant['organization'], function () use ($id) {
            $this->assertSame([], DB::transaction(fn () => app(PromotionRedemptions::class)->release($id)));
        });
        $this->assertSame(0, $this->couponUses());

        // The database refuses any other change, and un-releasing.
        foreach ([['amount' => '1.00'], ['released_at' => null]] as $change) {
            try {
                DB::transaction(fn () => PromotionRedemption::query()->withoutGlobalScopes()->where('order_id', $id)->update($change));
                $this->fail('promotion_redemptions must stay append-only.');
            } catch (QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
    }

    public function test_releasing_stays_inside_the_organization(): void
    {
        $id = $this->orderWithCoupon();
        ['organization' => $other] = $this->provisionTenant('Other Shop');

        app(TenantContext::class)->runAs($other->id, function () use ($id) {
            $this->assertSame([], DB::transaction(fn () => app(PromotionRedemptions::class)->release($id)));
        });
        $this->assertSame(2, $this->activeRedemptions());
        $this->assertSame(1, $this->couponUses());
    }

    /**
     * A guest order of one shirt with the ONCE50 coupon (and the automatic Launch offer).
     */
    private function orderWithCoupon(string $payment = 'cod'): string
    {
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('ONCE50')->assertOk()->assertJsonPath('data.coupon.applied', true);

        return $this->idOf($this->place($payment)['number']);
    }

    /**
     * @return array<string, mixed> the placed order
     */
    private function place(string $payment): array
    {
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => $payment])->assertOk()->json('data.total');
        $order = $this->placeOrder($this->checkoutBody($total, ['payment_method' => $payment]))->assertCreated()->json('data.order');
        $this->assertSame('ONCE50', $order['coupon_code']);
        $this->assertCount(2, $order['promotions']);

        return $order;
    }

    private function assertReleased(string $orderId, int $count, string $by = 'staff'): void
    {
        $rows = PromotionRedemption::query()->withoutGlobalScopes()->where('order_id', $orderId)->get();
        $this->assertCount($count, $rows);
        $this->assertTrue($rows->every(fn (PromotionRedemption $r) => $r->released_at !== null));
        $this->assertSame(0, $this->couponUses());

        $audit = AuditLog::query()->withoutGlobalScopes()->where('subject_id', $orderId)->where('action', 'web_order.cancelled')->sole();
        $this->assertSame($by, $audit->new_values['by']);
        $this->assertEqualsCanonicalizing([$this->once->id, $this->launch->id], array_column($audit->new_values['released_promotions'], 'promotion_id'));
    }

    private function applyCoupon(string $code): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('cart/coupon'), ['code' => $code]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    private function idOf(string $number): string
    {
        return Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');
    }

    private function couponUses(): int
    {
        return (int) Coupon::query()->withoutGlobalScopes()->where('code', 'ONCE50')->value('used_count');
    }

    private function activeRedemptions(): int
    {
        return PromotionRedemption::query()->withoutGlobalScopes()->whereNull('released_at')->count();
    }
}
