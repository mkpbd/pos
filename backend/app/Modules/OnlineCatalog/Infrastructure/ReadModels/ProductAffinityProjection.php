<?php

namespace App\Modules\OnlineCatalog\Infrastructure\ReadModels;

use App\Modules\OnlineCatalog\Domain\CoPurchaseCounter;
use App\Modules\Orders\Application\Contracts\OrderBaskets;
use App\Modules\Sales\Application\Contracts\SaleBaskets;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * P1b: rebuilds product_affinities (co-purchase scores) for one organization from the web
 * orders (Orders' OrderBaskets) and POS sales (Sales' SaleBaskets) of the last WINDOW_DAYS days.
 * Idempotent: every run replaces the organization's rows in one transaction and records the run
 * (product_affinity_runs, the organization's local day), then refreshes the storefront cache.
 */
class ProductAffinityProjection
{
    public const WINDOW_DAYS = 180;

    public function __construct(
        private readonly OrderBaskets $orders,
        private readonly SaleBaskets $sales,
        private readonly StorefrontContentVersion $version,
    ) {}

    /**
     * @param  string  $localDate  the organization's local day of this run (Y-m-d)
     * @return int pairs stored (both directions)
     */
    public function rebuild(string $organizationId, string $localDate): int
    {
        $now = CarbonImmutable::now();
        $since = $now->subDays(self::WINDOW_DAYS);

        $counter = new CoPurchaseCounter;
        foreach ($this->orders->since($organizationId, $since) as $basket) {
            $counter->add($basket);
        }
        foreach ($this->sales->since($organizationId, $since) as $basket) {
            $counter->add($basket);
        }
        $rows = array_map(fn (array $row) => $row + ['organization_id' => $organizationId, 'computed_at' => $now], $counter->affinities());

        DB::transaction(function () use ($organizationId, $rows, $now, $localDate) {
            DB::table('product_affinities')->where('organization_id', $organizationId)->delete();
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('product_affinities')->insert($chunk);
            }
            DB::table('product_affinity_runs')->upsert(
                [['organization_id' => $organizationId, 'local_date' => $localDate, 'pairs' => count($rows), 'computed_at' => $now]],
                ['organization_id'],
                ['local_date', 'pairs', 'computed_at'],
            );
            // "Frequently bought together" on product pages reads these.
            $this->version->bump($organizationId);
        });

        return count($rows);
    }

    /**
     * Whether the organization's affinities were already computed on this local day.
     */
    public function ranOn(string $organizationId, string $localDate): bool
    {
        $last = DB::table('product_affinity_runs')->where('organization_id', $organizationId)->value('local_date');

        return is_string($last) && substr($last, 0, 10) >= $localDate;
    }

    /**
     * Related product ids of a product by score (highest first), at least `$minScore`.
     *
     * @return list<string>
     */
    public function relatedIds(string $organizationId, string $productId, int $minScore, int $limit): array
    {
        return DB::table('product_affinities')
            ->where('organization_id', $organizationId)
            ->where('product_id', $productId)
            ->where('score', '>=', $minScore)
            ->orderByDesc('score')->orderBy('related_product_id')
            ->limit($limit)
            ->pluck('related_product_id')->map(fn ($id) => (string) $id)->all();
    }
}
