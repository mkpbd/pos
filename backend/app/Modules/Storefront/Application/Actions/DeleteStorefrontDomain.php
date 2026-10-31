<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Support\Facades\DB;

/**
 * An open storefront keeps at least one domain. Removing the primary domain promotes
 * the oldest remaining one.
 */
class DeleteStorefrontDomain
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(StorefrontDomain $domain): void
    {
        DB::transaction(function () use ($domain) {
            $remaining = StorefrontDomain::query()->whereKeyNot($domain->id)->orderBy('created_at')->lockForUpdate()->get();
            if ($remaining->isEmpty() && $this->config->settings()->is_enabled) {
                throw new BusinessRuleViolation('STOREFRONT_DOMAIN_REQUIRED', 'An open storefront needs at least one domain. Close the storefront first.');
            }

            $domain->delete();
            if ($domain->is_primary && $remaining->isNotEmpty()) {
                $remaining->first()->update(['is_primary' => true]);
            }

            $this->audit->record('storefront.domain_removed', $domain, ['host' => $domain->host]);
        });
    }
}
