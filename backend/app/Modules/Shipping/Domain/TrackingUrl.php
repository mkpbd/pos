<?php

namespace App\Modules\Shipping\Domain;

/**
 * A courier's parcel tracking link: an absolute http(s) URL template containing
 * `{tracking}`, replaced by the url-encoded tracking number.
 */
final class TrackingUrl
{
    public const PLACEHOLDER = '{tracking}';

    public static function isValidTemplate(string $template): bool
    {
        if (! str_contains($template, self::PLACEHOLDER)) {
            return false;
        }
        $sample = str_replace(self::PLACEHOLDER, 'X', $template);
        $scheme = strtolower((string) parse_url($sample, PHP_URL_SCHEME));

        return in_array($scheme, ['http', 'https'], true)
            && filter_var($sample, FILTER_VALIDATE_URL) !== false
            && (string) parse_url($sample, PHP_URL_HOST) !== '';
    }

    /**
     * The link for a tracking number, or null without a template or number.
     */
    public static function build(?string $template, ?string $trackingNumber): ?string
    {
        if ($template === null || $template === '' || $trackingNumber === null || trim($trackingNumber) === '') {
            return null;
        }

        return str_replace(self::PLACEHOLDER, rawurlencode(trim($trackingNumber)), $template);
    }
}
