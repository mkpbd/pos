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

    /**
     * P2b: the original files of media items (current organization; unknown ids absent), keyed
     * by id — what a social network downloads: the original's URL, type, size in pixels and alt.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, url: string, mime_type: string, width: int, height: int, alt: ?string}>
     */
    public function originals(array $ids): array;

    /**
     * A small rendition (the narrowest at least $minWidth wide, else the original) as a
     * `data:` URI, for documents rendered without network access (PDF letterhead, X1).
     * Null when unknown, unreadable or larger than $maxBytes.
     */
    public function dataUri(string $id, int $minWidth = 240, int $maxBytes = 524288): ?string;

    /**
     * B5: adds an image file that ships with the application (a store builder template's photo)
     * to the current organization's library, with the upload's rules (JPEG, PNG, WebP or GIF, at
     * most 5 MB and 6000 × 6000 px; otherwise BusinessRuleViolation INVALID_IMAGE) and audit.
     * The same bytes already in the library are reused (`created` false), so applying a template
     * again imports nothing.
     *
     * @param  string  $path  absolute path of the file
     * @param  string  $name  the original file name to record
     * @return array{id: string, created: bool}
     */
    public function import(string $path, string $name, ?string $alt): array;
}
