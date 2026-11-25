<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Promotions\Application\Contracts\PromotionPricing;
use App\Modules\Promotions\Application\DTOs\PromotionQuote;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * POS1a: the till's promotions (Promotions module, `till` channel) for a priced cart, and
 * the precedence rules — one discount per level, deterministic:
 *
 * - Line: a manual item discount replaces the line's promotion; lines with a changed or
 *   typed (open) price get no promotion (both are sent as not promotable).
 * - Invoice: manual invoice discount > order promotion / coupon > customer-group discount.
 *
 * Coupon outcome for the cashier: `applied`; `not_applicable` (a better automatic offer or
 * the manual invoice discount wins — checkout goes ahead without it); `invalid` (unknown,
 * not started, expired, used up, minimum not reached, no matching products — the preview
 * shows it, checkout refuses COUPON_INVALID).
 */
class TillPromotions
{
    public function __construct(private readonly PromotionPricing $pricing) {}

    /**
     * @param  list<array{key: int, product_id: string, brand_id: ?string, category_id: ?string, quantity: string, unit_price: string, promotable: bool, own_discount: string}>  $lines
     * @param  array<string, mixed>|null  $customer  per-customer limits by its id and mobile number
     */
    public function quote(array $lines, ?string $couponCode, ?array $customer, string $currency): PromotionQuote
    {
        $code = $couponCode === null || trim($couponCode) === '' ? null : $couponCode;

        return $this->pricing->price($lines, $code, $customer['id'] ?? null, null, $currency, $customer['phone'] ?? null, PromotionPricing::CHANNEL_TILL);
    }

    /**
     * What the cart shows and the sale records, once the invoice level is decided.
     *
     * @return array{
     *   promotions: list<array{name: string, kind: string, amount: string}>,
     *   coupon: ?array{code: string, status: string, reason: ?string, message: ?string},
     *   coupon_code: ?string,
     *   redemptions: list<array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}>
     * }
     */
    public static function outcome(PromotionQuote $quote, bool $orderPromotionUsed): array
    {
        $redemptions = array_values(array_filter(
            $quote->redemptions,
            fn (array $r) => Decimal::compare($r['amount'], '0') > 0
                && ($r['kind'] === 'product' || ($r['kind'] === 'order' && $orderPromotionUsed)),
        ));

        $coupon = null;
        $couponCode = null;
        if ($quote->coupon !== null) {
            $used = array_filter($redemptions, fn (array $r) => $r['coupon_id'] !== null) !== [];
            if ($used) {
                $coupon = ['code' => $quote->coupon['code'], 'status' => 'applied', 'reason' => null, 'message' => null];
                $couponCode = $quote->coupon['code'];
            } elseif ($quote->coupon['applied']) {
                // Its order discount gave way to the manual invoice discount.
                $coupon = ['code' => $quote->coupon['code'], 'status' => 'not_applicable', 'reason' => 'manual_discount', 'message' => 'The manual invoice discount is given instead of this coupon.'];
            } elseif ($quote->coupon['reason'] === 'better_offer') {
                $coupon = ['code' => $quote->coupon['code'], 'status' => 'not_applicable', 'reason' => 'better_offer', 'message' => $quote->coupon['message']];
            } else {
                $coupon = ['code' => $quote->coupon['code'], 'status' => 'invalid', 'reason' => $quote->coupon['reason'], 'message' => $quote->coupon['message']];
            }
        }

        return [
            'promotions' => array_map(fn (array $r) => ['name' => $r['name'], 'kind' => $r['kind'], 'amount' => $r['amount']], $redemptions),
            'coupon' => $coupon,
            'coupon_code' => $couponCode,
            'redemptions' => $redemptions,
        ];
    }
}
