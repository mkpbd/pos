<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * Cleans rich text written by staff before it is stored (ADR-009): only a whitelist of
 * formatting elements survives, links are http(s)/mailto/site paths, and images may
 * only come from the organization's own media storage.
 */
interface HtmlSanitizer
{
    public function clean(string $html): string;
}
