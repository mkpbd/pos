<?php

namespace App\Modules\Marketing\Infrastructure;

use App\Modules\Marketing\Application\Actions\ManageShortLinks;
use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\Marketing\Domain\ShortLinkTarget;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * P2b: campaigns and short links for the Social module (post links).
 */
class EloquentMarketingLinks implements MarketingLinks
{
    public function __construct(
        private readonly ManageShortLinks $links,
        private readonly StorefrontConfig $storefront,
    ) {}

    public function campaigns(array $ids): array
    {
        $ids = $this->uuids($ids);
        if ($ids === []) {
            return [];
        }

        return Campaign::query()->whereKey($ids)->get(['id', 'name', 'utm_campaign', 'status'])
            ->mapWithKeys(fn (Campaign $c) => [$c->id => ['id' => $c->id, 'name' => $c->name, 'utm_campaign' => $c->utm_campaign, 'status' => $c->status]])
            ->all();
    }

    public function createShortLink(string $targetPath, array $utm, ?string $campaignId): array
    {
        $link = $this->links->create([
            'target_path' => $targetPath,
            'campaign_id' => $campaignId,
            'utm' => array_intersect_key($utm, array_flip(ShortLink::UTM)),
            'active' => true,
        ]);

        return ['id' => $link->id, 'code' => $link->code, 'url' => $this->url($link->code)];
    }

    public function shortLinks(array $ids): array
    {
        $ids = $this->uuids($ids);
        if ($ids === []) {
            return [];
        }

        return ShortLink::query()->whereKey($ids)->get(['id', 'code'])
            ->mapWithKeys(fn (ShortLink $l) => [$l->id => ['id' => $l->id, 'code' => $l->code, 'url' => $this->url($l->code)]])
            ->all();
    }

    public function isStorePath(mixed $path): bool
    {
        return ShortLinkTarget::isValid($path);
    }

    private function url(string $code): ?string
    {
        $site = $this->storefront->primaryUrl();

        return $site === null ? null : $site.'/go/'.$code;
    }

    /**
     * @param  list<mixed>  $ids
     * @return list<string>
     */
    private function uuids(array $ids): array
    {
        return array_values(array_unique(array_map('strtolower', array_filter($ids, fn ($id) => is_string($id) && preg_match('/^[0-9a-f-]{36}$/i', $id) === 1))));
    }
}
