<?php

namespace App\Modules\Shared\Application\Contracts;

use Closure;
use DateTimeInterface;

/**
 * The organization's "storefront content version" (ADR-012, E12): a counter bumped after
 * every committed write that changes what the public storefront shows (products, variants,
 * prices, stock at the fulfilment store, listings, categories, brands, promotions, approved
 * reviews, banners, sections, menus, theme, settings, pages, blog). Expensive public read
 * models are cached under keys that contain the version, so a bump makes every cached
 * entry of that organization unreachable at once (no cache tags needed; works on the
 * database, file, array and Redis stores). Entries also expire after a safety TTL.
 *
 * Implemented by the Storefront module (it knows the fulfilment store).
 */
interface StorefrontContentVersion
{
    /** Safety-net lifetime of cached entries, in seconds. */
    public const TTL = 600;

    public function current(string $organizationId): int;

    /**
     * Bumps the version once the surrounding transaction commits (at once outside one;
     * never when it rolls back).
     */
    public function bump(string $organizationId): void;

    /**
     * A stock movement at $storeId: bumps only when it is the storefront's fulfilment store.
     */
    public function stockChanged(string $organizationId, string $storeId): void;

    /**
     * The cached value of $key for the organization's current version, built by $build on a
     * miss and kept until the next bump, the safety TTL or $until (the next scheduled change
     * of the content, e.g. a banner going live), whichever comes first. A closure for $until
     * is only called on a miss.
     *
     * @template T
     *
     * @param  Closure(): T  $build
     * @param  DateTimeInterface|(Closure(): ?DateTimeInterface)|null  $until
     * @return T
     */
    public function remember(string $organizationId, string $key, Closure $build, DateTimeInterface|Closure|null $until = null): mixed;
}
