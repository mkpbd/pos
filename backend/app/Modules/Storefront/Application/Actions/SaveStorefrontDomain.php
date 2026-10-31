<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Support\Facades\DB;

/**
 * Hosts are stored lower-case. The first domain of an organization becomes primary;
 * making another one primary demotes the previous one.
 */
class SaveStorefrontDomain
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{host?: string, is_primary?: bool}  $attributes
     */
    public function __invoke(StorefrontDomain $domain, array $attributes): StorefrontDomain
    {
        return DB::transaction(function () use ($domain, $attributes) {
            $creating = ! $domain->exists;
            if (isset($attributes['host'])) {
                $attributes['host'] = mb_strtolower(trim($attributes['host']));
            }

            $domain->fill($attributes);
            if ($creating && ! StorefrontDomain::query()->exists()) {
                $domain->is_primary = true;
            }
            if ($domain->is_primary) {
                StorefrontDomain::query()
                    ->where('is_primary', true)
                    ->when($domain->exists, fn ($query) => $query->whereKeyNot($domain->id))
                    ->update(['is_primary' => false]);
            }
            $domain->save();

            $this->audit->record($creating ? 'storefront.domain_added' : 'storefront.domain_updated', $domain, new: [
                'host' => $domain->host,
                'is_primary' => $domain->is_primary,
            ]);

            return $domain;
        });
    }
}
