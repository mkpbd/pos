<?php

namespace App\Modules\Shared\Infrastructure\Html;

use HTMLPurifier_Config;
use HTMLPurifier_Context;
use HTMLPurifier_URI;
use HTMLPurifier_URIFilter;

/**
 * Rejects image sources outside the organization's media storage, so rich text can
 * never hot-link or track through third-party images. Other URIs pass untouched.
 */
class OwnMediaImagesFilter extends HTMLPurifier_URIFilter
{
    /** @var list<string> */
    public static array $prefixes = ['/storage/'];

    public $name = 'OwnMediaImages';

    /**
     * @param  HTMLPurifier_URI  $uri
     * @param  HTMLPurifier_Config  $config
     * @param  HTMLPurifier_Context  $context
     */
    public function filter(&$uri, $config, $context): bool
    {
        $token = $context->get('CurrentToken', true);
        if (! is_object($token) || ($token->name ?? null) !== 'img' || $context->get('CurrentAttr', true) !== 'src') {
            return true;
        }

        $src = $uri->toString();
        if (str_contains($src, '..')) {
            return false;
        }
        foreach (self::$prefixes as $prefix) {
            if ($prefix !== '' && str_starts_with($src, $prefix) && ! str_starts_with($src, '//')) {
                return true;
            }
        }

        return false;
    }
}
