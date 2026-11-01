<?php

namespace App\Modules\Promotions\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * E10b: a promotion's report — redemptions, orders, discount, order revenue and the
 * per-day breakdown in the organization's timezone.
 */
class PromotionReportTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    private function orderAt(string $utc, string $sku, int $quantity, string $total): void
    {
        $this->travelTo(CarbonImmutable::parse($utc, 'UTC'));
        $this->clearBrowser();
        $this->addToCart($sku, $quantity);
        $this->placeOrder($this->checkoutBody($total))->assertCreated();
    }

    public function test_report_counts_redemptions_by_organization_day(): void
    {
        $promotion = $this->makePromotion($this->tenant['organization'], ['name' => '50 off 400', 'type' => 'fixed', 'value' => '50', 'min_subtotal' => '400']);
        $other = $this->makePromotion($this->tenant['organization'], ['name' => 'Shirt 10%', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productOf($this->v['SHIRT'])]]);
        $timezone = $this->inTenant($this->tenant['organization'], fn () => $this->tenant['organization']->fresh()->timezone);

        // Shirt 450 − 45 (product) − 50 (order) + 60 delivery = 415.00; Shirt ×2: 900 − 90 − 50 + 60 = 820.00.
        $this->orderAt('2026-10-10 03:00:00', 'SHIRT', 1, '415.00');
        $this->orderAt('2026-10-10 22:30:00', 'SHIRT', 2, '820.00');
        $this->orderAt('2026-10-12 09:00:00', 'SHIRT', 1, '415.00');
        $this->travelBack();

        $this->actingAsUser($this->tenant['admin']);
        $all = $this->getJson("/api/v1/promotions/{$promotion->id}/report")->assertOk()->json('data');
        $this->assertSame([3, 3, 0, '150.00', '1650.00', '50.00', $timezone], [
            $all['redemptions'], $all['orders'], $all['cancelled_orders'], $all['discount_total'], $all['order_revenue'], $all['average_discount'], $all['timezone'],
        ]);
        $day = fn (string $utc) => CarbonImmutable::parse($utc, 'UTC')->setTimezone($timezone)->toDateString();
        $expected = [];
        foreach (['2026-10-10 03:00:00', '2026-10-10 22:30:00', '2026-10-12 09:00:00'] as $at) {
            $expected[$day($at)] = ($expected[$day($at)] ?? 0) + 1;
        }
        $this->assertSame($expected, array_column($all['by_day'], 'redemptions', 'date'));

        // A range lists every day, zeros included; days are the organization's.
        $first = $day('2026-10-10 03:00:00');
        $range = $this->getJson("/api/v1/promotions/{$promotion->id}/report?date_from={$first}&date_to={$first}")->assertOk()->json('data');
        $this->assertSame([['date' => $first, 'redemptions' => $expected[$first], 'discount' => number_format(50 * $expected[$first], 2, '.', '')]], $range['by_day']);
        $this->assertSame($expected[$first], $range['redemptions']);
        $wide = $this->getJson("/api/v1/promotions/{$promotion->id}/report?date_from=2026-10-09&date_to=2026-10-13")->assertOk()->json('data');
        $this->assertCount(5, $wide['by_day']);
        $this->assertSame(0, $wide['by_day'][0]['redemptions']);
        $this->assertSame('0.00', $wide['by_day'][0]['discount']);

        // The product promotion: its own discount, the same orders' revenue.
        $shirt = $this->getJson("/api/v1/promotions/{$other->id}/report")->assertOk()->json('data');
        $this->assertSame([3, '180.00', '1650.00', '60.00'], [$shirt['redemptions'], $shirt['discount_total'], $shirt['order_revenue'], $shirt['average_discount']]);

        // Validation, permissions and isolation.
        $this->getJson("/api/v1/promotions/{$promotion->id}/report?date_from=2026-10-12&date_to=2026-10-10")->assertUnprocessable();
        $this->getJson("/api/v1/promotions/{$promotion->id}/report?date_from=2025-01-01&date_to=2026-10-10")->assertUnprocessable()->assertJsonValidationErrors('date_to', 'error.details');
        $this->getJson("/api/v1/promotions/{$promotion->id}/report?date_from=10-10-2026")->assertUnprocessable();
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]));
        $this->getJson("/api/v1/promotions/{$promotion->id}/report")->assertForbidden();
        $this->openStore('Other Shop', 'other.example.test');
        $this->getJson("/api/v1/promotions/{$promotion->id}/report")->assertNotFound();
    }
}
