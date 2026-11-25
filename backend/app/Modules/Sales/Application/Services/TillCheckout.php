<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SalePromotion;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Validation\ValidationException;

/**
 * POS1a: the till parts of checkout, inside the sale's transaction.
 *
 * - price(): prices the cart, then locks the usage-limited promotions and the coupon it used
 *   and prices again, so the limits are counted under the locks (as web order placement does).
 * - settle(): records the redemptions for the sale, snapshots its promotions
 *   (`sale_promotions`) and consumes the managers' approvals it used (APPROVAL_INVALID when
 *   one was used meanwhile — the whole sale rolls back).
 */
class TillCheckout
{
    public function __construct(
        private readonly CartPricer $pricer,
        private readonly PromotionRedemptions $redemptions,
    ) {}

    /**
     * @param  array<string, mixed>  $store
     * @param  array<string, mixed>  $cart
     * @return array{0: array<string, mixed>, 1: array<string, array<string, mixed>>, 2: ?array<string, mixed>, 3: array<string, mixed>}
     *
     * @throws ValidationException
     */
    public function price(TenantUser $actor, array $store, array $cart): array
    {
        $result = $this->pricer->priceForCheckout($actor, $store, $cart);
        $lockedPromotions = [];
        $lockedCoupons = [];
        for ($round = 0; $round < 3; $round++) {
            $used = $result[3]['redemptions'];
            $promotionIds = array_values(array_diff(array_unique(array_column($used, 'promotion_id')), $lockedPromotions));
            $couponIds = array_values(array_diff(array_unique(array_filter(array_column($used, 'coupon_id'))), $lockedCoupons));
            if ($promotionIds === [] && $couponIds === []) {
                break;
            }
            $locked = $this->redemptions->lock($promotionIds, $couponIds[0] ?? null);
            array_push($lockedPromotions, ...$promotionIds);
            array_push($lockedCoupons, ...$couponIds);
            if (! $locked) {
                break;
            }
            $result = $this->pricer->priceForCheckout($actor, $store, $cart);
        }

        return $result;
    }

    /**
     * @param  array{price_approvals: array<int, array{id: string}>, discount_approval: ?array{id: string}, redemptions: list<array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}>, coupon_code: ?string}  $till
     * @param  array<string, mixed>|null  $customer
     */
    public function settle(Sale $sale, array $till, ?array $customer): void
    {
        if ($till['redemptions'] !== []) {
            $this->redemptions->recordForSale($sale->id, $sale->number, $customer['id'] ?? null, $customer['phone'] ?? null, $till['redemptions']);
            foreach ($till['redemptions'] as $redemption) {
                SalePromotion::query()->create([
                    'organization_id' => $sale->organization_id,
                    'sale_id' => $sale->id,
                    'promotion_id' => $redemption['promotion_id'],
                    'name' => $redemption['name'],
                    'kind' => $redemption['kind'],
                    'amount' => $redemption['amount'],
                    'created_at' => $sale->sold_at,
                ]);
            }
        }

        // One approval may cover several lines of its variant: consumed once.
        $approvalIds = array_values(array_unique(array_filter([
            ...array_map(fn (array $a) => $a['id'], $till['price_approvals']),
            $till['discount_approval']['id'] ?? null,
        ])));
        if ($approvalIds !== []) {
            $approvals = app(TillApprovals::class);
            foreach ($approvalIds as $approvalId) {
                $approvals->consume($approvalId, $sale->id);
            }
        }
    }
}
