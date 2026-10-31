<?php

namespace App\Modules\Cms\Domain;

/**
 * Page addresses are /pages/{slug}: lower-case letters, digits and single hyphens.
 */
final class PageSlug
{
    public const PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public const MAX_LENGTH = 100;

    public static function isValid(string $slug): bool
    {
        return strlen($slug) <= self::MAX_LENGTH && preg_match(self::PATTERN, $slug) === 1;
    }
}
