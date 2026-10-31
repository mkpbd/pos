<?php

namespace App\Modules\Media\Application\Contracts;

/**
 * Implemented by modules that point at media without a foreign key (ids kept inside
 * JSON settings). Implementations are tagged MediaReferences::TAG; the library refuses
 * to delete media any of them still uses. Media referenced through real foreign keys
 * is protected by the database instead.
 */
interface MediaReferences
{
    public const TAG = 'media.references';

    /**
     * Whether the current organization still uses this media item.
     */
    public function uses(string $mediaId): bool;
}
