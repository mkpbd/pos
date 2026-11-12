<?php

namespace App\Modules\Storefront\Domain\Builder\Templates;

/**
 * B5: turns the portable references of a built-in template into the current organization's
 * records while a template is applied (PortableTemplate::concrete). The real resolver imports
 * the shipped images into the media library, creates banners and looks up menus; tests use a
 * fake one.
 */
interface TemplateReferenceResolver
{
    /**
     * The media id of a shipped image (`vegan/banner-hero-1.jpg`), imported when needed.
     */
    public function media(string $asset): string;

    /**
     * The id of a banner with these attributes (the banner API's fields, `desktop_media_id`
     * already resolved), created when needed.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function banner(array $attributes): string;

    /**
     * The id of the organization's menu for a reference (`main`, `footer`, `footer_1` … `footer_3`),
     * or null when it has none (the menu element is then left out).
     */
    public function menu(string $ref): ?string;

    /**
     * B6: the id of the organization's `$index`-th live product of a source (featured,
     * best_sellers, new_arrivals, on_sale; 0-based), or null when it has fewer (a shop-the-look
     * hotspot is then left out).
     */
    public function product(string $source, int $index): ?string;

    /**
     * B8b: the id of the organization's promotion for a reference (`coupon`: the running
     * percent / fixed coupon promotion with a usable code that ends first), or null (a discount
     * element is then left out).
     */
    public function promotion(string $ref): ?string;
}
