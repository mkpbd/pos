<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * P2a: the marketing campaign an order's attribution belongs to (declared here, implemented by
 * the Marketing module; organization from the tenant context): the short link's campaign,
 * else the campaign with the attribution's `utm_campaign`.
 */
interface OrderCampaigns
{
    /**
     * @param  array<array-key, array<string, string>|null>  $attributions  order attributions, any keys
     * @return array<array-key, array{id: string, name: string}|null> the campaign per input key
     */
    public function campaignsFor(array $attributions): array;
}
