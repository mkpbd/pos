<?php

namespace App\Modules\Marketing\Infrastructure;

use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Orders\Application\Contracts\OrderCampaigns;

/**
 * P2a: an order's campaign from its attribution — the short link's campaign, else the
 * campaign with that `utm_campaign` (two queries for any number of orders).
 */
class EloquentOrderCampaigns implements OrderCampaigns
{
    public function campaignsFor(array $attributions): array
    {
        $codes = [];
        $tags = [];
        foreach ($attributions as $attribution) {
            if (is_string($attribution['short_link'] ?? null)) {
                $codes[] = $attribution['short_link'];
            }
            if (is_string($attribution['utm_campaign'] ?? null)) {
                $tags[] = $attribution['utm_campaign'];
            }
        }
        if ($codes === [] && $tags === []) {
            return array_map(fn () => null, $attributions);
        }
        $byCode = $codes === [] ? [] : ShortLink::query()->whereIn('code', array_values(array_unique($codes)))->whereNotNull('campaign_id')
            ->pluck('campaign_id', 'code')->all();
        $campaigns = Campaign::query()
            ->where(fn ($q) => $q->whereIn('id', array_values(array_unique($byCode)))->orWhereIn('utm_campaign', array_values(array_unique($tags))))
            ->get(['id', 'name', 'utm_campaign']);
        $byId = $campaigns->keyBy('id');
        $byTag = $campaigns->keyBy('utm_campaign');

        $result = [];
        foreach ($attributions as $key => $attribution) {
            $campaign = null;
            if (is_string($attribution['short_link'] ?? null) && isset($byCode[$attribution['short_link']])) {
                $campaign = $byId->get($byCode[$attribution['short_link']]);
            }
            if ($campaign === null && is_string($attribution['utm_campaign'] ?? null)) {
                $campaign = $byTag->get($attribution['utm_campaign']);
            }
            $result[$key] = $campaign === null ? null : ['id' => $campaign->id, 'name' => $campaign->name];
        }

        return $result;
    }
}
