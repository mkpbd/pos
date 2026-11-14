<?php

namespace App\Modules\Marketing\Application\Contracts;

/**
 * P2a: the store's landing pages (store builder pages at `/p/<slug>`) a campaign can point to
 * (declared here, implemented by the Storefront module; organization from the tenant context).
 *
 * @phpstan-type LandingPage array{id: string, title: string, slug: string, path: string, published: bool}
 */
interface LandingPages
{
    /**
     * Every landing page, by title.
     *
     * @return list<LandingPage>
     */
    public function all(): array;

    /**
     * The landing pages with these ids (others' and unknown ids left out), keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, LandingPage>
     */
    public function find(array $ids): array;

    /**
     * The id of the landing page at a store path (`/p/<slug>`), or null.
     */
    public function idForPath(string $path): ?string;
}
