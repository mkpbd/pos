<?php

namespace App\Modules\Promotions\Presentation\Http\Support;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Shapes promotions, coupon codes and redemptions for the staff API.
 */
class PromotionPresenter
{
    public const COUPON_PREVIEW = 20;

    public function __construct(
        private readonly ProductDirectory $products,
        private readonly CatalogDirectory $catalog,
        private readonly CustomerDirectory $customers,
    ) {}

    /**
     * A list row. Expects `coupons_count`, `redemptions_count` and `redemptions_sum_amount`
     * (loaded by the caller; computed when missing).
     *
     * @return array<string, mixed>
     */
    public static function row(Promotion $p): array
    {
        $couponCount = $p->getAttribute('coupons_count') ?? $p->coupons()->count();
        $redemptionCount = $p->getAttribute('redemptions_count') ?? $p->redemptions()->count();
        $sum = array_key_exists('redemptions_sum_amount', $p->getAttributes()) ? $p->getAttribute('redemptions_sum_amount') : $p->redemptions()->sum('amount');

        return [
            'id' => $p->id,
            'name' => $p->name,
            'type' => $p->type->value,
            'value' => (string) $p->value,
            'scope' => $p->scope->value,
            'trigger' => $p->trigger->value,
            'starts_at' => $p->starts_at?->toIso8601String(),
            'ends_at' => $p->ends_at?->toIso8601String(),
            'show_countdown' => $p->show_countdown,
            'is_active' => $p->is_active,
            'state' => $p->state()->value,
            'coupon_count' => (int) $couponCount,
            'redemption_count' => (int) $redemptionCount,
            'discount_total' => Decimal::round((string) ($sum ?? '0'), 2),
        ];
    }

    /**
     * Everything the editor needs: the row, the remaining fields, the targets with names
     * (`[{id, name}]`; deleted records drop out) and the first 20 codes.
     *
     * @return array<string, mixed>
     */
    public function detail(Promotion $p): array
    {
        $p->loadCount(['coupons', 'redemptions'])->loadSum('redemptions', 'amount');
        $ids = $p->targets()->pluck('target_id')->all();
        $org = $p->organization_id;
        $names = match ($p->scope) {
            PromotionScope::Products => $this->products->products($org, $ids),
            PromotionScope::Categories => $this->catalog->describe($org, ['categories' => $ids])['categories'],
            PromotionScope::Brands => $this->catalog->describe($org, ['brands' => $ids])['brands'],
            PromotionScope::Order => [],
        };
        $targets = [];
        foreach ($ids as $id) {
            if (isset($names[$id])) {
                $targets[] = ['id' => $id, 'name' => $names[$id]['name']];
            }
        }
        usort($targets, fn (array $a, array $b) => strcasecmp($a['name'], $b['name']));

        return self::row($p) + [
            'description' => $p->description,
            'min_subtotal' => $p->min_subtotal === null ? null : (string) $p->min_subtotal,
            'max_discount' => $p->max_discount === null ? null : (string) $p->max_discount,
            'usage_limit' => $p->usage_limit,
            'usage_limit_per_customer' => $p->usage_limit_per_customer,
            'targets' => $targets,
            'coupons_preview' => $p->coupons()->orderBy('created_at')->orderBy('code')->limit(self::COUPON_PREVIEW)->pluck('code')->all(),
            'created_at' => $p->created_at?->toIso8601String(),
            'updated_at' => $p->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{id: string, code: string, usage_limit: ?int, used_count: int, is_active: bool, created_at: ?string}
     */
    public static function coupon(Coupon $c): array
    {
        return [
            'id' => $c->id,
            'code' => $c->code,
            'usage_limit' => $c->usage_limit,
            'used_count' => (int) $c->used_count,
            'is_active' => (bool) $c->is_active,
            'created_at' => $c->created_at?->toIso8601String(),
        ];
    }

    /**
     * @param  list<PromotionRedemption>  $rows
     * @return list<array<string, mixed>>
     */
    public function redemptions(string $organizationId, array $rows): array
    {
        $customers = $this->customers->summaries($organizationId, array_values(array_unique(array_filter(array_map(fn (PromotionRedemption $r) => $r->customer_id, $rows)))));
        $codes = Coupon::query()->whereIn('id', array_values(array_unique(array_filter(array_map(fn (PromotionRedemption $r) => $r->coupon_id, $rows)))))->pluck('code', 'id')->all();

        return array_map(fn (PromotionRedemption $r) => [
            'id' => $r->id,
            'order_id' => $r->order_id,
            'order_number' => $r->order_number,
            'customer' => $r->customer_id === null || ! isset($customers[$r->customer_id]) ? null : ['id' => $r->customer_id, 'name' => $customers[$r->customer_id]['name']],
            'email' => $r->email,
            'kind' => $r->kind,
            'amount' => (string) $r->amount,
            'coupon_code' => $r->coupon_id === null ? null : ($codes[$r->coupon_id] ?? null),
            'created_at' => $r->created_at->toIso8601String(),
        ], $rows);
    }
}
