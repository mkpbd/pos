<?php

namespace App\Modules\Promotions\Infrastructure;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Promotions\Application\Contracts\CatalogPromotions;
use App\Modules\Promotions\Domain\LineInput;
use App\Modules\Promotions\Domain\Offer;
use App\Modules\Promotions\Domain\PromotionEngine;
use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Carbon\CarbonImmutable;

class EloquentCatalogPromotions implements CatalogPromotions
{
    /** @var list<Offer>|null */
    private ?array $display = null;

    private ?string $currency = null;

    /** @var ?\WeakReference<object> the request the display cache belongs to */
    private ?\WeakReference $displayFor = null;

    public function __construct(
        private readonly PromotionOffers $offers,
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    public function bestFor(string $productId, ?string $brandId, ?string $categoryId, string $unitPrice): ?array
    {
        $offers = $this->displayOffers();
        if ($offers === []) {
            return null;
        }

        $currency = $this->currency();
        $result = PromotionEngine::apply([new LineInput(0, $productId, $brandId, $categoryId, '1', $unitPrice)], $offers, null, null, $this->offers->now(), $currency);
        $offer = $result->linePromotions[0] ?? null;
        if ($offer === null) {
            return null;
        }

        return [
            'id' => $offer->id,
            'name' => $offer->name,
            'type' => $offer->type->value,
            'value' => $offer->value,
            'ends_at' => $offer->endsAt === null ? null : CarbonImmutable::instance($offer->endsAt)->toIso8601String(),
            'show_countdown' => $offer->showCountdown,
            'price' => Money::of($unitPrice, $currency)->minus($result->lineDiscounts[0])->amount(),
        ];
    }

    public function countdownPromotions(?string $promotionId): array
    {
        $result = [];
        foreach ($this->offers->usableAutomatic(null, null) as $promotion) {
            if (! $promotion->show_countdown || $promotion->ends_at === null || ! $promotion->scope->isProductLevel()) {
                continue;
            }
            if ($promotionId !== null && $promotion->id !== $promotionId) {
                continue;
            }
            $targets = $this->offers->offer($promotion)->targetIds();
            $result[] = [
                'id' => $promotion->id,
                'ends_at' => $promotion->ends_at->toIso8601String(),
                'product_ids' => $promotion->scope === PromotionScope::Products ? $targets : [],
                'category_ids' => $promotion->scope === PromotionScope::Categories ? $targets : [],
                'brand_ids' => $promotion->scope === PromotionScope::Brands ? $targets : [],
            ];
        }
        usort($result, fn (array $a, array $b) => strcmp($a['ends_at'], $b['ends_at']) ?: strcmp($a['id'], $b['id']));

        return $result;
    }

    public function isCountdownPromotion(string $promotionId): bool
    {
        return Promotion::query()->whereKey($promotionId)
            ->where('trigger', PromotionTrigger::Automatic)
            ->where('show_countdown', true)
            ->exists();
    }

    public function nextChangeAt(): ?CarbonImmutable
    {
        $now = CarbonImmutable::now();
        $base = fn () => Promotion::query()->where('trigger', PromotionTrigger::Automatic)->where('is_active', true);
        $times = array_filter([$base()->where('starts_at', '>', $now)->min('starts_at'), $base()->where('ends_at', '>', $now)->min('ends_at')]);

        return $times === [] ? null : CarbonImmutable::createFromTimestamp(min(array_map(fn ($t) => CarbonImmutable::parse($t)->getTimestamp(), $times)));
    }

    /**
     * Live automatic product-scope promotions whose total usage limit is not reached
     * (per-customer limits are not known on a product page).
     *
     * @return list<Offer>
     */
    private function displayOffers(): array
    {
        $owner = app()->bound('request') ? app('request') : null;
        if ($this->displayFor?->get() !== $owner) {
            $this->display = null;
            $this->currency = null;
            $this->displayFor = $owner === null ? null : \WeakReference::create($owner);
        }
        if ($this->display === null) {
            $this->display = [];
            foreach ($this->offers->usableAutomatic(null, null) as $promotion) {
                if ($promotion->scope->isProductLevel()) {
                    $this->display[] = $this->offers->offer($promotion);
                }
            }
        }

        return $this->display;
    }

    private function currency(): string
    {
        return $this->currency ??= (string) ($this->organizations->summary($this->tenant->requireOrganization())['base_currency'] ?? config('pos.default_currency'));
    }
}
