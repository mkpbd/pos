<?php

namespace App\Modules\Promotions\Tests\Unit;

use App\Modules\Promotions\Domain\CouponReason;
use App\Modules\Promotions\Domain\LineInput;
use App\Modules\Promotions\Domain\Offer;
use App\Modules\Promotions\Domain\PromotionEngine;
use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Domain\PromotionType;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

class PromotionEngineTest extends TestCase
{
    private DateTimeImmutable $now;

    protected function setUp(): void
    {
        $this->now = new DateTimeImmutable('2026-11-01 12:00:00');
    }

    private function line(int $key, string $product, string $qty, string $price, ?string $brand = null, ?string $category = null): LineInput
    {
        return new LineInput($key, $product, $brand, $category, $qty, $price);
    }

    /**
     * @param  array<string, mixed>  $o
     */
    private function offer(string $id, PromotionType $type, string $value, PromotionScope $scope = PromotionScope::Order, array $o = []): Offer
    {
        return new Offer(
            id: $id,
            name: $o['name'] ?? ucfirst($id),
            type: $type,
            value: $value,
            scope: $scope,
            targetIds: $o['targets'] ?? [],
            minSubtotal: $o['min'] ?? null,
            maxDiscount: $o['max'] ?? null,
            startsAt: $o['starts'] ?? null,
            endsAt: $o['ends'] ?? null,
            isCoupon: $o['coupon'] ?? false,
        );
    }

    /**
     * @param  list<LineInput>  $lines
     * @param  list<Offer>  $automatic
     */
    private function apply(array $lines, array $automatic, ?Offer $coupon = null, ?CouponReason $blocked = null, bool $hasCoupon = false)
    {
        return PromotionEngine::apply($lines, $automatic, $coupon, $blocked, $this->now, 'BDT', $hasCoupon || $coupon !== null);
    }

    public function test_each_line_gets_the_single_best_product_promotion(): void
    {
        $lines = [$this->line(0, 'juice', '2', '100.00', 'pran'), $this->line(1, 'rice', '1', '500.00', 'mills')];
        $tenPercent = $this->offer('a', PromotionType::Percent, '10', PromotionScope::Brands, ['targets' => ['pran', 'mills']]);
        $fifteenOff = $this->offer('b', PromotionType::Fixed, '15', PromotionScope::Products, ['targets' => ['juice']]);

        $r = $this->apply($lines, [$tenPercent, $fifteenOff]);

        // Juice: 10% of 200 = 20 vs 15 × 2 = 30 → fixed wins. Rice: only the 10% (50).
        $this->assertSame('30.00', $r->lineDiscounts[0]->amount());
        $this->assertSame('b', $r->linePromotions[0]->id);
        $this->assertSame('50.00', $r->lineDiscounts[1]->amount());
        $this->assertSame('a', $r->linePromotions[1]->id);
        $this->assertSame(['b' => '30.00', 'a' => '50.00'], array_column(array_map(fn ($e) => [$e['offer']->id, $e['amount']->amount()], $r->productPromotions), 1, 0));
        $this->assertSame('80.00', $r->productDiscountTotal()->amount());
        $this->assertNull($r->orderPromotion);
    }

    public function test_ties_go_to_the_promotion_ending_first_then_the_smaller_id(): void
    {
        $lines = [$this->line(0, 'juice', '1', '100.00')];
        $openEnded = $this->offer('a', PromotionType::Percent, '10', PromotionScope::Products, ['targets' => ['juice']]);
        $endsLater = $this->offer('c', PromotionType::Fixed, '10', PromotionScope::Products, ['targets' => ['juice'], 'ends' => new DateTimeImmutable('2026-11-09')]);
        $endsSoon = $this->offer('d', PromotionType::Fixed, '10', PromotionScope::Products, ['targets' => ['juice'], 'ends' => new DateTimeImmutable('2026-11-05')]);

        $this->assertSame('d', $this->apply($lines, [$openEnded, $endsLater, $endsSoon])->linePromotions[0]->id);
        $this->assertSame('c', $this->apply($lines, [$openEnded, $endsLater])->linePromotions[0]->id);

        $sameEnd = $this->offer('b', PromotionType::Percent, '10', PromotionScope::Products, ['targets' => ['juice']]);
        $this->assertSame('a', $this->apply($lines, [$sameEnd, $openEnded])->linePromotions[0]->id);
    }

    public function test_fixed_product_discounts_are_per_unit_and_never_exceed_the_line(): void
    {
        $offer = $this->offer('a', PromotionType::Fixed, '30', PromotionScope::Products, ['targets' => ['gum', 'cake']]);
        $r = $this->apply([$this->line(0, 'gum', '3', '20.00'), $this->line(1, 'cake', '1.5', '100.00')], [$offer]);

        $this->assertSame('60.00', $r->lineDiscounts[0]->amount()); // 3 × 30 = 90, capped at the line's 60
        $this->assertSame('45.00', $r->lineDiscounts[1]->amount()); // 1.5 × 30
    }

    public function test_product_min_subtotal_counts_the_matching_lines_only(): void
    {
        $offer = $this->offer('a', PromotionType::Percent, '10', PromotionScope::Brands, ['targets' => ['pran'], 'min' => '300.00']);
        $lines = [$this->line(0, 'juice', '2', '100.00', 'pran'), $this->line(1, 'rice', '1', '1000.00', 'mills')];

        $this->assertSame('0.00', $this->apply($lines, [$offer])->productDiscountTotal()->amount());

        $lines[0] = $this->line(0, 'juice', '3', '100.00', 'pran');
        $this->assertSame('30.00', $this->apply($lines, [$offer])->productDiscountTotal()->amount());
    }

    public function test_max_discount_caps_a_promotion_shared_in_proportion(): void
    {
        $offer = $this->offer('a', PromotionType::Percent, '50', PromotionScope::Products, ['targets' => ['x', 'y'], 'max' => '100.00']);
        $r = $this->apply([$this->line(0, 'x', '1', '300.00'), $this->line(1, 'y', '1', '100.00'), $this->line(2, 'z', '1', '50.00')], [$offer]);

        // Uncapped 150 + 50 = 200 → cap 100 split 3:1.
        $this->assertSame('75.00', $r->lineDiscounts[0]->amount());
        $this->assertSame('25.00', $r->lineDiscounts[1]->amount());
        $this->assertSame('0.00', $r->lineDiscounts[2]->amount());
        $this->assertNull($r->linePromotions[2]);
    }

    public function test_the_cap_is_shared_over_the_lines_that_actually_use_the_promotion(): void
    {
        $capped = $this->offer('a', PromotionType::Percent, '50', PromotionScope::Products, ['targets' => ['x', 'y'], 'max' => '100.00']);
        $better = $this->offer('b', PromotionType::Fixed, '90', PromotionScope::Products, ['targets' => ['x']]);
        $r = $this->apply([$this->line(0, 'x', '1', '300.00'), $this->line(1, 'y', '1', '100.00')], [$capped, $better]);

        // x: 90 (b) beats its capped share of a (75); y alone keeps a's full 50 (under the cap).
        $this->assertSame('b', $r->linePromotions[0]->id);
        $this->assertSame('90.00', $r->lineDiscounts[0]->amount());
        $this->assertSame('a', $r->linePromotions[1]->id);
        $this->assertSame('50.00', $r->lineDiscounts[1]->amount());
    }

    public function test_the_best_order_promotion_applies_to_the_subtotal_after_product_discounts(): void
    {
        $product = $this->offer('p', PromotionType::Percent, '50', PromotionScope::Products, ['targets' => ['x']]);
        $percent = $this->offer('o1', PromotionType::Percent, '10', PromotionScope::Order);
        $fixed = $this->offer('o2', PromotionType::Fixed, '25', PromotionScope::Order);
        $lines = [$this->line(0, 'x', '1', '200.00'), $this->line(1, 'y', '1', '100.00')];

        // After product discounts: 300 − 100 = 200 → 10% = 20 < fixed 25.
        $r = $this->apply($lines, [$product, $percent, $fixed]);
        $this->assertSame('o2', $r->orderPromotion['offer']->id);
        $this->assertSame('25.00', $r->orderDiscount()->amount());

        // Without the fixed one: 20, and a max_discount cap applies to percent.
        $this->assertSame('20.00', $this->apply($lines, [$product, $percent])->orderDiscount()->amount());
        $capped = $this->offer('o3', PromotionType::Percent, '10', PromotionScope::Order, ['max' => '15.00']);
        $this->assertSame('15.00', $this->apply($lines, [$product, $capped])->orderDiscount()->amount());
    }

    public function test_order_min_subtotal_is_checked_before_any_discount(): void
    {
        $product = $this->offer('p', PromotionType::Percent, '50', PromotionScope::Products, ['targets' => ['x']]);
        $order = $this->offer('o', PromotionType::Fixed, '50', PromotionScope::Order, ['min' => '500.00']);

        // 500 before discounts (250 after the product discount) still qualifies.
        $r = $this->apply([$this->line(0, 'x', '1', '500.00')], [$product, $order]);
        $this->assertSame('50.00', $r->orderDiscount()->amount());
        $this->assertNull($this->apply([$this->line(0, 'x', '1', '499.99')], [$product, $order])->orderPromotion);
    }

    public function test_fixed_order_discount_never_exceeds_what_is_left(): void
    {
        $order = $this->offer('o', PromotionType::Fixed, '500', PromotionScope::Order);
        $this->assertSame('120.00', $this->apply([$this->line(0, 'x', '1', '120.00')], [$order])->orderDiscount()->amount());
    }

    public function test_free_shipping_needs_its_min_subtotal_and_prefers_automatic_over_the_coupon(): void
    {
        $auto = $this->offer('f1', PromotionType::FreeShipping, '0', PromotionScope::Order, ['min' => '3000.00']);
        $lines = [$this->line(0, 'x', '1', '2999.99')];
        $this->assertNull($this->apply($lines, [$auto])->freeShipping);

        $lines = [$this->line(0, 'x', '2', '1500.00')];
        $this->assertSame('f1', $this->apply($lines, [$auto])->freeShipping->id);

        $coupon = $this->offer('f2', PromotionType::FreeShipping, '0', PromotionScope::Order, ['coupon' => true]);
        $r = $this->apply($lines, [$auto], $coupon);
        $this->assertSame('f1', $r->freeShipping->id);
        $this->assertFalse($r->couponApplied);
        $this->assertSame(CouponReason::BetterOffer, $r->couponReason);

        $r = $this->apply([$this->line(0, 'x', '1', '100.00')], [$auto], $coupon);
        $this->assertSame('f2', $r->freeShipping->id);
        $this->assertTrue($r->couponApplied);
        $this->assertNull($r->couponReason);
    }

    public function test_a_coupon_beaten_by_an_automatic_promotion_is_not_used(): void
    {
        $lines = [$this->line(0, 'juice', '1', '100.00', 'pran')];
        $auto = $this->offer('a', PromotionType::Percent, '20', PromotionScope::Brands, ['targets' => ['pran']]);
        $coupon = $this->offer('c', PromotionType::Percent, '10', PromotionScope::Products, ['targets' => ['juice'], 'coupon' => true]);

        $r = $this->apply($lines, [$auto], $coupon);
        $this->assertSame('a', $r->linePromotions[0]->id);
        $this->assertFalse($r->couponApplied);
        $this->assertSame(CouponReason::BetterOffer, $r->couponReason);

        // A better coupon wins the line.
        $coupon = $this->offer('c', PromotionType::Percent, '30', PromotionScope::Products, ['targets' => ['juice'], 'coupon' => true]);
        $r = $this->apply($lines, [$auto], $coupon);
        $this->assertSame('c', $r->linePromotions[0]->id);
        $this->assertTrue($r->couponApplied);
        $this->assertSame('30.00', $r->productDiscountTotal()->amount());

        // An order coupon that is smaller than the automatic order promotion.
        $autoOrder = $this->offer('o', PromotionType::Fixed, '40', PromotionScope::Order);
        $orderCoupon = $this->offer('oc', PromotionType::Fixed, '30', PromotionScope::Order, ['coupon' => true]);
        $r = $this->apply($lines, [$autoOrder], $orderCoupon);
        $this->assertSame('o', $r->orderPromotion['offer']->id);
        $this->assertSame(CouponReason::BetterOffer, $r->couponReason);
    }

    public function test_coupon_reasons(): void
    {
        $lines = [$this->line(0, 'juice', '1', '100.00', 'pran', 'drinks')];

        $this->assertSame(CouponReason::NotFound, $this->apply($lines, [], null, CouponReason::NotFound)->couponReason);
        $this->assertNull($this->apply($lines, [])->couponReason);

        $future = $this->offer('c', PromotionType::Fixed, '10', PromotionScope::Order, ['coupon' => true, 'starts' => new DateTimeImmutable('2026-11-02')]);
        $this->assertSame(CouponReason::NotStarted, $this->apply($lines, [], $future)->couponReason);

        $past = $this->offer('c', PromotionType::Fixed, '10', PromotionScope::Order, ['coupon' => true, 'ends' => new DateTimeImmutable('2026-11-01 12:00:00')]);
        $this->assertSame(CouponReason::Expired, $this->apply($lines, [], $past)->couponReason);

        $ok = $this->offer('c', PromotionType::Fixed, '10', PromotionScope::Order, ['coupon' => true]);
        $this->assertSame(CouponReason::UsageLimitReached, $this->apply($lines, [], $ok, CouponReason::UsageLimitReached)->couponReason);
        $this->assertSame(CouponReason::CustomerLimitReached, $this->apply($lines, [], $ok, CouponReason::CustomerLimitReached)->couponReason);
        // Schedule is reported before limits.
        $this->assertSame(CouponReason::Expired, $this->apply($lines, [], $past, CouponReason::UsageLimitReached)->couponReason);

        $min = $this->offer('c', PromotionType::Fixed, '10', PromotionScope::Order, ['coupon' => true, 'min' => '500.00']);
        $this->assertSame(CouponReason::MinSubtotal, $this->apply($lines, [], $min)->couponReason);

        $otherBrand = $this->offer('c', PromotionType::Percent, '10', PromotionScope::Brands, ['coupon' => true, 'targets' => ['mills']]);
        $this->assertSame(CouponReason::NotApplicable, $this->apply($lines, [], $otherBrand)->couponReason);

        $category = $this->offer('c', PromotionType::Percent, '10', PromotionScope::Categories, ['coupon' => true, 'targets' => ['grocery', 'drinks']]);
        $r = $this->apply($lines, [], $category);
        $this->assertTrue($r->couponApplied);
        $this->assertSame('10.00', $r->lineDiscounts[0]->amount());

        $this->assertSame(CouponReason::NotApplicable, $this->apply([], [], $ok)->couponReason);
    }

    public function test_promotions_outside_their_schedule_are_ignored(): void
    {
        $lines = [$this->line(0, 'x', '1', '100.00')];
        $ended = $this->offer('a', PromotionType::Fixed, '10', PromotionScope::Order, ['ends' => new DateTimeImmutable('2026-11-01 11:59:59')]);
        $notYet = $this->offer('b', PromotionType::Fixed, '20', PromotionScope::Order, ['starts' => new DateTimeImmutable('2026-11-01 12:00:01')]);
        $live = $this->offer('c', PromotionType::Fixed, '5', PromotionScope::Order, ['starts' => new DateTimeImmutable('2026-11-01 12:00:00')]);

        $r = $this->apply($lines, [$ended, $notYet, $live]);
        $this->assertSame('c', $r->orderPromotion['offer']->id);
    }

    public function test_nothing_applies_without_promotions(): void
    {
        $r = $this->apply([$this->line(0, 'x', '2', '10.00')], []);
        $this->assertSame('20.00', $r->subtotal->amount());
        $this->assertSame('0.00', $r->productDiscountTotal()->amount());
        $this->assertSame('0.00', $r->orderDiscount()->amount());
        $this->assertNull($r->freeShipping);
        $this->assertFalse($r->couponApplied);
        $this->assertNull($r->couponReason);
    }
}
