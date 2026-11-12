<?php

namespace App\Modules\Promotions\Infrastructure;

use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Domain\PromotionType;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use Illuminate\Database\Eloquent\Builder;

class EloquentPromotionShowcase implements PromotionShowcase
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(private readonly LocaleContext $locale) {}

    public function countdowns(array $ids): array
    {
        $result = [];
        foreach ($this->query($ids)?->where('trigger', PromotionTrigger::Automatic)->where('show_countdown', true)->get() ?? [] as $promotion) {
            $result[$promotion->id] = [
                'id' => $promotion->id,
                'name' => $this->name($promotion),
                'starts_at' => $promotion->starts_at?->toIso8601String(),
                'ends_at' => $promotion->ends_at?->toIso8601String(),
                'state' => $promotion->state()->value,
            ];
        }

        return $result;
    }

    public function discounts(array $ids): array
    {
        $promotions = $this->query($ids)?->whereIn('type', [PromotionType::Percent, PromotionType::Fixed])->get() ?? collect();
        $couponIds = $promotions->where('trigger', PromotionTrigger::Coupon)->pluck('id')->all();
        $codes = [];
        if ($couponIds !== []) {
            $coupons = Coupon::query()->whereIn('promotion_id', $couponIds)->where('is_active', true)
                ->where(fn (Builder $q) => $q->whereNull('usage_limit')->orWhereColumn('used_count', '<', 'usage_limit'))
                ->orderBy('created_at')->orderBy('code')->get(['promotion_id', 'code']);
            foreach ($coupons as $coupon) {
                $codes[$coupon->promotion_id] ??= $coupon->code;
            }
        }

        $result = [];
        foreach ($promotions as $promotion) {
            $result[$promotion->id] = [
                'id' => $promotion->id,
                'name' => $this->name($promotion),
                'kind' => $promotion->type->value,
                'value' => (string) $promotion->value,
                'coupon_code' => $codes[$promotion->id] ?? null,
                'min_subtotal' => $promotion->min_subtotal === null ? null : (string) $promotion->min_subtotal,
                'starts_at' => $promotion->starts_at?->toIso8601String(),
                'ends_at' => $promotion->ends_at?->toIso8601String(),
                'state' => $promotion->state()->value,
            ];
        }

        return $result;
    }

    public function claimed(array $ids): array
    {
        $limits = $this->query($ids)?->whereNotNull('usage_limit')->pluck('usage_limit', 'id')->all() ?? [];
        if ($limits === []) {
            return [];
        }
        $used = PromotionRedemption::query()->whereIn('promotion_id', array_keys($limits))
            ->groupBy('promotion_id')->selectRaw('promotion_id, count(*) as n')->pluck('n', 'promotion_id')->all();

        $result = [];
        foreach ($limits as $id => $limit) {
            $result[$id] = ['used' => min((int) $limit, (int) ($used[$id] ?? 0)), 'limit' => (int) $limit];
        }

        return $result;
    }

    /**
     * @param  list<string>  $ids
     * @return Builder<Promotion>|null null when no id is well-formed
     */
    private function query(array $ids): ?Builder
    {
        $ids = array_values(array_unique(array_filter(array_map(fn ($id) => is_string($id) ? strtolower($id) : null, $ids), fn (?string $id) => $id !== null && preg_match(self::UUID, $id) === 1)));

        return $ids === [] ? null : Promotion::query()->whereIn('id', $ids);
    }

    private function name(Promotion $promotion): string
    {
        return (string) Translations::pick($promotion, 'name', $this->locale->current());
    }
}
