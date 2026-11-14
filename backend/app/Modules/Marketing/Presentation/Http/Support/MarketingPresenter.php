<?php

namespace App\Modules\Marketing\Presentation\Http\Support;

use App\Modules\Marketing\Application\Contracts\LandingPages;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * P2a: campaigns and short links for the admin.
 */
class MarketingPresenter
{
    private ?string $siteUrl = null;

    private bool $siteUrlLoaded = false;

    public function __construct(
        private readonly LandingPages $landingPages,
        private readonly StorefrontConfig $storefront,
    ) {}

    /**
     * @param  Collection<int, Campaign>|list<Campaign>  $campaigns
     * @return list<array<string, mixed>>
     */
    public function campaigns(Collection|array $campaigns): array
    {
        $campaigns = collect($campaigns);
        $pages = $this->landingPages->find($campaigns->pluck('landing_document_id')->filter()->unique()->values()->all());
        $counts = ShortLink::query()->whereIn('campaign_id', $campaigns->pluck('id')->all())
            ->selectRaw('campaign_id, COUNT(*) AS n')->groupBy('campaign_id')->toBase()->pluck('n', 'campaign_id');

        return $campaigns->map(fn (Campaign $c) => [
            'id' => $c->id,
            'name' => $c->name,
            'slug' => $c->slug,
            'utm_campaign' => $c->utm_campaign,
            'landing_document' => $c->landing_document_id === null ? null : ($pages[$c->landing_document_id] ?? null),
            'starts_at' => $c->starts_at?->toIso8601String(),
            'ends_at' => $c->ends_at?->toIso8601String(),
            'status' => $c->status,
            'short_links_count' => (int) ($counts[$c->id] ?? 0),
            'created_at' => $c->created_at?->toIso8601String(),
            'updated_at' => $c->updated_at?->toIso8601String(),
        ])->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function campaign(Campaign $campaign): array
    {
        return $this->campaigns([$campaign])[0];
    }

    /**
     * @param  Collection<int, ShortLink>|list<ShortLink>  $links
     * @return list<array<string, mixed>>
     */
    public function shortLinks(Collection|array $links): array
    {
        $links = (new EloquentCollection(collect($links)->all()))->loadMissing('campaign');
        $site = $this->siteUrl();

        return $links->map(fn (ShortLink $l) => [
            'id' => $l->id,
            'code' => $l->code,
            'target_path' => $l->target_path,
            'campaign' => $l->campaign === null ? null : ['id' => $l->campaign->id, 'name' => $l->campaign->name],
            'utm' => [
                'source' => $l->utm_source,
                'medium' => $l->utm_medium,
                'campaign' => $l->utm_campaign,
                'content' => $l->utm_content,
                'term' => $l->utm_term,
            ],
            'clicks' => $l->clicks,
            'last_clicked_at' => $l->last_clicked_at?->toIso8601String(),
            'active' => $l->active,
            'url' => $site === null ? null : $site.'/go/'.$l->code,
            'created_at' => $l->created_at?->toIso8601String(),
            'updated_at' => $l->updated_at?->toIso8601String(),
        ])->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function shortLink(ShortLink $link): array
    {
        return $this->shortLinks([$link])[0];
    }

    private function siteUrl(): ?string
    {
        if (! $this->siteUrlLoaded) {
            $this->siteUrl = $this->storefront->primaryUrl();
            $this->siteUrlLoaded = true;
        }

        return $this->siteUrl;
    }
}
