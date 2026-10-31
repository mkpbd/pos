<?php

namespace App\Modules\Promotions\Application\Actions;

use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * Deletes a promotion that no order has used (its targets and codes go with it). A used
 * promotion stays for the order history: IN_USE — deactivate it instead.
 */
class DeletePromotion
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(Promotion $promotion): void
    {
        DB::transaction(function () use ($promotion) {
            if (PromotionRedemption::query()->where('promotion_id', $promotion->id)->exists()) {
                throw new BusinessRuleViolation('IN_USE', 'Orders have used this promotion, so it stays in their history. Deactivate it instead.');
            }
            $promotion->delete();
            $this->audit->record('promotion.deleted', $promotion, ['name' => $promotion->name, 'type' => $promotion->type->value]);
        });
    }
}
