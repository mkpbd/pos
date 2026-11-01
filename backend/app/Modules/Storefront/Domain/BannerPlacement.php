<?php

namespace App\Modules\Storefront\Domain;

/**
 * Where a banner can be used. Category and shop-sidebar placements are added with the
 * pages that show them. A popup (E11) is a modal over the storefront: at most one is shown,
 * the first live one in sort order, after its delay and at most as often as its frequency.
 */
enum BannerPlacement: string
{
    /** Full-width slides of the homepage hero slider. */
    case HeroSlider = 'hero_slider';
    /** Tiles of homepage banner grids. */
    case HomePromo = 'home_promo';
    /** The storefront popup (E11). */
    case Popup = 'popup';

    public const POPUP_FREQUENCIES = ['once_per_session', 'once_per_day', 'once_per_week'];

    public const POPUP_DEFAULTS = ['popup_delay_seconds' => 5, 'popup_frequency' => 'once_per_day'];

    public function label(): string
    {
        return match ($this) {
            self::HeroSlider => 'Hero slider',
            self::HomePromo => 'Homepage promo tile',
            self::Popup => 'Popup',
        };
    }
}
