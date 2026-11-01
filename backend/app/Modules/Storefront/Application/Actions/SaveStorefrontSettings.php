<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use Illuminate\Support\Facades\DB;

class SaveStorefrontSettings
{
    private const AUDITED = ['is_enabled', 'site_name', 'meta_description', 'fulfilment_store_id', 'guest_checkout_enabled', 'return_window_days'];

    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly BranchDirectory $branches,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{is_enabled?: bool, site_name?: string, meta_description?: ?string, fulfilment_store_id?: ?string, guest_checkout_enabled?: bool, return_window_days?: int}  $attributes
     */
    public function __invoke(array $attributes): StorefrontSettings
    {
        $storeId = $attributes['fulfilment_store_id'] ?? null;
        if ($storeId !== null) {
            $store = $this->branches->store($storeId, $this->tenant->requireOrganization());
            if ($store === null || ! $store['is_active']) {
                throw new BusinessRuleViolation('STORE_NOT_FOUND', 'Choose an active store of your organization as the fulfilment store.');
            }
        }

        return DB::transaction(function () use ($attributes) {
            $settings = $this->config->settings();
            $before = $settings->exists ? $settings->only(self::AUDITED) : [];

            $settings->fill($attributes);
            if ($settings->is_enabled && ! StorefrontDomain::query()->exists()) {
                throw new BusinessRuleViolation('STOREFRONT_DOMAIN_REQUIRED', 'Add a domain before opening the storefront.');
            }
            $settings->save();

            [$old, $new] = Changes::between($before, $settings->only(self::AUDITED));
            if ($new !== []) {
                $this->audit->record('storefront.settings_updated', $settings, $old, $new);
            }

            return $settings;
        });
    }
}
