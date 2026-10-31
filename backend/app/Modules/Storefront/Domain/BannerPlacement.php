<?php

namespace App\Modules\Storefront\Domain;

/**
 * Where a banner can be used. Category, shop-sidebar and popup placements are added
 * with the pages that show them (E6, E11).
 */
enum BannerPlacement: string
{
    /** Full-width slides of the homepage hero slider. */
    case HeroSlider = 'hero_slider';
    /** Tiles of homepage banner grids. */
    case HomePromo = 'home_promo';

    public function label(): string
    {
        return match ($this) {
            self::HeroSlider => 'Hero slider',
            self::HomePromo => 'Homepage promo tile',
        };
    }
}
