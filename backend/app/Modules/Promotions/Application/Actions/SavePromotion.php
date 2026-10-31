<?php

namespace App\Modules\Promotions\Application\Actions;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Promotions\Domain\CouponCode;
use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Domain\PromotionType;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionTarget;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Instants;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Creates or changes a promotion with its targets. The form request checks the shape;
 * this checks the combination (on update: the stored values merged with the sent ones):
 *
 * - percent 0.01–100, fixed > 0; free shipping has no value and only the order scope;
 * - product scopes need 1–500 targets that exist in the organization (products not
 *   archived); the order scope has none;
 * - the countdown needs an end and is for automatic product-scope promotions only;
 * - the end is after the start; the trigger cannot change once the promotion has coupons.
 *
 * Failures are field errors (422 VALIDATION_FAILED).
 */
class SavePromotion
{
    private const FIELDS = [
        'name', 'description', 'type', 'value', 'scope', 'min_subtotal', 'max_discount', 'trigger', 'starts_at', 'ends_at',
        'show_countdown', 'is_active', 'usage_limit', 'usage_limit_per_customer',
    ];

    public const MAX_TARGETS = 500;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly ProductDirectory $products,
        private readonly CatalogDirectory $catalog,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated; `target_ids` replaces the targets; `coupon_code` (create only) adds a first code
     *
     * @throws ValidationException
     */
    public function __invoke(Promotion $promotion, array $data): Promotion
    {
        $creating = ! $promotion->exists;
        $data = Instants::normalize($data, ['starts_at', 'ends_at']);
        $attributes = array_intersect_key($data, array_flip(self::FIELDS));
        foreach (['name', 'description'] as $text) {
            if (array_key_exists($text, $attributes) && is_string($attributes[$text])) {
                $attributes[$text] = trim($attributes[$text]) === '' ? null : trim($attributes[$text]);
            }
        }
        foreach (['value', 'min_subtotal', 'max_discount'] as $money) {
            if (isset($attributes[$money])) {
                $attributes[$money] = Decimal::round((string) $attributes[$money], 2);
            }
        }

        $merged = $this->merged($promotion, $attributes);
        $type = PromotionType::from($merged['type']);
        $scope = PromotionScope::from($merged['scope']);
        $trigger = PromotionTrigger::from($merged['trigger']);

        $errors = [];
        if ($type === PromotionType::FreeShipping) {
            if ($scope !== PromotionScope::Order) {
                $errors['scope'][] = 'Free delivery applies to the whole order: choose the order scope.';
            }
            $attributes['value'] = '0.00';
            $attributes['max_discount'] = null;
        } elseif ($merged['value'] === null || Decimal::compare((string) $merged['value'], '0') <= 0) {
            $errors['value'][] = 'Enter a discount greater than zero.';
        } elseif ($type === PromotionType::Percent && Decimal::compare((string) $merged['value'], '100') > 0) {
            $errors['value'][] = 'A percentage discount cannot be more than 100%.';
        }

        if ($merged['show_countdown']) {
            if ($merged['ends_at'] === null) {
                $errors['show_countdown'][] = 'A countdown needs an end date and time.';
            }
            if ($trigger !== PromotionTrigger::Automatic || ! $scope->isProductLevel()) {
                $errors['show_countdown'][] = 'Only automatic promotions on products, categories or brands can show a countdown.';
            }
        }
        if ($merged['starts_at'] !== null && $merged['ends_at'] !== null && $merged['ends_at'] <= $merged['starts_at']) {
            $errors['ends_at'][] = 'The end must be after the start.';
        }
        if (! $creating && $trigger !== $promotion->trigger && $promotion->coupons()->exists()) {
            $errors['trigger'][] = 'This promotion has coupon codes: its trigger cannot change. Create a new promotion instead.';
        }
        if (isset($data['coupon_code']) && $trigger !== PromotionTrigger::Coupon) {
            $errors['coupon_code'][] = 'Only coupon promotions have codes.';
        }

        // Targets: replaced when sent, kept otherwise (dropped when the scope becomes the order).
        $targetIds = array_key_exists('target_ids', $data) ? array_values(array_unique((array) $data['target_ids'])) : null;
        $scopeChanged = ! $creating && $scope !== $promotion->scope;
        if ($scope === PromotionScope::Order) {
            if ($targetIds !== null && $targetIds !== []) {
                $errors['target_ids'][] = 'An order-wide promotion has no products, categories or brands.';
            }
            $targetIds = [];
        } else {
            if ($targetIds === null) {
                $targetIds = $creating || $scopeChanged ? [] : $promotion->targets()->pluck('target_id')->all();
            }
            if ($targetIds === []) {
                $errors['target_ids'][] = 'Choose at least one '.$scope->targetType().'.';
            } elseif (count($targetIds) > self::MAX_TARGETS) {
                $errors['target_ids'][] = 'Choose at most '.self::MAX_TARGETS.' '.$scope->value.'.';
            } elseif (($missing = $this->missingTargets($scope, $targetIds)) !== []) {
                $errors['target_ids'][] = 'Some selected '.$scope->value.' do not exist: '.implode(', ', $missing).'.';
            }
        }

        $code = null;
        if (isset($data['coupon_code'])) {
            $code = CouponCode::normalize((string) $data['coupon_code']);
            if (! CouponCode::isValid($code)) {
                $errors['coupon_code'][] = 'Use 3–40 letters, digits or hyphens.';
            } elseif (Coupon::query()->whereRaw('lower(code) = ?', [mb_strtolower($code)])->exists()) {
                $errors['coupon_code'][] = 'This code is already in use.';
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($promotion, $attributes, $targetIds, $scope, $code, $creating) {
            $before = $creating ? [] : $this->snapshot($promotion);
            $promotion->fill($attributes);
            $promotion->save();

            $organizationId = $this->tenant->requireOrganization();
            PromotionTarget::query()->where('promotion_id', $promotion->id)->delete();
            foreach ($targetIds as $targetId) {
                PromotionTarget::query()->create([
                    'organization_id' => $organizationId,
                    'promotion_id' => $promotion->id,
                    'target_type' => $scope->targetType(),
                    'target_id' => $targetId,
                ]);
            }
            if ($code !== null) {
                Coupon::query()->create(['promotion_id' => $promotion->id, 'code' => $code]);
            }

            $this->audit->record($creating ? 'promotion.created' : 'promotion.updated', $promotion, $before, $this->snapshot($promotion) + ['target_ids' => $targetIds]);

            return $promotion->refresh();
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function merged(Promotion $promotion, array $attributes): array
    {
        $current = $promotion->exists ? [
            'type' => $promotion->type->value,
            'scope' => $promotion->scope->value,
            'trigger' => $promotion->trigger->value,
            'value' => (string) $promotion->value,
            'starts_at' => $promotion->starts_at,
            'ends_at' => $promotion->ends_at,
            'show_countdown' => $promotion->show_countdown,
        ] : ['value' => null, 'starts_at' => null, 'ends_at' => null, 'show_countdown' => false];

        $merged = $attributes + $current;
        foreach (['type', 'scope', 'trigger'] as $enum) {
            if ($merged[$enum] instanceof \BackedEnum) {
                $merged[$enum] = $merged[$enum]->value;
            }
        }
        $merged['show_countdown'] = (bool) $merged['show_countdown'];

        return $merged;
    }

    /**
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function missingTargets(PromotionScope $scope, array $ids): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $found = match ($scope) {
            PromotionScope::Products => array_keys($this->products->products($organizationId, $ids)),
            PromotionScope::Categories => array_keys($this->catalog->describe($organizationId, ['categories' => $ids])['categories']),
            PromotionScope::Brands => array_keys($this->catalog->describe($organizationId, ['brands' => $ids])['brands']),
            PromotionScope::Order => $ids,
        };

        return array_values(array_diff($ids, array_map('strval', $found)));
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Promotion $promotion): array
    {
        return [
            'name' => $promotion->name,
            'type' => $promotion->type?->value,
            'value' => $promotion->value === null ? null : (string) $promotion->value,
            'scope' => $promotion->scope?->value,
            'trigger' => $promotion->trigger?->value,
            'min_subtotal' => $promotion->min_subtotal === null ? null : (string) $promotion->min_subtotal,
            'max_discount' => $promotion->max_discount === null ? null : (string) $promotion->max_discount,
            'starts_at' => $promotion->starts_at?->toIso8601String(),
            'ends_at' => $promotion->ends_at?->toIso8601String(),
            'show_countdown' => $promotion->show_countdown,
            'is_active' => $promotion->is_active,
            'usage_limit' => $promotion->usage_limit,
            'usage_limit_per_customer' => $promotion->usage_limit_per_customer,
        ];
    }
}
