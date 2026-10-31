<?php

namespace App\Modules\Storefront\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Custom CSS is injected into a <style> element of every storefront page, so it must
 * not be able to close that element, load remote code or reach outside the media
 * library.
 */
final class CustomCssPolicy
{
    public const MAX_BYTES = 20_000;

    /** @var list<string> */
    private const FORBIDDEN = ['<', '@import', 'expression(', 'javascript:', 'vbscript:', 'behavior:', '-moz-binding', '@charset', '@namespace'];

    public static function assertAllowed(string $css): void
    {
        if (strlen($css) > self::MAX_BYTES) {
            throw new BusinessRuleViolation('CUSTOM_CSS_REJECTED', 'Custom CSS may be at most '.self::MAX_BYTES.' bytes.');
        }

        $lower = strtolower($css);
        foreach (self::FORBIDDEN as $token) {
            if (str_contains($lower, $token)) {
                throw new BusinessRuleViolation('CUSTOM_CSS_REJECTED', "Custom CSS may not contain \"{$token}\".", ['token' => $token]);
            }
        }

        // Escapes could spell any of the above; theme tweaks do not need them.
        if (str_contains($css, '\\')) {
            throw new BusinessRuleViolation('CUSTOM_CSS_REJECTED', 'Custom CSS may not contain backslash escapes.');
        }

        preg_match_all('/url\(\s*([\'"]?)([^\'")]*)\1\s*\)/i', $css, $matches);
        foreach ($matches[2] as $url) {
            if (! str_starts_with(trim($url), '/storage/')) {
                throw new BusinessRuleViolation('CUSTOM_CSS_REJECTED', 'url() may only reference images from the media library (/storage/...).', ['url' => $url]);
            }
        }
        if (substr_count($lower, 'url(') !== count($matches[0])) {
            throw new BusinessRuleViolation('CUSTOM_CSS_REJECTED', 'Every url() must be a quoted or plain /storage/ path.');
        }
    }
}
