<?php

namespace App\Modules\Marketing\Infrastructure;

use App\Modules\Marketing\Application\Queries\TrackingConfig;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Contracts\StoreTracking;

/**
 * BD1c: the store's pixels and tracking code from the tracking settings (declared by Storefront).
 */
class EloquentStoreTracking implements StoreTracking
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly TrackingConfig $config,
    ) {}

    public function current(): array
    {
        $settings = $this->config->settings($this->tenant->requireOrganization());

        return [
            'meta_pixel_id' => $settings->meta_pixel_id,
            'ga4_measurement_id' => $settings->ga4_measurement_id,
            'tiktok_pixel_id' => $settings->tiktok_pixel_id,
            'head_code' => $settings->head_code,
            'body_code' => $settings->body_code,
        ];
    }
}
