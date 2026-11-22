<?php

namespace App\Modules\Storefront\Domain\Builder\Wizard;

/**
 * B21: the choices of "Build my page in 1 minute" (POST /storefront/builder/wizard) and their
 * limits — also published in the element registry (`enums.wizard_*`, `limits.wizard`). The
 * recipes behind them are server-side only (WizardRecipes).
 */
final class WizardOptions
{
    public const PAGE_TYPES = ['home', 'sale', 'product_launch', 'about', 'festival', 'contact'];

    public const GOALS = ['orders', 'order_form', 'phone_numbers', 'show_collection', 'tell_story'];

    /** `current` = no motion theme; the others are B18 motion themes. */
    public const LOOKS = ['current', 'calm', 'lively', 'festive'];

    /** en: English texts only; bn: Bangla texts as the base texts; both: English with Bangla translations. */
    public const LANGUAGES = ['en', 'bn', 'both'];

    /** The goal the wizard suggests for each page type (any goal works with any page type). */
    public const DEFAULT_GOALS = [
        'home' => 'orders',
        'sale' => 'orders',
        'product_launch' => 'order_form',
        'about' => 'tell_story',
        'festival' => 'orders',
        'contact' => 'phone_numbers',
    ];

    public const MAX_TITLE = 80;

    public const MAX_CATEGORIES = 4;

    public const MAX_PRODUCTS = 8;

    /** A landing page address (as for campaign pages; `home` is reserved). */
    public const SLUG_PATTERN = '/^[a-z0-9-]{2,60}$/';

    /**
     * @return array{title: int, categories: int, products: int}
     */
    public static function limits(): array
    {
        return ['title' => self::MAX_TITLE, 'categories' => self::MAX_CATEGORIES, 'products' => self::MAX_PRODUCTS];
    }
}
