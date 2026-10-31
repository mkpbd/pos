<?php

namespace App\Modules\Promotions\Infrastructure;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Promotions\Domain\CouponCode;
use App\Modules\Promotions\Domain\CouponReason;
use App\Modules\Promotions\Domain\Offer;
use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Infrastructure\Models\PromotionTarget;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Loads promotions of the organization in context as engine offers: targets resolved
 * (categories with every sub-category, from the Catalog tree), usage counted from the
 * redemptions. Caches the live automatic promotions and the category tree for its lifetime.
 */
class PromotionOffers
{
    /** @var list<Promotion>|null */
    private ?array $automatic = null;

    /** @var array<string, list<string>>|null category id => child ids */
    private ?array $children = null;

    /** @var array<string, list<string>> promotion id => resolved target ids */
    private array $targets = [];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CatalogDirectory $catalog,
    ) {}

    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now();
    }

    /**
     * Active automatic promotions inside their schedule.
     *
     * @return list<Promotion>
     */
    public function liveAutomatic(): array
    {
        if ($this->automatic === null) {
            $now = $this->now();
            $this->automatic = Promotion::query()
                ->where('trigger', PromotionTrigger::Automatic)
                ->where('is_active', true)
                ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
                ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', $now))
                ->orderBy('id')
                ->get()->all();
            $this->loadTargets($this->automatic);
        }

        return $this->automatic;
    }

    /**
     * The live automatic promotions the shopper may still use: total and per-customer
     * limits not reached (per customer: by customer id, else by e-mail when known).
     *
     * @return list<Promotion>
     */
    public function usableAutomatic(?string $customerId, ?string $email): array
    {
        $promotions = $this->liveAutomatic();
        $limited = array_values(array_filter($promotions, fn (Promotion $p) => $p->usage_limit !== null || $p->usage_limit_per_customer !== null));
        if ($limited === []) {
            return $promotions;
        }

        $ids = array_map(fn (Promotion $p) => $p->id, $limited);
        $totals = $this->usage($ids);
        $own = $this->customerUsage($ids, $customerId, $email);

        return array_values(array_filter($promotions, fn (Promotion $p) => ! $this->limitReached($p, $totals[$p->id] ?? 0, $own[$p->id] ?? 0, $customerId !== null || $email !== null)));
    }

    /**
     * The coupon with the given code and why it cannot be used (null = it can, as far as
     * the code and the limits go; the engine checks schedule and cart).
     *
     * @return array{0: ?Coupon, 1: ?CouponReason}
     */
    public function coupon(string $code, ?string $customerId, ?string $email): array
    {
        $code = CouponCode::normalize($code);
        if (! CouponCode::isValid($code)) {
            return [null, CouponReason::NotFound];
        }

        /** @var Coupon|null $coupon */
        $coupon = Coupon::query()->with('promotion')->whereRaw('lower(code) = ?', [mb_strtolower($code)])->first();
        $promotion = $coupon?->promotion;
        if ($coupon === null || $promotion === null || ! $coupon->is_active || ! $promotion->is_active || $promotion->trigger !== PromotionTrigger::Coupon) {
            return [null, CouponReason::NotFound];
        }
        $this->loadTargets([$promotion]);

        if ($coupon->usage_limit !== null && $coupon->used_count >= $coupon->usage_limit) {
            return [$coupon, CouponReason::UsageLimitReached];
        }
        if ($promotion->usage_limit !== null && ($this->usage([$promotion->id])[$promotion->id] ?? 0) >= $promotion->usage_limit) {
            return [$coupon, CouponReason::UsageLimitReached];
        }
        if ($promotion->usage_limit_per_customer !== null && ($customerId !== null || $email !== null)
            && ($this->customerUsage([$promotion->id], $customerId, $email)[$promotion->id] ?? 0) >= $promotion->usage_limit_per_customer) {
            return [$coupon, CouponReason::CustomerLimitReached];
        }

        return [$coupon, null];
    }

    public function offer(Promotion $promotion, bool $isCoupon = false): Offer
    {
        if (! array_key_exists($promotion->id, $this->targets)) {
            $this->loadTargets([$promotion]);
        }

        return new Offer(
            id: $promotion->id,
            name: $promotion->name,
            type: $promotion->type,
            value: (string) $promotion->value,
            scope: $promotion->scope,
            targetIds: $this->targets[$promotion->id] ?? [],
            minSubtotal: $promotion->min_subtotal === null ? null : (string) $promotion->min_subtotal,
            maxDiscount: $promotion->max_discount === null ? null : (string) $promotion->max_discount,
            startsAt: $promotion->starts_at,
            endsAt: $promotion->ends_at,
            isCoupon: $isCoupon,
            showCountdown: $promotion->show_countdown,
        );
    }

    /**
     * Redemptions per promotion.
     *
     * @param  list<string>  $promotionIds
     * @return array<string, int>
     */
    public function usage(array $promotionIds): array
    {
        if ($promotionIds === []) {
            return [];
        }

        return PromotionRedemption::query()->whereIn('promotion_id', $promotionIds)
            ->groupBy('promotion_id')->select('promotion_id', DB::raw('count(*) as uses'))
            ->pluck('uses', 'promotion_id')->map(fn ($n) => (int) $n)->all();
    }

    /**
     * Redemptions per promotion by this shopper: the customer's, else the e-mail's.
     *
     * @param  list<string>  $promotionIds
     * @return array<string, int>
     */
    public function customerUsage(array $promotionIds, ?string $customerId, ?string $email): array
    {
        if ($promotionIds === [] || ($customerId === null && $email === null)) {
            return [];
        }

        return PromotionRedemption::query()->whereIn('promotion_id', $promotionIds)
            ->when($customerId !== null,
                fn (Builder $q) => $q->where('customer_id', $customerId),
                fn (Builder $q) => $q->where('email', mb_strtolower(trim((string) $email))))
            ->groupBy('promotion_id')->select('promotion_id', DB::raw('count(*) as uses'))
            ->pluck('uses', 'promotion_id')->map(fn ($n) => (int) $n)->all();
    }

    private function limitReached(Promotion $p, int $total, int $own, bool $knowsShopper): bool
    {
        return ($p->usage_limit !== null && $total >= $p->usage_limit)
            || ($knowsShopper && $p->usage_limit_per_customer !== null && $own >= $p->usage_limit_per_customer);
    }

    /**
     * @param  list<Promotion>  $promotions
     */
    private function loadTargets(array $promotions): void
    {
        $ids = [];
        foreach ($promotions as $promotion) {
            if (! array_key_exists($promotion->id, $this->targets)) {
                $this->targets[$promotion->id] = [];
                if ($promotion->scope !== PromotionScope::Order) {
                    $ids[] = $promotion->id;
                }
            }
        }
        if ($ids === []) {
            return;
        }

        $rows = PromotionTarget::query()->whereIn('promotion_id', $ids)->get(['promotion_id', 'target_type', 'target_id']);
        foreach ($rows as $row) {
            if ($row->target_type === 'category') {
                array_push($this->targets[$row->promotion_id], ...$this->withDescendants($row->target_id));
            } else {
                $this->targets[$row->promotion_id][] = $row->target_id;
            }
        }
        foreach ($ids as $id) {
            $this->targets[$id] = array_values(array_unique($this->targets[$id]));
        }
    }

    /**
     * @return list<string>
     */
    private function withDescendants(string $categoryId): array
    {
        if ($this->children === null) {
            $this->children = [];
            foreach ($this->catalog->categories($this->tenant->requireOrganization()) as $category) {
                if ($category['parent_id'] !== null) {
                    $this->children[$category['parent_id']][] = $category['id'];
                }
            }
        }

        $result = [];
        $queue = [$categoryId];
        while ($queue !== []) {
            $id = array_shift($queue);
            if (in_array($id, $result, true)) {
                continue;
            }
            $result[] = $id;
            array_push($queue, ...($this->children[$id] ?? []));
        }

        return $result;
    }
}
