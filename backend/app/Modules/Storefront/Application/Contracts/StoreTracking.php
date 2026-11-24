<?php

namespace App\Modules\Storefront\Application\Contracts;

/**
 * BD1c: the current store's (storefront host / tenant) ad pixels and pasted tracking code, for
 * the bootstrap (`tracking`: the public ids only) and the shell (the code, raw, on public pages
 * only). Implemented by the Marketing module; nulls when nothing is set.
 */
interface StoreTracking
{
    /**
     * @return array{meta_pixel_id: ?string, ga4_measurement_id: ?string, tiktok_pixel_id: ?string, head_code: ?string, body_code: ?string}
     */
    public function current(): array;
}
