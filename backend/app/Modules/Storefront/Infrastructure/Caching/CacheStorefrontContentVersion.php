<?php

namespace App\Modules\Storefront\Infrastructure\Caching;

use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\DB;

/**
 * Version counters in the default cache store (ADR-012, E12).
 *
 * Keys: `storefront:{organization}:version` holds the counter; cached read models live
 * under `storefront:{organization}:v{version}:{locale}:{key}` — E12b: the request's
 * language (LocaleContext) is part of every key, so a Bangla read never answers an English
 * one or the other way round. A missing counter (never set, or
 * evicted) starts at the current time in milliseconds, so it never falls back to a value
 * an older entry was stored under.
 */
class CacheStorefrontContentVersion implements StorefrontContentVersion
{
    public function __construct(
        private readonly Repository $cache,
        private readonly LocaleContext $locale,
    ) {}

    public function current(string $organizationId): int
    {
        $key = $this->versionKey($organizationId);
        $version = $this->cache->get($key);
        if (! is_numeric($version)) {
            $this->cache->add($key, (int) floor(microtime(true) * 1000));
            $version = $this->cache->get($key);
        }

        return (int) $version;
    }

    public function bump(string $organizationId): void
    {
        DB::afterCommit(function () use ($organizationId) {
            $key = $this->versionKey($organizationId);
            if ($this->cache->increment($key) === false) {
                // Stores that cannot increment a missing key (database): start a fresh counter.
                $this->cache->forever($key, (int) floor(microtime(true) * 1000));
            }
        });
    }

    public function stockChanged(string $organizationId, string $storeId): void
    {
        DB::afterCommit(function () use ($organizationId, $storeId) {
            $fulfilment = DB::table('storefront_settings')->where('organization_id', $organizationId)->value('fulfilment_store_id');
            if ($fulfilment === $storeId) {
                $this->bump($organizationId);
            }
        });
    }

    public function remember(string $organizationId, string $key, Closure $build, DateTimeInterface|Closure|null $until = null): mixed
    {
        $cacheKey = 'storefront:'.$organizationId.':v'.$this->current($organizationId).':'.$this->locale->current().':'.$key;

        // The stored envelope tells a cached null apart from a miss.
        $hit = $this->cache->get($cacheKey);
        if (is_array($hit) && array_key_exists('value', $hit)) {
            return $hit['value'];
        }

        // The expiry is decided before building, so a change scheduled while building is not missed.
        $until = $until instanceof Closure ? $until() : $until;
        $ttl = self::TTL;
        if ($until !== null) {
            $ttl = min($ttl, max(1, CarbonImmutable::instance($until)->getTimestamp() - CarbonImmutable::now()->getTimestamp()));
        }
        $value = $build();
        $this->cache->put($cacheKey, ['value' => $value], $ttl);

        return $value;
    }

    private function versionKey(string $organizationId): string
    {
        return 'storefront:'.$organizationId.':version';
    }
}
