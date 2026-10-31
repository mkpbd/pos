<?php

namespace App\Modules\Promotions\Application\DTOs;

/**
 * The promotions of a set of lines, ready for SaleCalculator: each line's product discount
 * (feed as the line's `Discount::amount`) and the order discount (feed as the invoice
 * discount), plus what the shopper sees and what placement redeems.
 */
final readonly class PromotionQuote
{
    /**
     * @param  array<int|string, array{amount: string, promotion: ?array{id: string, name: string}}>  $lines  product discount per line key
     * @param  ?array{id: string, name: string}  $orderPromotion
     * @param  ?array{id: string, name: string, coupon_id: ?string}  $freeShipping
     * @param  list<array{id: string, name: string, kind: string, amount: string}>  $promotions  product promotions then the order promotion
     * @param  ?array{code: string, applied: bool, reason: ?string, message: ?string, promotion_name: ?string}  $coupon
     * @param  list<array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}>  $redemptions  goods promotions used
     */
    public function __construct(
        public array $lines,
        public string $orderDiscount,
        public ?array $orderPromotion,
        public ?array $freeShipping,
        public array $promotions,
        public ?array $coupon,
        public ?string $couponMinSubtotal,
        public array $redemptions,
    ) {}

    public static function none(): self
    {
        return new self([], '0.00', null, null, [], null, null, []);
    }

    public function lineDiscount(int|string $key): string
    {
        return $this->lines[$key]['amount'] ?? '0.00';
    }

    /**
     * @return ?array{id: string, name: string}
     */
    public function linePromotion(int|string $key): ?array
    {
        return $this->lines[$key]['promotion'] ?? null;
    }

    /**
     * The redemption of the free-delivery promotion for a waived fee, or null when nothing
     * was waived.
     *
     * @return ?array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}
     */
    public function shippingRedemption(string $waived): ?array
    {
        if ($this->freeShipping === null || bccomp($waived, '0', 2) <= 0) {
            return null;
        }

        return [
            'promotion_id' => $this->freeShipping['id'],
            'coupon_id' => $this->freeShipping['coupon_id'],
            'name' => $this->freeShipping['name'],
            'kind' => 'shipping',
            'amount' => $waived,
        ];
    }
}
