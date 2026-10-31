<?php

namespace App\Modules\Promotions\Infrastructure;

use App\Modules\Promotions\Application\Contracts\PromotionPricing;
use App\Modules\Promotions\Application\DTOs\PromotionQuote;
use App\Modules\Promotions\Domain\CouponCode;
use App\Modules\Promotions\Domain\LineInput;
use App\Modules\Promotions\Domain\PromotionEngine;
use App\Modules\Promotions\Infrastructure\Models\Promotion;

class EloquentPromotionPricing implements PromotionPricing
{
    public function __construct(private readonly PromotionOffers $offers) {}

    public function price(array $lines, ?string $couponCode, ?string $customerId, ?string $email, string $currency): PromotionQuote
    {
        $email = $email === null || trim($email) === '' ? null : mb_strtolower(trim($email));
        $automatic = array_map(fn (Promotion $p) => $this->offers->offer($p), $this->offers->usableAutomatic($customerId, $email));

        $coupon = null;
        $couponOffer = null;
        $blocked = null;
        $code = $couponCode === null || trim($couponCode) === '' ? null : CouponCode::normalize($couponCode);
        if ($code !== null) {
            [$coupon, $blocked] = $this->offers->coupon($code, $customerId, $email);
            $couponOffer = $coupon === null ? null : $this->offers->offer($coupon->promotion, true);
        }

        if ($automatic === [] && $code === null) {
            return PromotionQuote::none();
        }

        $inputs = array_map(fn (array $l) => new LineInput(
            $l['key'], $l['product_id'], $l['brand_id'] ?? null, $l['category_id'] ?? null, $l['quantity'], $l['unit_price'],
        ), $lines);
        $result = PromotionEngine::apply($inputs, $automatic, $couponOffer, $blocked, $this->offers->now(), $currency, $code !== null);
        $couponId = fn (string $promotionId) => $couponOffer !== null && $couponOffer->id === $promotionId && $result->couponApplied ? $coupon->id : null;

        $lineView = [];
        foreach ($inputs as $input) {
            $offer = $result->linePromotions[$input->key] ?? null;
            $lineView[$input->key] = [
                'amount' => $result->lineDiscounts[$input->key]->amount(),
                'promotion' => $offer === null ? null : ['id' => $offer->id, 'name' => $offer->name],
            ];
        }

        $promotions = [];
        $redemptions = [];
        foreach ($result->productPromotions as $entry) {
            $promotions[] = ['id' => $entry['offer']->id, 'name' => $entry['offer']->name, 'kind' => 'product', 'amount' => $entry['amount']->amount()];
            $redemptions[] = ['promotion_id' => $entry['offer']->id, 'coupon_id' => $couponId($entry['offer']->id), 'name' => $entry['offer']->name, 'kind' => 'product', 'amount' => $entry['amount']->amount()];
        }
        $order = $result->orderPromotion;
        if ($order !== null) {
            $promotions[] = ['id' => $order['offer']->id, 'name' => $order['offer']->name, 'kind' => 'order', 'amount' => $order['amount']->amount()];
            $redemptions[] = ['promotion_id' => $order['offer']->id, 'coupon_id' => $couponId($order['offer']->id), 'name' => $order['offer']->name, 'kind' => 'order', 'amount' => $order['amount']->amount()];
        }

        $free = $result->freeShipping;
        $minSubtotal = $couponOffer?->minSubtotal;

        return new PromotionQuote(
            lines: $lineView,
            orderDiscount: $result->orderDiscount()->amount(),
            orderPromotion: $order === null ? null : ['id' => $order['offer']->id, 'name' => $order['offer']->name],
            freeShipping: $free === null ? null : ['id' => $free->id, 'name' => $free->name, 'coupon_id' => $couponId($free->id)],
            promotions: $promotions,
            coupon: $code === null ? null : [
                'code' => $code,
                'applied' => $result->couponApplied,
                'reason' => $result->couponReason?->value,
                'message' => $result->couponReason?->message($minSubtotal, $currency),
                'promotion_name' => $couponOffer?->name,
            ],
            couponMinSubtotal: $minSubtotal,
            redemptions: $redemptions,
        );
    }
}
