<?php

namespace App\Modules\Storefront\Application\Builder\Templates;

use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use InvalidArgumentException;

/**
 * B14: the built-in starter design of each store page template — neutral layouts with Bangla
 * texts, the template's main part and its page fields, no photos or records — in
 * `resources/builder-templates/store-pages/<key>.json` (plain documents, validated on create
 * like any draft).
 */
class StorePageStarters
{
    /**
     * @return array<string, mixed>
     */
    public function content(string $template): array
    {
        if (! in_array($template, ElementRegistry::TEMPLATES, true)) {
            throw new InvalidArgumentException("Unknown store page template \"{$template}\".");
        }
        $content = json_decode((string) file_get_contents(self::directory().'/'.$template.'.json'), true, 512, JSON_THROW_ON_ERROR);

        return is_array($content) ? $content : [];
    }

    public static function directory(): string
    {
        return resource_path('builder-templates/store-pages');
    }
}
