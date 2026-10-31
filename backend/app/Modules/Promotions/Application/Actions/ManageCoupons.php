<?php

namespace App\Modules\Promotions\Application\Actions;

use App\Modules\Promotions\Domain\CouponCode;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Codes of a coupon promotion: add one, generate up to 500 random ones (optional prefix),
 * switch a code on/off or change its usage limit, delete an unused code.
 */
class ManageCoupons
{
    public const MAX_GENERATE = 500;

    public const GENERATED_LENGTH = 8;

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @throws ValidationException|BusinessRuleViolation
     */
    public function add(Promotion $promotion, string $code, ?int $usageLimit): Coupon
    {
        $this->assertCouponPromotion($promotion);
        $code = CouponCode::normalize($code);
        if (! CouponCode::isValid($code)) {
            throw ValidationException::withMessages(['code' => ['Use 3–40 letters, digits or hyphens.']]);
        }

        return DB::transaction(function () use ($promotion, $code, $usageLimit) {
            if (Coupon::query()->whereRaw('lower(code) = ?', [mb_strtolower($code)])->exists()) {
                throw ValidationException::withMessages(['code' => ['This code is already in use.']]);
            }
            $coupon = Coupon::query()->create(['promotion_id' => $promotion->id, 'code' => $code, 'usage_limit' => $usageLimit]);
            $this->audit->record('coupon.created', $coupon, new: ['code' => $code, 'promotion_id' => $promotion->id, 'usage_limit' => $usageLimit]);

            return $coupon;
        });
    }

    /**
     * @return list<Coupon>
     *
     * @throws ValidationException|BusinessRuleViolation
     */
    public function generate(Promotion $promotion, int $count, string $prefix, ?int $usageLimit): array
    {
        $this->assertCouponPromotion($promotion);
        $prefix = CouponCode::normalize($prefix);
        if ($count < 1 || $count > self::MAX_GENERATE) {
            throw ValidationException::withMessages(['generate' => ['Generate between 1 and '.self::MAX_GENERATE.' codes at a time.']]);
        }

        return DB::transaction(function () use ($promotion, $count, $prefix, $usageLimit) {
            $codes = [];
            $attempts = 0;
            while (count($codes) < $count) {
                if (++$attempts > $count * 10) {
                    throw new BusinessRuleViolation('CODES_EXHAUSTED', 'Could not generate enough unique codes. Try a different prefix.');
                }
                $batch = [];
                for ($i = count($codes); $i < $count; $i++) {
                    $batch[CouponCode::random($prefix, self::GENERATED_LENGTH)] = true;
                }
                $batch = array_diff_key($batch, $codes);
                $taken = Coupon::query()->whereIn(DB::raw('lower(code)'), array_map(mb_strtolower(...), array_keys($batch)))->pluck('code')->all();
                foreach (array_keys($batch) as $code) {
                    if (! in_array($code, $taken, true)) {
                        $codes[$code] = true;
                    }
                }
            }

            $coupons = [];
            foreach (array_slice(array_keys($codes), 0, $count) as $code) {
                $coupons[] = Coupon::query()->create(['promotion_id' => $promotion->id, 'code' => (string) $code, 'usage_limit' => $usageLimit]);
            }
            $this->audit->record('coupon.generated', $promotion, new: ['count' => $count, 'prefix' => $prefix, 'usage_limit' => $usageLimit]);

            return $coupons;
        });
    }

    /**
     * @param  array{is_active?: bool, usage_limit?: ?int}  $data
     */
    public function update(Coupon $coupon, array $data): Coupon
    {
        return DB::transaction(function () use ($coupon, $data) {
            $before = $coupon->only(['is_active', 'usage_limit']);
            $coupon->fill(array_intersect_key($data, array_flip(['is_active', 'usage_limit'])))->save();
            $this->audit->record('coupon.updated', $coupon, $before, $coupon->only(['is_active', 'usage_limit']));

            return $coupon;
        });
    }

    /**
     * @throws BusinessRuleViolation IN_USE when an order used the code
     */
    public function delete(Coupon $coupon): void
    {
        DB::transaction(function () use ($coupon) {
            if ($coupon->used_count > 0 || PromotionRedemption::query()->where('coupon_id', $coupon->id)->exists()) {
                throw new BusinessRuleViolation('IN_USE', 'This code has been used by orders and cannot be deleted. Deactivate it instead.');
            }
            $coupon->delete();
            $this->audit->record('coupon.deleted', $coupon, old: ['code' => $coupon->code, 'promotion_id' => $coupon->promotion_id]);
        });
    }

    private function assertCouponPromotion(Promotion $promotion): void
    {
        if ($promotion->trigger !== PromotionTrigger::Coupon) {
            throw new BusinessRuleViolation('NOT_A_COUPON_PROMOTION', 'Codes can only be added to coupon promotions.');
        }
    }
}
