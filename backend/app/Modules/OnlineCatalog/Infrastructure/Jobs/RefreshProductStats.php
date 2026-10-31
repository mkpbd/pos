<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Jobs;

use App\Modules\OnlineCatalog\Infrastructure\ReadModels\ProductStatsProjection;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Rebuilds the popularity projection (product_stats) for one organization or all of them.
 * Idempotent: every run replaces the organization's rows.
 */
class RefreshProductStats implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $uniqueFor = 3600;

    public function __construct(public readonly ?string $organizationId = null) {}

    public function uniqueId(): string
    {
        return $this->organizationId ?? 'all';
    }

    public function handle(ProductStatsProjection $projection): int
    {
        return $projection->rebuild($this->organizationId);
    }
}
