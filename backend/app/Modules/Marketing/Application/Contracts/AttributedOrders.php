<?php

namespace App\Modules\Marketing\Application\Contracts;

use Carbon\CarbonImmutable;

/**
 * P2a: web orders grouped by their campaign attribution, for campaign stats (declared here,
 * implemented by the Orders module; organization from the tenant context). Money as NUMERIC
 * strings; `lost` orders are the cancelled and failed ones (not counted as revenue).
 */
interface AttributedOrders
{
    /**
     * Orders placed in [$from, $to) grouped by the local day ($timezone), short link code,
     * utm_campaign, utm_source, utm_medium, landing path (the attribution's first landing path,
     * else the page an order form was on) and whether they were lost.
     *
     * @return list<array{day: string, short_link: ?string, utm_campaign: ?string, source: ?string, medium: ?string,
     *   landing_path: ?string, lost: bool, orders: int, items: string, revenue: string}>
     */
    public function groups(CarbonImmutable $from, CarbonImmutable $to, string $timezone): array;
}
