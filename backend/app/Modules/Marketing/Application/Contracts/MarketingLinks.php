<?php

namespace App\Modules\Marketing\Application\Contracts;

/**
 * P2b: what other modules (Social) may ask Marketing — the organization's campaigns and short
 * links (`https://<store host>/go/<code>`). Organization from the tenant context.
 */
interface MarketingLinks
{
    /**
     * Campaigns with these ids (others' and unknown ids left out), keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, name: string, utm_campaign: string, status: string}>
     */
    public function campaigns(array $ids): array;

    /**
     * Creates a short link with a random code to a store path, with UTM values (source, medium,
     * campaign, content, term) and an optional campaign (audited like a staff-made one). `url` is
     * null while the store has no domain.
     *
     * @param  array<string, ?string>  $utm
     * @return array{id: string, code: string, url: ?string}
     */
    public function createShortLink(string $targetPath, array $utm, ?string $campaignId): array;

    /**
     * Short links with these ids (deleted ones left out), keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, code: string, url: ?string}>
     */
    public function shortLinks(array $ids): array;

    /**
     * Whether a value is a store path a short link may point to (`/p/eid-sale`, `/product/x`).
     */
    public function isStorePath(mixed $path): bool;
}
