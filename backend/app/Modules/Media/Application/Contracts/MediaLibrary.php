<?php

namespace App\Modules\Media\Application\Contracts;

/**
 * What other modules may ask the media library: whether ids belong to the current
 * organization, and the public representation of media items for API output.
 */
interface MediaLibrary
{
    /**
     * The subset of the given ids that exist in the current organization.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function existing(array $ids): array;

    /**
     * Public representation keyed by id; unknown ids are absent.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, url: string, srcset: string, width: int, height: int, alt: ?string}>
     */
    public function refs(array $ids): array;
}
